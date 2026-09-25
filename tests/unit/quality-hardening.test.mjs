import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from '../helpers/load-app.mjs';

const app = () => loadApp({ file: process.env.QUALITY_QA_SOURCE });
const convert = (sql) => app().convertOracleToPostgres(sql);

for (const expression of ['1/2', '1+0.25', '(3-1)/4', '1*-0.25', '-CAST(0.5 AS NUMBER)']) {
  test(`numeric formatting retains the fractional result of ${expression}`, () => {
    const result = convert(`SELECT TO_CHAR(${expression}) FROM DUAL;`);
    assert.doesNotMatch(result.sql, /FM999999999/);
    assert.match(result.sql, /TRIM_SCALE/);
  });
}

test('arithmetic type inference requires explicit numeric operands', () => {
  const { context } = app();
  for (const value of ['price/2', 'a+b', "'1/2'", 'app.TO_NUMBER(x)', 'CASE WHEN 1=1 THEN 1 ELSE 2 END']) {
    assert.notEqual(context.explicitExpressionType(value), 'numeric', value);
  }
  assert.equal(context.explicitExpressionType('1/* + text */ / 2'), 'numeric');
});

test('LPAD coerces explicit numeric arguments and truncates fractional lengths', () => {
  assert.equal(convert("SELECT LPAD('x',3.9,'0') FROM DUAL;").sql, "SELECT LPAD('x', CAST(TRUNC(CAST(3.9 AS NUMERIC)) AS INTEGER), '0');");
  const result = convert("SELECT LPAD(CAST(1 AS NUMBER),3,CAST(0 AS NUMBER)) FROM DUAL;");
  assert.match(result.sql, /TRIM_SCALE\(CAST\(CAST\(1 AS NUMERIC\) AS NUMERIC\)\)/);
  assert.match(result.sql, /TRIM_SCALE\(CAST\(CAST\(0 AS NUMERIC\) AS NUMERIC\)\)/);
});

test('numeric TRUNC supports floating inputs and fractional precision arguments', () => {
  assert.equal(convert('SELECT TRUNC(CAST(1.23 AS BINARY_DOUBLE),1.9) FROM DUAL;').sql,
    'SELECT TRUNC(CAST(CAST(1.23 AS DOUBLE PRECISION) AS NUMERIC), CAST(TRUNC(CAST(1.9 AS NUMERIC)) AS INTEGER));');
});

test('diagnostics point at SQL after leading multiline comments', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    const result = convert(`SELECT 1; /* comment${newline} */${newline}SELECT INSTR(code,'x') FROM t;`);
    assert.equal(result.diagnostics[0].line, 3);
    assert.equal(result.diagnostics[0].statement, 2);
  }
});

test('composition renders provisional text and hides the initial overlay without converting', () => {
  const { context, elements } = app();
  const input = elements.get('oracleSql');
  let calls = 0;
  const original = context.convertOracleToPostgres;
  context.convertOracleToPostgres = (...args) => { calls++; return original(...args); };
  input.value = "SELECT 'にほん' FROM DUAL;";
  input.dispatchEvent({ type: 'input', isComposing: true });
  assert.equal(elements.get('inputEmptyState').hidden, true);
  assert.match(elements.get('oracleHighlight').innerHTML, /にほん/);
  assert.equal(elements.get('copyPostgresButton').disabled, true);
  assert.equal(calls, 0);
  input.dispatchEvent({ type: 'compositionend' });
  assert.equal(elements.get('postgresSql').value, "SELECT 'にほん';");
  assert.equal(calls, 1);
});

test('copy fallback cannot steal focus or selection after the user resumes navigation', async () => {
  const { context, elements } = app();
  const input = elements.get('oracleSql');
  input.value = 'SELECT 1 FROM DUAL;';
  context.convert();
  elements.get('copyPostgresButton').focus();
  let reject;
  context.navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
  let fallback = 0;
  context.document.execCommand = () => { fallback++; return false; };
  const copying = context.copyPostgres();
  input.focus();
  input.setSelectionRange(1, 3);
  reject(new Error('denied'));
  await copying;
  assert.equal(fallback, 0);
  assert.equal(context.document.activeElement, input);
  assert.equal(elements.get('copyPostgresButton').getAttribute('aria-label'), 'コピーできませんでした');
});

test('modified Tab shortcuts leave the editor intact', () => {
  const { elements } = app();
  const input = elements.get('oracleSql');
  input.value = 'SELECT 1;';
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    let prevented = false;
    input.dispatchEvent({ type: 'keydown', key: 'Tab', [modifier]: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(input.value, 'SELECT 1;');
  }
});

test('large paste event bursts are reconciled once with the final input value', () => {
  const { context, elements, advanceTime } = app();
  const input = elements.get('oracleSql');
  const convertInput = context.convert;
  let calls = 0;
  context.convert = () => { calls++; convertInput(); };
  input.value = '-- ' + 'x'.repeat(60000);
  for (let i = 0; i < 1000; i++) input.dispatchEvent({ type: 'input' });
  assert.equal(calls, 1);
  input.value = 'SELECT 42 FROM DUAL;';
  input.dispatchEvent({ type: 'input' });
  advanceTime(0);
  assert.equal(calls, 2);
  assert.equal(elements.get('postgresSql').value, 'SELECT 42;');
});

for (const [value, format] of [['2024-01-01 24:00:00', 'YYYY-MM-DD HH24:MI:SS'], ['20240101235960', 'YYYYMMDDHH24MISS']]) {
  test(`invalid Oracle time ${value} cannot become a valid numeric value`, () => {
    const result = convert(`SELECT TO_DATE('${value}','${format}') FROM DUAL;`);
    assert.equal(result.sql, 'SELECT MAKE_TIMESTAMP(0, 1, 1, 0, 0, 0);');
  });
}
