import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.__commentErrors = [];
  page.on('pageerror', (error) => page.__commentErrors.push(error.message));
  await page.goto('/');
});
test.afterEach(async ({ page }) => expect(page.__commentErrors).toEqual([]));

test('quoted SQL-looking text remains literal in both synchronous and worker conversion', async ({ page }) => {
  const statement = "SELECT nq'[it's NVL(x,0); DATE -- \")]' FROM DUAL;\n";
  for (const count of [1, 1400, 1]) {
    await page.locator('#oracleSql').evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }, statement.repeat(count));
    await expect(page.locator('#copyPostgresButton')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#postgresSql')).toHaveValue(statement.replace(' FROM DUAL', '').repeat(count));
    await expect(page.locator('#outputStatus')).toHaveAttribute('data-state', 'review-required');
    await expect(page.locator('#warningsList li')).toHaveCount(count);
  }
});

test('copy includes required comment newlines exactly as displayed', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(value) { window.__commentCopy = value; },
    } });
  });
  await page.locator('#oracleSql').fill('SELECT NVL(1 -- keep\n,2) FROM DUAL;');
  await page.locator('#copyPostgresButton').click();
  const output = await page.locator('#postgresSql').inputValue();
  expect(output).toContain('-- keep\n');
  expect(await page.locator('#postgresHighlight').textContent()).toBe(output);
  expect(await page.evaluate(() => window.__commentCopy)).toBe(output);
  await expect(page.locator('#copyPostgresButton')).toHaveAccessibleName('コピーしました');
});

test('Tab and Escape do not alter an active composition when key flags are absent', async ({ page }) => {
  await page.locator('#oracleSql').fill("SELECT '日本' FROM DUAL;");
  const during = await page.locator('#oracleSql').evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = "SELECT '日本語' FROM DUAL;";
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
    for (const key of ['Tab', 'Escape']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    return input.value;
  });
  expect(during).toBe("SELECT '日本語' FROM DUAL;");
  await expect(page.locator('#postgresSql')).toHaveValue("SELECT '日本';");
  await expect(page.locator('#copyPostgresButton')).toBeDisabled();
  await page.locator('#oracleSql').dispatchEvent('compositionend');
  await expect(page.locator('#postgresSql')).toHaveValue("SELECT '日本語';");
  await expect(page.locator('#copyPostgresButton')).toBeEnabled();
});
