import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from '../helpers/load-app.mjs';

const app = () => loadApp({ file: process.env.BOUNDARY_QA_SOURCE });
const convert = (source) => app().convertOracleToPostgres(source);

for (const expression of ["CAST(NULL AS VARCHAR2(10))", "CAST(NULL AS DATE)", "TRIM(' ')"]) {
  test(`DECODE recognizes nullable search expression ${expression}`, () => {
    const result = convert(`SELECT DECODE(NULL,${expression},1,2) FROM DUAL;`);
    assert.match(result.sql, /IS NOT DISTINCT FROM/);
    if (!expression.includes('DATE')) assert.match(result.sql, /IS NOT DISTINCT FROM NULLIF/);
  });
}

for (const expression of [
  "NVL(CAST(NULL AS VARCHAR2(20)),.5)", "NVL2(NULL,'x',-.5)", "DECODE(2,1,'x',.5)",
  'TO_CHAR(TRUNC(.55,1))', 'TO_CHAR(ROUND(.55,1))', 'TO_CHAR(ABS(-.5))', 'TO_CHAR(MOD(1.5,1))',
]) {
  test(`numeric text retains fractional precision and leading-dot notation: ${expression}`, () => {
    const result = convert(`SELECT ${expression} FROM DUAL;`);
    assert.match(result.sql, /TRIM_SCALE/);
    assert.ok(result.sql.includes("'^(-?)0[.]'"));
    assert.doesNotMatch(result.sql, /FM999999999/);
  });
}

test('numeric function inference does not mistake unknown or date operands for numbers', () => {
  const { context } = app();
  for (const expression of ['ROUND(price,2)', 'ABS(amount)', 'app.ROUND(1,2)', "TRUNC(DATE '2024-01-01')"]) {
    assert.notEqual(context.explicitExpressionType(expression), 'numeric', expression);
  }
  assert.equal(context.explicitExpressionType('ROUND(ABS(-.125),2)+TRUNC(.55,1)'), 'numeric');
});

test('explicit Oracle DATE subtraction returns numeric days and timestamp subtraction stays an interval', () => {
  const result = convert("SELECT DATE '2024-01-02'-DATE '2024-01-01' FROM DUAL;");
  assert.equal(result.sql, "SELECT (EXTRACT(EPOCH FROM (TIMESTAMP '2024-01-02'-TIMESTAMP '2024-01-01')) / 86400);");
  const timestamp = "SELECT TIMESTAMP '2024-01-02 00:00:00'-TIMESTAMP '2024-01-01 00:00:00';";
  assert.equal(convert(timestamp).sql, timestamp);
  assert.equal(convert('SELECT end_date-start_date FROM t;').sql, 'SELECT end_date-start_date FROM t;');
});

test('Oracle left-associative concatenation and arithmetic retain their numeric result', () => {
  assert.equal(convert("SELECT '2'||3+4 FROM DUAL;").sql,
    "SELECT CAST(NULLIF(CONCAT('2',CAST(3 AS TEXT)), '') AS NUMERIC)+4;");
  assert.match(convert("SELECT 'A'||CAST(NULL AS NUMBER) FROM DUAL;").sql, /NULLIF\(CONCAT/);
  assert.equal(convert("SELECT '2'*'3' FROM DUAL;").sql,
    "SELECT CAST(NULLIF('2', '') AS NUMERIC)*CAST(NULLIF('3', '') AS NUMERIC);");
});

test('repeated statements reuse conversion while retaining every warning location', () => {
  const { context } = app();
  const core = context.convertOracleSqlContent;
  let calls = 0;
  context.convertOracleSqlContent = (...args) => { calls++; return core(...args); };
  const source = "SELECT INSTR(code,'x') FROM t;\n".repeat(100);
  const result = context.convertOracleToPostgres(source);
  assert.ok(calls <= 3, `Repeated SQL ran ${calls} complete conversions`);
  assert.equal(result.diagnostics.length, 100);
  assert.deepEqual(Array.from(result.diagnostics, (d) => [d.statement, d.line]),
    Array.from({ length: 100 }, (_, i) => [i + 1, i + 1]));
  const previousCalls = calls;
  assert.equal(context.convertOracleToPostgres(source).sql, result.sql);
  assert.ok(calls > previousCalls, 'SQL must not be cached across conversion calls');
});

test('diagnostics retain original line numbers after multiline host strings', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    const result = convert(`const sql = "SELECT${newline}1 FROM DUAL;";${newline}SELECT INSTR(code,'x') FROM t;`);
    assert.equal(result.diagnostics.at(-1).line, 3);
    assert.equal(result.diagnostics.at(-1).statement, 2);
  }
});

test('editing releases an obsolete clipboard operation before its promise settles', async () => {
  const { context, elements } = app();
  const input = elements.get('oracleSql');
  input.value = 'SELECT 1 FROM DUAL;';
  context.convert();
  const writes = [];
  let completeOld;
  context.navigator.clipboard.writeText = (value) => {
    writes.push(value);
    return writes.length === 1 ? new Promise((resolve) => { completeOld = resolve; }) : Promise.resolve();
  };
  const first = context.copyPostgres();
  input.value = 'SELECT 2 FROM DUAL;';
  context.convert();
  assert.equal(elements.get('copyPostgresButton').getAttribute('aria-busy'), null);
  await context.copyPostgres();
  assert.deepEqual(writes, ['SELECT 1;', 'SELECT 2;']);
  completeOld();
  await first;
  assert.equal(elements.get('copyPostgresButton').getAttribute('aria-label'), 'コピーしました');
});

test('composition updates existing counters/status and clear removes the busy state', () => {
  const { context, elements } = app();
  const input = elements.get('oracleSql');
  input.value = 'SELECT 1;';
  context.convert();
  input.value = "SELECT\n'あ' FROM DUAL;";
  input.dispatchEvent({ type: 'input', isComposing: true });
  assert.equal(elements.get('inputMetrics').textContent, '2 行');
  assert.equal(elements.get('outputStatus').textContent, '未変換');
  assert.equal(elements.get('postgresHighlight').getAttribute('aria-busy'), 'true');
  context.clearOracle();
  assert.equal(elements.get('postgresHighlight').getAttribute('aria-busy'), null);
  input.value = 'SELECT 3 FROM DUAL;';
  input.dispatchEvent({ type: 'input' });
  assert.equal(elements.get('postgresSql').value, 'SELECT 3;');
});
