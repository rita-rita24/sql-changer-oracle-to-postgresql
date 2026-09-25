import { expect, test } from '@playwright/test';

test('new scalar rules reach both live conversion and its worker without stale output', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const statement = "SELECT INSTR('abc','',1,1), NVL2(1,'',.5), REPLACE('a','a',NULL), MOD(7,0) FROM DUAL;";
  for (const repeats of [1, 1400, 1]) {
    await page.locator('#oracleSql').evaluate((input, source) => {
      input.value = source;
      input.dispatchEvent(new Event('input'));
    }, `${statement}\n`.repeat(repeats));
    await expect(page.locator('#copyPostgresButton')).toBeEnabled({ timeout: 15000 });
    await expect.poll(async () => {
      const sql = await page.locator('#postgresHighlight').textContent();
      return [sql.match(/INSTR\(/g)?.length || 0, sql.match(/THEN CAST\(NULL AS TEXT\)/g)?.length || 0];
    }, { timeout: 15000 }).toEqual([0, repeats]);
    await expect(page.locator('#postgresHighlight')).toContainText('CAST(NULL AS NUMERIC)');
  }
  expect(errors).toEqual([]);
});
