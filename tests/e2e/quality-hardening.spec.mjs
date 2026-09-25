import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.__qualityErrors = [];
  page.on('pageerror', (error) => page.__qualityErrors.push(error.message));
  await page.goto('/');
});
test.afterEach(async ({ page }) => expect(page.__qualityErrors).toEqual([]));

test('IME text is visible from the first character, and final input converts once', async ({ page }) => {
  await page.locator('#oracleSql').evaluate((input) => {
    const convert = window.convertOracleToPostgres;
    window.__calls = 0;
    window.convertOracleToPostgres = (...args) => { window.__calls++; return convert(...args); };
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = "SELECT 'にほん' FROM DUAL;";
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
  });
  await expect(page.locator('#oracleHighlight')).toHaveText("SELECT 'にほん' FROM DUAL;");
  await expect(page.locator('#inputEmptyState')).toBeHidden();
  await expect(page.locator('#copyPostgresButton')).toBeDisabled();
  expect(await page.evaluate(() => window.__calls)).toBe(0);
  await page.locator('#oracleSql').dispatchEvent('compositionend');
  await page.locator('#oracleSql').dispatchEvent('input');
  await expect(page.locator('#postgresHighlight')).toHaveText("SELECT 'にほん';");
  expect(await page.evaluate(() => window.__calls)).toBe(1);
});

test('Tab indentation participates in native undo and redo', async ({ page }) => {
  const input = page.locator('#oracleSql');
  await input.evaluate((element) => {
    element.value = 'SELECT 1 FROM DUAL;';
    element.dispatchEvent(new Event('input'));
    element.focus();
    element.setSelectionRange(0, 0);
  });
  await input.press('Tab');
  await expect(input).toHaveValue('  SELECT 1 FROM DUAL;');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('SELECT 1 FROM DUAL;');
  await expect(page.locator('#postgresHighlight')).toHaveText('SELECT 1;');
  await input.press('ControlOrMeta+Shift+z');
  await expect(input).toHaveValue('  SELECT 1 FROM DUAL;');
});

test('a changed source that produces the same output preserves its selected result', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.locator('#postgresHighlight').focus();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#postgresHighlight'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const input = document.querySelector('#oracleSql');
    input.value = 'SELECT 1;';
    input.dispatchEvent(new Event('input'));
  });
  expect(await page.evaluate(() => getSelection().toString())).toBe('SELECT 1;');
});

test('a delayed clipboard rejection does not steal the new input selection', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText() { return new Promise((_, reject) => { window.__rejectCopy = reject; }); }
    } });
    document.execCommand = () => { window.__fallback = true; return false; };
  });
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.locator('#copyPostgresButton').click();
  await page.locator('#oracleSql').focus();
  await page.locator('#oracleSql').evaluate((input) => input.setSelectionRange(1, 6, 'backward'));
  await page.evaluate(() => window.__rejectCopy(new Error('denied')));
  await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('コピーできませんでした');
  await expect(page.locator('#oracleSql')).toBeFocused();
  expect(await page.locator('#oracleSql').evaluate((input) => [input.selectionStart, input.selectionEnd, input.selectionDirection])).toEqual([1, 6, 'backward']);
  expect(await page.evaluate(() => Boolean(window.__fallback))).toBe(false);
});

test('the final empty input line remains aligned with the syntax highlight when scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;\n'.repeat(90));
  await page.locator('#oracleSql').evaluate((input) => { input.scrollTop = input.scrollHeight; input.dispatchEvent(new Event('scroll')); });
  const alignment = await page.evaluate(() => {
    const input = document.querySelector('#oracleSql');
    const highlight = document.querySelector('#oracleHighlight');
    return { input: input.scrollTop, highlight: highlight.scrollTop };
  });
  expect(alignment.input).toBeGreaterThan(0);
  expect(Math.abs(alignment.input - alignment.highlight)).toBeLessThanOrEqual(1);
});

test('worker transport failures recover and clear the output busy state', async ({ page }) => {
  await page.evaluate(() => {
    window.Worker = class {
      postMessage() { queueMicrotask(() => this.onmessageerror(new Event('messageerror', { cancelable: true }))); }
      terminate() {}
    };
  });
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;\n'.repeat(3200));
  await expect(page.locator('#postgresSql')).toHaveValue('SELECT 1;\n'.repeat(3200), { timeout: 15000 });
  await expect(page.locator('#postgresHighlight')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#copyPostgresButton')).toBeEnabled();
});

test('composition cancels old workers before they can change the result', async ({ page }) => {
  await page.locator('#oracleSql').fill('SELECT 1 FROM DUAL;');
  await page.locator('#oracleSql').evaluate((input) => {
    window.Worker = class { constructor() { window.__worker = this; } postMessage() {} terminate() { this.terminated = true; } };
    input.value = 'SELECT 2 FROM DUAL;\n'.repeat(3200);
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = "SELECT '途中' FROM DUAL;";
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
    window.__worker.onmessage({ data: { result: window.convertOracleToPostgres('SELECT 999 FROM DUAL;') } });
  });
  expect(await page.evaluate(() => window.__worker.terminated)).toBe(true);
  await expect(page.locator('#postgresHighlight')).not.toContainText('999');
  await expect(page.locator('#oracleHighlight')).toHaveText("SELECT '途中' FROM DUAL;");
  await page.locator('#oracleSql').dispatchEvent('compositionend');
  await expect(page.locator('#postgresHighlight')).toHaveText("SELECT '途中';");
});

test('preview routes all app URLs to the selected HTML and keeps development files private', async ({ page }) => {
  for (const path of ['/', '/index.html', '/sql-changer-oracle-to-postgresql.html']) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('id="oracleSql"');
  }
  for (const path of ['/package.json', '/.git/config', '/scripts/app-config.mjs', '/%2e%2e/README.md', '/%zz']) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
});
