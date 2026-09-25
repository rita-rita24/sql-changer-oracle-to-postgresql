import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.__boundaryErrors = [];
  page.on('pageerror', (error) => page.__boundaryErrors.push(error.message));
  await page.goto('/');
});
test.afterEach(async ({ page }) => expect(page.__boundaryErrors).toEqual([]));

test('a new result can be copied immediately while an obsolete clipboard request remains unresolved', async ({ page }) => {
  await page.evaluate(() => {
    window.__writes = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText(value) {
        window.__writes.push(value);
        return window.__writes.length === 1 ? new Promise((resolve) => { window.__oldCopy = resolve; }) : Promise.resolve();
      },
    } });
  });
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.locator('#copyPostgresButton').click();
  await expect(page.locator('#copyPostgresButton')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#oracleSql').fill('SELECT 2 FROM DUAL;');
  await expect(page.locator('#copyPostgresButton')).not.toHaveAttribute('aria-busy', 'true');
  await page.locator('#copyPostgresButton').click();
  expect(await page.evaluate(() => window.__writes)).toEqual(['SELECT 1;', 'SELECT 2;']);
  await page.evaluate(() => window.__oldCopy());
  await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('コピーしました');
});

test('clipboard failure preserves a newly selected output range even when focus is unchanged', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 123 FROM DUAL;');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText() { return new Promise((_, reject) => { window.__rejectCopy = reject; }); },
    } });
    window.__fallbackCalls = 0;
    document.execCommand = () => { window.__fallbackCalls++; return false; };
    document.querySelector('#postgresHighlight').focus();
    window.__copying = window.copyPostgres();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#postgresHighlight .tok-number'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    window.__selectedOutput = getSelection().toString();
  });
  await page.evaluate(async () => { window.__rejectCopy(new Error('denied')); await window.__copying; });
  expect(await page.evaluate(() => getSelection().toString())).toBe('123');
  expect(await page.evaluate(() => window.__fallbackCalls)).toBe(0);
  await expect(page.locator('#postgresHighlight')).toBeFocused();
});

test('a successful legacy clipboard fallback restores the original backward selection', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 123 FROM DUAL;');
  const result = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText() { throw new Error('denied'); },
    } });
    document.execCommand = () => { window.__fallbackText = getSelection().toString(); return true; };
    document.querySelector('#postgresHighlight').focus();
    const text = document.querySelector('#postgresHighlight .tok-number').firstChild;
    getSelection().setBaseAndExtent(text, 3, text, 0);
    await window.copyPostgres();
    return { copied: window.__fallbackText, selected: getSelection().toString(), anchor: getSelection().anchorOffset, focus: getSelection().focusOffset };
  });
  expect(result).toEqual({ copied: 'SELECT 123;', selected: '123', anchor: 3, focus: 0 });
  await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('コピーしました');
});

test('composition keeps counters and conversion status current and recovers after clear', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.locator('#oracleSql').evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = "SELECT\n'あ' FROM DUAL;";
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
  });
  await expect(page.locator('#inputMetrics')).toHaveText('2 行');
  await expect(page.locator('#outputStatus')).toHaveText('未変換');
  await expect(page.locator('#postgresHighlight')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#clearOracleButton').click();
  await expect(page.locator('#postgresHighlight')).not.toHaveAttribute('aria-busy', 'true');
  await page.locator('#oracleSql').fill('SELECT 3 FROM DUAL;');
  await expect(page.locator('#postgresHighlight')).toHaveText('SELECT 3;');
});

test('page restoration resumes a pending composition and releases obsolete clipboard state', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText() { return new Promise(() => {}); } } });
    void window.copyPostgres();
    const input = document.querySelector('#oracleSql');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = "SELECT '復帰' FROM DUAL;";
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#postgresHighlight')).toHaveText("SELECT '復帰';");
  await expect(page.locator('#copyPostgresButton')).toBeEnabled();
  await expect(page.locator('#copyPostgresButton')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#postgresHighlight')).not.toHaveAttribute('aria-busy', 'true');
});

test('worker conversion preserves repeated diagnostic locations and updated scalar rules', async ({ page }) => {
  const source = "SELECT DECODE(NULL,CAST(NULL AS VARCHAR2(10)),1,2), INSTR(code,'x') FROM t;\n".repeat(1200);
  await page.locator('#oracleSql').evaluate((input, source) => {
    input.value = source;
    input.dispatchEvent(new Event('input'));
  }, source);
  await expect(page.locator('#copyPostgresButton')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#postgresHighlight')).toContainText('IS NOT DISTINCT FROM');
  await expect(page.locator('#warningsList li')).toHaveCount(1200);
  await expect(page.locator('#warningsList li').last()).toContainText('文1200・1200行目:');
});
