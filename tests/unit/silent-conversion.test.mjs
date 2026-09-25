import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from '../helpers/load-app.mjs';
import { databaseCases } from '../fixtures/semantic-database-cases.mjs';

const convert = (sql) => loadApp().convertOracleToPostgres(sql);

test('discovery corpus cannot accept new exceptions or skip type checks', () => {
  assert.ok(databaseCases.length > 2600);
  assert.equal(new Set(databaseCases.map((fixture) => fixture.id)).size, databaseCases.length);
  for (const fixture of databaseCases) {
    assert.equal(fixture.compareColumnTypes, true, fixture.id);
    if (!/^(?:silent|holdout|pad)-/.test(fixture.id)) continue;
    assert.equal(fixture.exception, undefined, fixture.id);
    assert.equal(fixture.expectedErrors, undefined, fixture.id);
  }
});

test('NULL-only numeric and text results retain their Oracle return families', () => {
  assert.equal(convert("SELECT INSTR('abc','',1,1) FROM DUAL").sql, 'SELECT CAST(NULL AS NUMERIC)');
  assert.match(convert("SELECT NVL2(1,'',.5) FROM DUAL").sql, /THEN CAST\(NULL AS TEXT\)/);
  assert.equal(convert("SELECT TO_CHAR(NULL) FROM DUAL").sql, 'SELECT CAST(NULL AS TEXT)');
  assert.equal(convert("SELECT NVL(TRIM(' '),.5) FROM DUAL").sql, 'SELECT COALESCE(NULL, .5)');
});

test('CHAR padding survives a no-op NULLIF and text function boundaries', () => {
  assert.equal(convert("SELECT NULLIF(CAST('x' AS CHAR(3)), '') FROM DUAL").sql, "SELECT CAST('x' AS CHAR(3))");
  for (const expression of ["TO_CHAR(CAST('x' AS CHAR(3)))", "LENGTH(CAST('x' AS CHAR(3)))", "SUBSTR(CAST('x' AS CHAR(3)),-2,2)"]) {
    const sql = convert(`SELECT ${expression} FROM DUAL`).sql;
    assert.match(sql, /REPEAT\(' ', GREATEST\(3 - CHAR_LENGTH/);
    assert.match(sql, /CAST\(CAST\('x' AS CHAR\(3\)\) AS TEXT\)/);
  }
});

test('MOD zero-divisor correction binds volatile arguments exactly once', () => {
  const result = convert('SELECT MOD(CAST(orders.NEXTVAL AS NUMBER),0) FROM DUAL');
  assert.equal(result.sql.match(/nextval\('orders'\)/g)?.length, 1);
  assert.match(result.sql, /CASE WHEN "__oc_1" = 0 THEN "__oc_0"/);
  assert.match(result.sql, /OFFSET 0/);
  assert.match(result.sql, /MOD\("__oc_0", NULLIF\("__oc_1", 0\)\)/);
});

test('nested Oracle DATE arithmetic produces numeric days', () => {
  const result = convert("SELECT ((DATE '2024-01-01'+1)-.5)-DATE '2024-01-01' FROM DUAL");
  assert.match(result.sql, /EXTRACT\(EPOCH/);
  assert.match(result.sql, /\/ 86400/);
  assert.equal(result.sql.match(/INTERVAL '1 day'/g)?.length, 2);
});

test('empty literals are normalized in predicates, but COMMENT remains literal-only SQL', () => {
  assert.match(convert("SELECT COUNT(*) FROM DUAL WHERE '' IS NULL").sql, /WHERE NULLIF\('', ''\) IS NULL/);
  assert.equal(convert("COMMENT ON TABLE t IS ''").sql, 'COMMENT ON TABLE t IS NULL');
  const source = "SELECT app.TRIM(' '), 'REPLACE(x,x,NULL)' /* TRIM(' ') */ FROM t";
  assert.equal(convert(source).sql, source);
});

test('national empty literals stay valid SQL and supplementary LENGTH retains UTF-16 units', () => {
  assert.equal(convert("SELECT N'' FROM DUAL").sql, "SELECT NULLIF(N'', N'')");
  assert.equal(convert("SELECT LENGTH(N'😀') FROM DUAL").sql, 'SELECT 2');
  assert.equal(convert("SELECT LENGTH(N'') FROM DUAL").sql, 'SELECT CAST(NULL AS NUMERIC)');
});

test('Unicode padding uses the measured width rule while binding a volatile argument once', () => {
  const sql = convert("SELECT LPAD(TO_CHAR(pad_once.NEXTVAL),7,'漢') FROM DUAL").sql;
  assert.equal(sql.match(/nextval\('pad_once'\)/g)?.length, 1);
  assert.match(sql, /int4multirange/);
  assert.doesNotMatch(sql, /FROM DUAL/);
});
