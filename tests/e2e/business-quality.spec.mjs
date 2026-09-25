import { appFile } from "../../scripts/app-config.mjs";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const url = pathToFileURL(resolve(appFile)).href;
test.beforeEach(async ({ page }) => {
  page.__qaErrors = [];
  page.__externalRequests = [];
  page.on("pageerror", (error) => page.__qaErrors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) page.__externalRequests.push(request.url());
  });
  await page.goto(url);
});
test.afterEach(async ({ page }) => {
  expect(page.__qaErrors).toEqual([]);
  expect(page.__externalRequests).toEqual([]);
});

test("standalone file preserves SQL data and escapes executable HTML", async ({ page }) => {
  const source = "SELECT '$& <img src=x onerror=alert(1)>' AS data, NVL(NULL, 1) FROM DUAL;";
  await page.locator("#oracleSql").fill(source);
  await expect(page.locator("#postgresHighlight")).toHaveText(source.replace("NVL(NULL, 1)", "COALESCE(NULL, 1)").replace(" FROM DUAL", ""));
  await expect(page.locator("#postgresHighlight img")).toHaveCount(0);
  await expect(page.locator("#oracleSql")).toHaveValue(source);
  expect(await page.locator('link[rel="stylesheet"], script[src]').count()).toBe(0);
});

test("clear and undo restore the exact input, result and selection direction", async ({ page }) => {
  const input = page.locator("#oracleSql");
  const source = "-- 復元確認\nSELECT NVL(NULL, '日本語') FROM DUAL;\n";
  await input.fill(source);
  const output = await page.locator("#postgresHighlight").textContent();
  await input.evaluate((element) => element.setSelectionRange(3, 14, "backward"));
  await page.locator("#clearOracleButton").click();
  await expect(input).toHaveValue("");
  await expect(page.locator("#copyPostgresButton")).toBeDisabled();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await page.locator("#undoClearButton").click();
  await expect(input).toHaveValue(source);
  await expect(page.locator("#postgresHighlight")).toHaveText(output);
  expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd, element.selectionDirection])).toEqual([3, 14, "backward"]);
});

test("copy uses the current output and resets its existing button feedback", async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { async writeText(value) { window.__copied = value; } },
  }));
  await page.locator("#oracleSql").fill("SELECT NVL(NULL, 1) FROM DUAL;");
  await page.locator("#copyPostgresButton").click();
  await expect(page.locator("#copyPostgresButton")).toHaveAccessibleName("コピーしました");
  expect(await page.evaluate(() => window.__copied)).toBe("SELECT COALESCE(NULL, 1);");
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await page.clock.runFor(2000);
  await expect(page.locator("#copyPostgresButton")).toHaveAccessibleName("PostgreSQLをコピー");
});

for (const unavailableSelection of [false, true]) {
  test(`copy rejection handles fallback ${unavailableSelection ? "without a selection" : "with output selection"}`, async ({ page }) => {
    await page.evaluate((noSelection) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText() { throw new Error("denied"); } } });
      document.execCommand = () => false;
      if (noSelection) window.getSelection = () => null;
    }, unavailableSelection);
    await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
    await page.locator("#copyPostgresButton").click();
    await expect(page.locator("#copyPostgresButton")).toHaveAccessibleName("コピーできませんでした");
    await expect(page.locator("#copyPostgresButton")).not.toHaveAttribute("aria-busy", "true");
    if (!unavailableSelection) expect(await page.evaluate(() => window.getSelection().toString())).toBe("SELECT 1;");
  });
}

test("editing during an asynchronous copy suppresses stale success", async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText() { return new Promise((resolve) => { window.__completeCopy = resolve; }); } },
  }));
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await page.locator("#copyPostgresButton").click();
  await expect(page.locator("#copyPostgresButton")).toHaveAttribute("aria-busy", "true");
  await page.locator("#oracleSql").fill("SELECT 2 FROM DUAL;");
  await page.evaluate(() => window.__completeCopy());
  await expect(page.locator("#copyPostgresButton")).toHaveAccessibleName("PostgreSQLをコピー");
  await expect(page.locator("#postgresHighlight")).toHaveText("SELECT 2;");
});

test("syntax errors clear after correction and warnings have correct statement locations", async ({ page }) => {
  await page.locator("#oracleSql").fill("/* outer /* inner */ SELECT 1;");
  await expect(page.locator("#outputStatus")).toHaveText("入力に不備あり・要修正");
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;\nSELECT COUNT(*) FROM t WHERE ROWNUM <= 2 OR id=1;");
  await expect(page.locator("#warningsList")).toContainText("文2・2行目");
  await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
  await expect(page.locator("#messagesDrawer")).toBeHidden();
});

test("host SQL strings retain dollar replacement characters", async ({ page }) => {
  await page.locator("#oracleSql").fill('const sql = "SELECT \'$&\' FROM DUAL;";');
  await expect(page.locator("#postgresHighlight")).toHaveText('const sql = "SELECT \'$&\';";');
});

test("duplicate input events reuse a conversion and recovery still works", async ({ page }) => {
  await page.evaluate(() => {
    const convert = window.convertOracleToPostgres;
    window.__conversions = 0;
    window.convertOracleToPostgres = (...args) => { window.__conversions++; return convert(...args); };
  });
  const source = "SELECT NVL(NULL, 1) FROM DUAL;\n".repeat(1000);
  await page.locator("#oracleSql").fill(source);
  await page.locator("#oracleSql").evaluate((element) => {
    for (let i = 0; i < 3; i++) element.dispatchEvent(new Event("input"));
  });
  expect(await page.evaluate(() => window.__conversions)).toBe(1);
  await page.locator("#clearOracleButton").click();
  await page.locator("#undoClearButton").click();
  expect(await page.evaluate(() => window.__conversions)).toBe(2);
  await expect(page.locator("#oracleSql")).toHaveValue(source);
});

test("transient conversion exceptions allow an unchanged input to retry", async ({ page }) => {
  await page.evaluate(() => {
    const convert = window.convertOracleToPostgres;
    let first = true;
    window.convertOracleToPostgres = (...args) => {
      if (first) { first = false; throw new Error("temporary failure"); }
      return convert(...args);
    };
  });
  await page.locator("#oracleSql").evaluate((element) => {
    element.value = "SELECT 1 FROM DUAL;";
    element.dispatchEvent(new Event("input"));
  });
  await expect(page.locator("#outputStatus")).toHaveText("変換エラー");
  await page.locator("#oracleSql").dispatchEvent("input");
  await expect(page.locator("#postgresHighlight")).toHaveText("SELECT 1;");
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`existing buttons retain 30px height at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.locator("#oracleSql").fill("SELECT 1 FROM DUAL;");
    for (const id of ["clearOracleButton", "copyPostgresButton", "eclipse-toggle"]) {
      await expect(page.locator(`#${id}`)).toHaveCSS("height", "30px");
    }
    await page.locator("#clearOracleButton").click();
    await expect(page.locator("#undoClearButton")).toHaveCSS("height", "30px");
  });
}

test('IME composition keeps the last complete conversion until composition ends',async({page})=>{
 await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
 await page.locator('#oracleSql').evaluate(element=>{
  element.value='SELECT 2 FROM DUAL;';
  element.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
 });
 await expect(page.locator('#postgresHighlight')).toHaveText('SELECT 1;');
 await page.locator('#oracleSql').dispatchEvent('compositionend');
 await expect(page.locator('#postgresHighlight')).toHaveText('SELECT 2;');
});

test('an unresponsive clipboard returns control using the existing failure feedback',async({page})=>{
 await page.clock.install();
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(){return new Promise(()=>{});}}});
  document.execCommand=()=>false;
 });
 await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
 await page.locator('#copyPostgresButton').click();
 await page.clock.runFor(8000);
 await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('コピーできませんでした');
 await expect(page.locator('#copyPostgresButton')).not.toHaveAttribute('aria-busy','true');
 await page.clock.runFor(4000);
 await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('PostgreSQLをコピー');
});

test('visible conversion preserves numeric precision and full time components',async({page})=>{
 await page.locator('#oracleSql').fill("SELECT TO_CHAR(12.34), TO_DATE('2024-06-15 12:34:56','YYYY-MM-DD HH24:MI:SS') FROM DUAL;");
 await expect(page.locator('#postgresHighlight')).toContainText('TRIM_SCALE');
 await expect(page.locator('#postgresHighlight')).toContainText('MAKE_TIMESTAMP(2024, 6, 15, 12, 34, 56)');
 await expect(page.locator('#postgresHighlight')).not.toContainText('FM999999999');
});

test('sorting follows the source row limit and user-defined qualified functions are preserved',async({page})=>{
 await page.locator('#oracleSql').fill('SELECT * FROM t WHERE ROWNUM<=2 ORDER BY id;');
 await expect(page.locator('#postgresHighlight')).toHaveText('SELECT * FROM (SELECT * FROM t LIMIT 2) AS t ORDER BY id;');
 await page.locator('#oracleSql').fill('SELECT app . NVL(a,b) FROM t;');
 await expect(page.locator('#postgresHighlight')).toHaveText('SELECT app . NVL(a,b) FROM t;');
});

const largeSql = "SELECT NVL(NULL, 1) FROM DUAL;\n".repeat(2500);

test('large inputs convert in a worker while the document stays responsive', async ({ page }) => {
  await page.evaluate(() => {
    const convert = window.convertOracleToPostgres;
    window.__mainThreadConversions = 0;
    window.convertOracleToPostgres = (...args) => { window.__mainThreadConversions++; return convert(...args); };
  });
  const pending = await page.locator('#oracleSql').evaluate((element, source) => {
    element.value = source;
    element.dispatchEvent(new Event('input'));
    return {
      output: document.getElementById('postgresSql').value,
      copyDisabled: document.getElementById('copyPostgresButton').disabled,
      status: document.getElementById('outputStatus').textContent
    };
  }, largeSql);
  expect(pending).toEqual({output: '', copyDisabled: true, status: '未変換'});
  await expect(page.locator('#postgresSql')).toHaveValue('SELECT COALESCE(NULL, 1);\n'.repeat(2500), {timeout: 15000});
  await expect(page.locator('#copyPostgresButton')).toBeEnabled();
  expect(await page.evaluate(() => window.__mainThreadConversions)).toBe(0);
});

test('editing and clearing cancel obsolete worker results and undo can restart conversion', async ({ page }) => {
  await page.locator('#oracleSql').evaluate((element, source) => {
    element.value = source;
    element.dispatchEvent(new Event('input'));
    element.value = 'SELECT 42 FROM DUAL;';
    element.dispatchEvent(new Event('input'));
  }, largeSql);
  await expect(page.locator('#postgresHighlight')).toHaveText('SELECT 42;');
  await page.locator('#oracleSql').evaluate((element, source) => {
    element.value = source;
    element.dispatchEvent(new Event('input'));
    document.getElementById('clearOracleButton').click();
  }, largeSql);
  await expect(page.locator('#oracleSql')).toHaveValue('');
  await expect(page.locator('#postgresSql')).toHaveValue('');
  await expect(page.locator('#copyPostgresButton')).toBeDisabled();
  await page.locator('#undoClearButton').click();
  await expect(page.locator('#postgresSql')).toHaveValue('SELECT COALESCE(NULL, 1);\n'.repeat(2500), {timeout: 15000});
});

test('large inputs still work when worker creation is unavailable', async ({ page }) => {
  await page.evaluate(() => { window.Worker = class { constructor() { throw new Error('worker blocked'); } }; });
  await page.locator('#oracleSql').fill(largeSql);
  await expect(page.locator('#postgresSql')).toHaveValue('SELECT COALESCE(NULL, 1);\n'.repeat(2500));
});

test('a pending conversion restarts after back-forward cache restoration', async ({ page }) => {
  await page.locator('#oracleSql').evaluate((element, source) => {
    element.value = source;
    element.dispatchEvent(new Event('input'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
  }, largeSql);
  await expect(page.locator('#postgresSql')).toHaveValue('SELECT COALESCE(NULL, 1);\n'.repeat(2500), {timeout: 15000});
});
