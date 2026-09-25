import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from '../helpers/load-app.mjs';
import { databaseCases } from '../fixtures/comment-database-cases.mjs';

for (const prefix of ['nq', 'NQ', 'nQ', 'Nq']) {
  test(`${prefix} quoting protects SQL-looking text and semicolons`, () => {
    const { context, convertOracleToPostgres: convert } = loadApp();
    const literal = `${prefix}'[it's NVL(x,0); DATE -- ") ]'`;
    const source = `SELECT ${literal} FROM DUAL;\nSELECT INSTR(code,'x') FROM t;`;
    const result = convert(source);
    assert.equal(result.sql, `SELECT ${literal};\nSELECT INSTR(code, 'x') FROM t;`);
    assert.equal(result.status, 'review-required');
    assert.equal(context.splitSqlStatements(source).length, 2);
    assert.equal(result.diagnostics.at(-1).line, 2);
    assert.equal(result.diagnostics.at(-1).statement, 2);
    assert.ok(result.warnings.some((warning) => warning.includes("q'[...]'")));
  });
}

test('alternative quotes read Unicode delimiters as whole characters', () => {
  const { context, convertOracleToPostgres: convert } = loadApp();
  for (const prefix of ['q', 'nq']) for (const delimiter of ['😀', '漢', '!', "'"]) {
    const literal = `${prefix}'${delimiter}it's NUMBER; NVL(x,0)${delimiter}'`;
    const source = `SELECT ${literal} FROM DUAL;`;
    assert.equal(convert(source).sql, `SELECT ${literal};`);
    assert.equal(convert(source).status, 'review-required');
    assert.equal(context.splitSqlStatements(source).length, 1);
  }
  assert.equal(convert("SELECT nq'[unclosed").status, 'invalid-input');
});

test('quoted comment markers never trigger trailing-newline insertion', () => {
  const { context } = loadApp();
  for (const expression of ["'-- note'", '"-- name"', "q'[-- note]'", "nq'[-- note]'", '/* -- note */']) {
    assert.equal(context.trimSqlFragment(`  ${expression}  `), expression);
  }
  assert.equal(context.trimSqlFragment('  1 -- note\r\n  '), '1 -- note\n');
});

test('function comment boundaries keep generated SQL structurally balanced', () => {
  const { context, convertOracleToPostgres: convert } = loadApp();
  for (const fixture of databaseCases) {
    const result = convert(fixture.source);
    assert.equal(context.hasUnbalancedParentheses(result.sql), false, `${fixture.id}: ${result.sql}`);
    assert.equal(context.hasUnterminatedSqlDelimiter(result.sql), false, fixture.id);
    for (const { start, end } of context.getSqlProtectedRanges(fixture.source)) {
      if (fixture.source.startsWith('--', start)) assert.ok(result.sql.includes(fixture.source.slice(start, end)), fixture.id);
    }
  }
});

test('simple ROWNUM limits keep comments and filter before sorting', () => {
  const { convertOracleToPostgres: convert } = loadApp();
  assert.equal(convert('SELECT * FROM t WHERE x=1 -- preserve filter\nAND ROWNUM <= 2 ORDER BY id;').sql,
    'SELECT * FROM (SELECT * FROM t WHERE x=1 -- preserve filter\n LIMIT 2) AS t ORDER BY id;');
  for (const source of [
    'SELECT --+ FIRST_ROWS(2)\n * FROM t WHERE ROWNUM<=2 ORDER BY id;',
    'SELECT * FROM t WHERE x=1 -- complex\n OR ROWNUM<=2;',
    'SELECT * FROM t WHERE ROWNUM<=2 -- complex\n AND EXISTS (SELECT 1 FROM u);',
  ]) assert.equal(convert(source).sql, source);
});

test('composition state protects Tab and Escape even without keyboard composition flags', () => {
  const { elements } = loadApp();
  const input = elements.get('oracleSql');
  input.value = "SELECT '途中' FROM DUAL;";
  input.dispatchEvent({ type: 'compositionstart' });
  for (const key of ['Tab', 'Escape']) {
    let prevented = false;
    input.dispatchEvent({ type: 'keydown', key, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(input.value, "SELECT '途中' FROM DUAL;");
    assert.equal(elements.get('postgresSql').value, '');
  }
  input.dispatchEvent({ type: 'compositionend' });
  assert.equal(elements.get('postgresSql').value, "SELECT '途中';");
});
