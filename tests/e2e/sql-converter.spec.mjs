import { expect, test } from "@playwright/test";

const viewports = [
  { width: 320, height: 568 },
  { width: 320, height: 480 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 980, height: 400 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 667, height: 375 }
];

async function openApp(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#oracleSql")).toBeVisible();
}

test("works from a standalone file without external requests", async ({ page }) => {
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const external = [];
  const errors = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.locator("#oracleSql").fill("SELECT NVL(NULL, 'ok') FROM DUAL;");
  await expect(page.locator("#postgresHighlight")).toHaveText("SELECT COALESCE(NULL, 'ok');");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("marks review and input errors and clears their status after correction", async ({ page }) => {
  await openApp(page);
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;\nSELECT COUNT(*) FROM t WHERE ROWNUM<=2;");
  await expect(page.locator("#outputStatus")).toHaveText(/要確認/);
  await expect(page.locator("#warningsList")).toContainText("文2・2行目");
  await page.locator("#oracleSql").fill("SELECT 'unclosed");
  await expect(page.locator("#outputStatus")).toHaveText("入力に不備あり・要修正");
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await expect(page.locator("#outputStatus")).toHaveText("変換済み（差分あり）");
  await expect(page.locator("#messagesDrawer")).toBeHidden();
});

test("clipboard denial shows a real failure and leaves output selected", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText() { throw new Error("denied"); } } });
    document.execCommand = () => false;
  });
  await openApp(page);
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await page.locator("#copyPostgresButton").click();
  await expect(page.locator("#toast")).toContainText("コピーできませんでした");
  expect(await page.evaluate(() => window.getSelection().toString())).toBe("SELECT 1;");
});

test("preserves literal data and quoted names in the visible output", async ({ page }) => {
  await openApp(page);
  await page.locator("#oracleSql").fill('CREATE TABLE "DATE" ("NUMBER" NUMBER);\nUPDATE t a SET a.note = \'a.id=1\';');
  await expect(page.locator("#postgresHighlight")).toHaveText('CREATE TABLE "DATE" ("NUMBER" NUMERIC);\nUPDATE t a SET note = \'a.id=1\';');
  await expect(page.locator("#messagesDrawer")).toBeHidden();
});

test("shows policy limitations and retains unsafe ROWNUM predicates", async ({ page }) => {
  await openApp(page);
  const input = "SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;\nSELECT TO_DATE('2024-06-15 12:34:56', 'YYYY-MM-DD HH24:MI:SS') FROM DUAL;";
  await page.locator("#oracleSql").fill(input);
  await expect(page.locator("#postgresHighlight")).toContainText("WHERE ROWNUM <= 2;");
  await expect(page.locator("#postgresHighlight")).not.toContainText("LIMIT");
  await expect(page.locator("#warningsList")).toContainText("時刻");
  await expect(page.locator("#warningsList")).toContainText("ROWNUM");
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await expect(page.locator("#messagesDrawer")).toBeHidden();
});

test("typing SQL converts visible output, escapes payloads, and keeps warnings user-readable", async ({ page }) => {
  await openApp(page);

  await page.locator("#oracleSql").fill([
    "SELECT '<script>alert(1)</script>' AS payload,",
    "       name",
    "FROM users",
    "WHERE ROWNUM <= 5",
    "ORDER BY id;"
  ].join("\n"));

  const output = page.locator("#postgresHighlight");
  await expect(output).toContainText("'<script>alert(1)</script>' AS payload");
  await expect(output).toContainText("ORDER BY id");
  await expect(output).toContainText("LIMIT 5");
  await expect(page.locator("#outputStatus")).toHaveText(/要確認/);
  await expect(page.locator("#postgresVersionLabel")).toHaveText("PostgreSQL 15.17");
  await expect(page.locator(".editor-shell.output-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  const outputHtml = await output.evaluate((element) => element.innerHTML);
  expect(outputHtml).not.toContain("<script>alert");
  expect(outputHtml).toContain("&lt;script&gt;alert");
});

test("status indicates when conversion output has no diff", async ({ page }) => {
  await openApp(page);

  await page.locator("#oracleSql").fill("SELECT id, name FROM users;");

  await expect(page.locator("#postgresHighlight")).toHaveText("SELECT id, name FROM users;");
  await expect(page.locator("#outputStatus")).toHaveText("変換済み（差分なし）");
});

test("clear and copy actions update state without duplicate or stale output", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__copiedText = value;
        }
      }
    });
  });
  await openApp(page);

  await page.locator("#oracleSql").fill("SELECT MYSEQ.NEXTVAL FROM DUAL;");
  await page.locator("#copyPostgresButton").click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe("SELECT nextval('myseq');");

  await page.locator("#clearOracleButton").click();
  await expect(page.locator("#clearOracleButton")).toBeDisabled();
  // A duplicate queued action must not discard the recovery snapshot.
  await page.locator("#clearOracleButton").dispatchEvent("click");
  await expect(page.locator("#postgresHighlight")).toHaveText("");
  await expect(page.locator("#inputStatus")).toHaveText("入力待ち");
  await expect(page.locator("#outputStatus")).toHaveText("未変換");
  await expect(page.locator("#messagesDrawer")).toBeHidden();
  await expect(page.locator("#oracleSql")).toBeFocused();
  await expect(page.locator("#undoClearButton")).toBeVisible();
});

test("IME composing keys and keyboard navigation do not mutate the editor unexpectedly", async ({ page }) => {
  await openApp(page);

  const composingTab = await page.locator("#oracleSql").evaluate((input) => {
    input.value = "日本語";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      isComposing: true
    });
    Object.defineProperty(event, "keyCode", { get: () => 229 });
    Object.defineProperty(event, "which", { get: () => 229 });
    input.dispatchEvent(event);
    return { value: input.value, defaultPrevented: event.defaultPrevented };
  });

  expect(composingTab).toEqual({ value: "日本語", defaultPrevented: false });

  const shiftTab = await page.locator("#oracleSql").evaluate((input) => {
    input.value = "abc";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(event);
    return { value: input.value, defaultPrevented: event.defaultPrevented };
  });

  expect(shiftTab).toEqual({ value: "abc", defaultPrevented: false });

  const normalTab = await page.locator("#oracleSql").evaluate((input) => {
    input.value = "abc";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(event);
    return { value: input.value, defaultPrevented: event.defaultPrevented };
  });

  expect(normalTab).toEqual({ value: "abc  ", defaultPrevented: true });
});

test("large pasted SQL uses plain highlight mode while preserving conversion output", async ({ page }) => {
  await openApp(page);

  const largeSql = Array.from({ length: 6500 }, (_, index) => {
    return `SELECT ${index} AS id, CAST(${index} AS NUMBER) AS amount FROM DUAL;`;
  }).join("\n");

  const state = await page.locator("#oracleSql").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const oracleHighlight = document.querySelector("#oracleHighlight");
    const postgresHighlight = document.querySelector("#postgresHighlight");
    return {
      oracleMode: oracleHighlight.dataset.highlightMode,
      postgresMode: postgresHighlight.dataset.highlightMode,
      outputPrefix: postgresHighlight.textContent.slice(0, 120),
      outputSuffix: postgresHighlight.textContent.slice(-120),
      tokenCount: postgresHighlight.querySelectorAll("span").length,
      outputStatus: document.querySelector("#outputStatus").textContent,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  }, largeSql);

  expect(state.oracleMode).toBe("plain");
  expect(state.postgresMode).toBe("plain");
  expect(state.tokenCount).toBe(0);
  expect(state.outputPrefix).toContain("CAST(0 AS NUMERIC)");
  expect(state.outputSuffix).toContain("CAST(6499 AS NUMERIC)");
  expect(state.outputStatus).toBe("変換済み（差分あり）");
  expect(state.scrollWidth).toBeLessThanOrEqual(state.innerWidth);
});

for (const viewport of viewports) {
  test(`critical UI stays within viewport at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    await page.locator("#oracleSql").fill([
      "SELECT '長い日本語ラベル'.repeat FROM DUAL;",
      "-- " + "averyveryveryveryveryverylongunbrokenidentifier".repeat(3),
      "SELECT '<img src=x onerror=alert(1)>' FROM DUAL;"
    ].join("\n"));

    if (viewport.width === 320 || viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath(`layout-${viewport.width}x${viewport.height}.png`),
        fullPage: true
      });
    }

    const layout = await page.evaluate(() => {
      const selectors = [
        ".topbar",
        "main",
        "#oracleSql",
        "#postgresHighlight",
        "#clearOracleButton",
        "#copyPostgresButton"
      ];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        boxes: selectors.map((selector) => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return {
            selector,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          };
        })
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight);
    for (const box of layout.boxes) {
      expect(box.left, box.selector).toBeGreaterThanOrEqual(-1);
      expect(box.right, box.selector).toBeLessThanOrEqual(layout.innerWidth + 1);
      expect(box.width, box.selector).toBeGreaterThan(0);
      expect(box.top, box.selector).toBeGreaterThanOrEqual(-1);
      expect(box.bottom, box.selector).toBeLessThanOrEqual(layout.innerHeight + 1);
      expect(box.height, box.selector).toBeGreaterThan(0);
      if (box.selector.endsWith("Button")) {
        expect(box.scrollWidth, box.selector).toBeLessThanOrEqual(box.clientWidth + 1);
      }
    }

    await page.locator("#oracleSql").fill(Array.from({ length: 60 }, () => "SELECT NVL(name, 'x'), ADD_MONTHS(created_at, 1), INSTR(code, '-') FROM t;").join("\n"));
    await expect(page.locator("#messagesDrawer")).toBeVisible();
    const scrolling = await page.evaluate(() => {
      const selectors = ["#oracleSql", "#postgresHighlight", "#warningsList"];
      return {
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        regions: selectors.map((selector) => {
          const element = document.querySelector(selector);
          element.scrollTop = element.scrollHeight;
          const rect = element.getBoundingClientRect();
          return { selector, height: rect.height, bottom: rect.bottom, scrollTop: element.scrollTop };
        })
      };
    });
    expect(scrolling.pageHeight).toBeLessThanOrEqual(scrolling.viewportHeight);
    for (const region of scrolling.regions) {
      expect(region.height, region.selector).toBeGreaterThan(20);
      expect(region.bottom, region.selector).toBeLessThanOrEqual(scrolling.viewportHeight + 1);
      expect(region.scrollTop, region.selector).toBeGreaterThan(0);
    }
    if (viewport.width === 320 || viewport.width === 980) {
      await page.screenshot({ path: testInfo.outputPath(`warnings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
  });
}
