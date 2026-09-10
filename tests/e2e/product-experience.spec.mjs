import { expect, test } from "@playwright/test";

async function openApp(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#oracleSql")).toBeVisible();
}

test("empty editors disable unavailable actions and a sample produces usable output", async ({ page }) => {
  await openApp(page);

  await expect(page.locator("#clearOracleButton")).toBeDisabled();
  await expect(page.locator("#copyPostgresButton")).toBeDisabled();
  await expect(page.locator("#undoClearButton")).toBeHidden();
  await page.locator("#sampleSqlButton").click();

  await expect(page.locator("#oracleSql")).not.toHaveValue("");
  await expect(page.locator("#postgresHighlight")).not.toHaveText("");
  await expect(page.locator("#clearOracleButton")).toBeEnabled();
  await expect(page.locator("#copyPostgresButton")).toBeEnabled();
  await expect(page.locator("#sampleSqlButton")).toBeHidden();
  await expect(page.locator("#oracleSql")).toBeFocused();
});

test("an accidental clear can restore the exact source and its converted result", async ({ page }) => {
  await openApp(page);
  const source = "-- 手元で編集中のSQL\nSELECT NVL(NULL, '日本語') AS label FROM DUAL;\n";
  await page.locator("#oracleSql").fill(source);
  const output = await page.locator("#postgresHighlight").textContent();

  await page.locator("#clearOracleButton").click();

  await expect(page.locator("#oracleSql")).toHaveValue("");
  await expect(page.locator("#postgresHighlight")).toHaveText("");
  await expect(page.locator("#clearOracleButton")).toBeDisabled();
  await expect(page.locator("#copyPostgresButton")).toBeDisabled();
  await expect(page.locator("#undoClearButton")).toBeVisible();
  await page.locator("#undoClearButton").click();

  await expect(page.locator("#oracleSql")).toHaveValue(source);
  await expect(page.locator("#postgresHighlight")).toHaveText(output);
  await expect(page.locator("#undoClearButton")).toBeHidden();
  await expect(page.locator("#copyPostgresButton")).toBeEnabled();
  await expect(page.locator("#oracleSql")).toBeFocused();
});

test("editing after a clear discards the previous recovery without restoring stale SQL", async ({ page }) => {
  await openApp(page);
  await page.locator("#oracleSql").fill("SELECT 'old' FROM DUAL;");
  await page.locator("#clearOracleButton").click();
  await expect(page.locator("#undoClearButton")).toBeVisible();

  await page.locator("#oracleSql").fill("SELECT 'new' FROM DUAL;");
  await expect(page.locator("#undoClearButton")).toBeHidden();
  await page.locator("#oracleSql").fill("");
  await expect(page.locator("#undoClearButton")).toBeHidden();

  const replacement = "SELECT 'replacement' FROM DUAL;";
  await page.locator("#oracleSql").fill(replacement);
  await page.locator("#clearOracleButton").click();
  await page.locator("#undoClearButton").click();
  await expect(page.locator("#oracleSql")).toHaveValue(replacement);
});

test("Escape then Tab leaves the editor without modifying SQL, while normal Tab indents", async ({ page }) => {
  await openApp(page);
  const input = page.locator("#oracleSql");
  await input.fill("SELECT 1 FROM DUAL;");
  await input.press("ControlOrMeta+End");
  await input.press("Tab");
  await expect(input).toHaveValue("SELECT 1 FROM DUAL;  ");
  await expect(input).toBeFocused();

  await input.press("Escape");
  await input.press("Tab");
  await expect(page.locator("#copyPostgresButton")).toBeFocused();
  await expect(input).toHaveValue("SELECT 1 FROM DUAL;  ");

  await input.focus();
  await input.press("ControlOrMeta+End");
  await input.press("Tab");
  await expect(input).toHaveValue("SELECT 1 FROM DUAL;    ");
});

test("converted SQL is reachable and scrollable with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page);
  const source = Array.from({ length: 100 }, (_, index) => `SELECT ${index} FROM DUAL;`).join("\n");
  await page.locator("#oracleSql").fill(source);
  await page.locator("#copyPostgresButton").focus();
  await page.keyboard.press("Tab");

  const output = page.getByRole("region", { name: "PostgreSQL", exact: true });
  await expect(output).toBeFocused();
  await output.press("PageDown");
  await expect.poll(() => output.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator("#oracleSql")).toHaveValue(source);
});

test("review count matches the items shown for repeated warnings in separate statements", async ({ page }) => {
  await openApp(page);
  await page.locator("#oracleSql").fill("SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;\nSELECT COUNT(*) FROM t WHERE ROWNUM <= 2;");
  const items = page.locator("#warningsList li");
  await expect(items).toContainText([/文1・1行目/, /文1・1行目/, /文2・2行目/, /文2・2行目/]);
  await expect(page.locator("#outputStatus")).toHaveText(`要確認（${await items.count()}件）`);
});

test("duplicate browser input events do not repeat long conversions or prevent restoring cleared SQL", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__conversionCalls = 0;
    const convertSource = window.convertOracleToPostgres;
    window.convertOracleToPostgres = (...args) => {
      window.__conversionCalls += 1;
      return convertSource(...args);
    };
  });
  const source = Array.from({ length: 100 }, (_, index) =>
    `SELECT CAST(${index} AS NUMBER) FROM DUAL; -- ${"long_comment_".repeat(30)}`
  ).join("\n");
  await page.locator("#oracleSql").fill(source);
  await page.locator("#oracleSql").evaluate((input) => {
    for (let index = 0; index < 3; index += 1) input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#postgresHighlight")).toContainText("CAST(99 AS NUMERIC)");
  expect(await page.evaluate(() => window.__conversionCalls)).toBe(1);
  await page.locator("#clearOracleButton").click();
  await page.locator("#undoClearButton").click();
  await expect(page.locator("#oracleSql")).toHaveValue(source);
  await expect(page.locator("#postgresHighlight")).toContainText("CAST(99 AS NUMERIC)");
  expect(await page.evaluate(() => window.__conversionCalls)).toBe(2);
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await expect(page.locator("#postgresHighlight")).toHaveText("SELECT 1;");
  expect(await page.evaluate(() => window.__conversionCalls)).toBe(3);
});
