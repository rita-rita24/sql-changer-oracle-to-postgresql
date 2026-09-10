import { expect, test } from "@playwright/test";

const themeKey = "sql-changer-theme";

async function expectTheme(page, theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("switch", { name: "ダークモード", exact: true }))
    .toHaveAttribute("aria-checked", String(theme === "dark"));
}

async function openApp(page, colorScheme = "light") {
  await page.emulateMedia({ colorScheme });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#oracleSql")).toBeVisible();
}

test("theme switch supports the keyboard, visible focus and saved choices after reload", async ({ page }) => {
  await openApp(page);
  await expectTheme(page, "light");
  const toggle = page.locator("#eclipse-toggle");

  await toggle.focus();
  await toggle.press("Space");
  await expectTheme(page, "dark");
  await expect(toggle).toBeFocused();
  const focus = await toggle.evaluate((button) => ({
    visible: button.matches(":focus-visible"),
    outlineStyle: getComputedStyle(button).outlineStyle,
    outlineWidth: parseFloat(getComputedStyle(button).outlineWidth)
  }));
  expect(focus.visible).toBe(true);
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThan(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), themeKey)).toBe("dark");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectTheme(page, "dark");
  await toggle.press("Enter");
  await expectTheme(page, "light");
  expect(await page.evaluate((key) => localStorage.getItem(key), themeKey)).toBe("light");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectTheme(page, "light");
});

test("uses and follows the OS theme until a manual choice overrides it", async ({ page }) => {
  await openApp(page, "dark");
  await expectTheme(page, "dark");
  expect(await page.evaluate((key) => localStorage.getItem(key), themeKey)).toBeNull();

  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  await page.locator("#eclipse-toggle").click();
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  // Let media-query change events run before checking that the override survived.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectTheme(page, "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectTheme(page, "dark");
});

test("synchronizes choices between tabs and returns to the receiving tab's OS theme when removed", async ({ page, context }) => {
  await openApp(page, "light");
  const other = await context.newPage();
  await openApp(other, "dark");
  await expectTheme(page, "light");
  await expectTheme(other, "dark");

  await page.locator("#eclipse-toggle").click();
  await expectTheme(page, "dark");
  await expectTheme(other, "dark");
  await other.locator("#eclipse-toggle").click();
  await expectTheme(other, "light");
  await expectTheme(page, "light");

  await page.evaluate((key) => localStorage.removeItem(key), themeKey);
  await expectTheme(other, "dark");
  await other.emulateMedia({ colorScheme: "light" });
  await expectTheme(other, "light");
  expect(await other.evaluate((key) => localStorage.getItem(key), themeKey)).toBeNull();
  await other.close();
});

for (const failure of ["access", "write"]) {
  test(`theme switching and SQL conversion survive localStorage ${failure} errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (mode === "access") {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new DOMException("Storage is unavailable", "SecurityError"); }
        });
      } else {
        Storage.prototype.setItem = () => {
          throw new DOMException("Storage is full", "QuotaExceededError");
        };
      }
    }, failure);
    await openApp(page);
    await expectTheme(page, "light");
    await page.locator("#eclipse-toggle").click();
    await expectTheme(page, "dark");
    await page.locator("#oracleSql").fill("SELECT NVL(NULL, 'ok') FROM DUAL;");
    await expect(page.locator("#postgresHighlight")).toHaveText("SELECT COALESCE(NULL, 'ok');");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectTheme(page, "dark");
    await page.locator("#eclipse-toggle").click();
    await expectTheme(page, "light");
    await expect(page.locator("#postgresHighlight")).toHaveText("SELECT COALESCE(NULL, 'ok');");
    expect(errors).toEqual([]);
  });
}

test("theme changes preserve SQL, input selection, output selection and editor scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const sql = Array.from({ length: 60 }, (_, index) =>
    `SELECT CAST(${index} AS NUMBER) FROM DUAL; -- ${"long_comment_".repeat(4)}`
  ).join("\n");
  await page.locator("#oracleSql").fill(sql);
  await expect(page.locator("#postgresHighlight")).toContainText("CAST(59 AS NUMERIC)");

  const before = await page.evaluate(async () => {
    const input = document.querySelector("#oracleSql");
    const output = document.querySelector("#postgresHighlight");
    input.focus();
    input.setSelectionRange(20, 50, "backward");
    input.blur();
    // Finish native focus/selection scrolling before testing the theme change itself.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    input.scrollTop = 180;
    input.scrollLeft = 130;
    output.scrollTop = 210;
    output.scrollLeft = 110;
    return {
      input: input.value,
      output: output.textContent,
      selection: [input.selectionStart, input.selectionEnd, input.selectionDirection],
      scroll: [input.scrollTop, input.scrollLeft, output.scrollTop, output.scrollLeft]
    };
  });
  expect(before.scroll[0]).toBeGreaterThan(0);
  expect(before.scroll[2]).toBeGreaterThan(0);
  await page.locator("#eclipse-toggle").click();
  await expectTheme(page, "dark");
  const after = await page.evaluate(() => {
    const input = document.querySelector("#oracleSql");
    const output = document.querySelector("#postgresHighlight");
    return {
      input: input.value,
      output: output.textContent,
      selection: [input.selectionStart, input.selectionEnd, input.selectionDirection],
      scroll: [input.scrollTop, input.scrollLeft, output.scrollTop, output.scrollLeft]
    };
  });
  expect(after).toEqual(before);

  const selectionBefore = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#postgresHighlight"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selectionBefore).toContain("CAST(59 AS NUMERIC)");
  await page.evaluate((key) => {
    window.dispatchEvent(new StorageEvent("storage", {
      key,
      oldValue: "dark",
      newValue: "light",
      storageArea: localStorage
    }));
  }, themeKey);
  await expectTheme(page, "light");
  expect(await page.evaluate(() => window.getSelection().toString())).toBe(selectionBefore);
});

test("both themes fit a 320x480 viewport and the compact top-right switch respects reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.locator("#oracleSql").fill(Array.from({ length: 60 }, () =>
    "SELECT NVL(name, 'x'), ADD_MONTHS(created_at, 1), INSTR(code, '-') FROM t;"
  ).join("\n"));
  await expect(page.locator("#messagesDrawer")).toBeVisible();
  const colors = [];

  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.locator("#eclipse-toggle").click();
    await expectTheme(page, theme);
    const layout = await page.evaluate(() => {
      const button = document.querySelector("#eclipse-toggle");
      const rect = button.getBoundingClientRect();
      const topbar = document.querySelector(".topbar").getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        topbarBottom: topbar.bottom,
        editorBackground: getComputedStyle(document.querySelector(".editor-shell.output-shell")).backgroundColor,
        regions: ["#oracleSql", "#postgresHighlight", "#warningsList", "#clearOracleButton", "#copyPostgresButton"].map((selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
        }),
        transitionDurations: [button, ...button.querySelectorAll("*")].flatMap((element) => [
          getComputedStyle(element).transitionDuration,
          getComputedStyle(element, "::after").transitionDuration
        ])
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.button.width).toBe(48);
    expect(layout.button.height).toBe(48);
    expect(layout.button.x).toBeGreaterThan(layout.viewportWidth / 2);
    expect(layout.button.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.viewportWidth - layout.button.right).toBeLessThanOrEqual(32);
    expect(layout.button.y).toBeGreaterThanOrEqual(0);
    expect(layout.button.bottom).toBeLessThanOrEqual(layout.topbarBottom);
    for (const region of layout.regions) {
      expect(region.left, region.selector).toBeGreaterThanOrEqual(-1);
      expect(region.right, region.selector).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(region.top, region.selector).toBeGreaterThanOrEqual(-1);
      expect(region.bottom, region.selector).toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(region.height, region.selector).toBeGreaterThan(20);
    }
    for (const duration of layout.transitionDurations) {
      expect(duration.split(",").every((value) => parseFloat(value) === 0)).toBe(true);
    }
    colors.push(layout.editorBackground);
    await page.screenshot({ path: testInfo.outputPath(`theme-${theme}-320x480.png`), fullPage: true });
  }
  expect(colors[0]).toBe("rgb(255, 255, 255)");
  expect(colors[1]).not.toBe(colors[0]);
});
