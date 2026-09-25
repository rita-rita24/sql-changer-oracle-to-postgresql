import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {loadApp} from '../helpers/load-app.mjs';
import {decimal} from '../helpers/decimal-value.mjs';
const app=()=>loadApp({file:process.env.EXTENDED_QA_SOURCE});
const convert=app().convertOracleToPostgres;

for(const [source,expected] of [
 ['SELECT 1/2 FROM DUAL;', 'SELECT 1/CAST(2 AS NUMERIC);'],
 ['SELECT 1/(2+3) FROM DUAL;', 'SELECT 1/CAST((2+3) AS NUMERIC);'],
 ['SELECT n/2 FROM t;', 'SELECT n/CAST(2 AS NUMERIC) FROM t;'],
 ["SELECT DATE '2024-06-15'+1 FROM DUAL;", "SELECT (TIMESTAMP '2024-06-15'+(1) * INTERVAL '1 day');"],
 ["SELECT 'A' || CAST(NULL AS VARCHAR2(10)) FROM DUAL;", "SELECT NULLIF(CONCAT('A' , CAST(NULL AS VARCHAR(10))), '');"],
 ['SELECT * FROM t WHERE ROWNUM<=2 ORDER BY id;', 'SELECT * FROM (SELECT * FROM t LIMIT 2) AS t ORDER BY id;'],
 ['SELECT COUNT(*) FROM t WHERE ROWNUM < 2;', 'SELECT COUNT(*) FROM (SELECT * FROM t LIMIT 1) AS t;'],
 ['SELECT a.x FROM t a WHERE x=1 AND ROWNUM<=2 ORDER BY a.id;', 'SELECT a.x FROM (SELECT * FROM t a WHERE x=1 LIMIT 2) AS a ORDER BY a.id;'],
 ['SELECT s.NEXTVAL$tag FROM t;', 'SELECT s.NEXTVAL$tag FROM t;'],
 ['SELECT 日本MYSEQ.NEXTVAL FROM DUAL;', "SELECT nextval('日本myseq');"],
 ['SELECT s /* comment */ . NEXTVAL FROM DUAL;', "SELECT /* comment */ nextval('s');"],
 ['SELECT schema . /* gap */ NVL(a,b) FROM t;', 'SELECT schema . /* gap */ NVL(a,b) FROM t;'],
 ['SELECT schema . TRIM(a) IS NULL FROM t;', 'SELECT schema . TRIM(a) IS NULL FROM t;'],
 ['SELECT sealect FROM t;', 'SELECT sealect FROM t;'],
 ['SELECT 1 FROM duel;', 'SELECT 1 FROM duel;'],
 ['DELETE FROM DUAL WHERE 1=0;', 'DELETE FROM DUAL WHERE 1=0;'],
 ['UPDATE t a SET a.t.x=1;', 'UPDATE t a SET t.x=1;'],
 ['UPDATE "a.b" SET "a.b".x=1;', 'UPDATE "a.b" SET x=1;'],
 ['ALTER SEQUENCE s NOCYCLE NOCACHE;', 'ALTER SEQUENCE s NO CYCLE CACHE 1;'],
 ['CREATE TABLE t (id INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 40 INCREMENT BY 2 NOCACHE));','CREATE TABLE t (id INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 40 INCREMENT BY 2 CACHE 1));'],
 ['SELECT IDENTITY(nocache) FROM t;', 'SELECT IDENTITY(nocache) FROM t;'],
 ['CREATE TABLE t (id NUMBER PRIMARY KEY DISABLE);','CREATE TABLE t (id NUMERIC PRIMARY KEY DISABLE);'],
 ['SELECT NVL(1) FROM DUAL;', 'SELECT NVL(1);'],
 ["SELECT LPAD('abcdef', 2, '') FROM DUAL;", 'SELECT NULL;'],
 ["SELECT TO_NUMBER('12.34') FROM DUAL;", "SELECT CAST(NULLIF(CAST('12.34' AS TEXT), '') AS NUMERIC);"],
]) test(`extended regression: ${source}`,()=>assert.equal(convert(source).sql,expected));

test('unquoted and quoted DUAL CTE names are not treated as the built-in one-row table',()=>{
 const source='WITH dual AS (SELECT n FROM t) SELECT n FROM dual;';
 assert.equal(convert(source).sql,source);
 const script='CREATE TABLE dual (n NUMBER); SELECT n FROM dual;';
 assert.equal(convert(script).sql,'CREATE TABLE dual (n NUMERIC); SELECT n FROM dual;');
});

test('known numeric formatting retains precision and Oracle leading-dot notation',()=>{
 const result=convert('SELECT TO_CHAR(12.3400), TO_CHAR(.5) FROM DUAL;');
 assert.doesNotMatch(result.sql,/FM999999999/);
 assert.match(result.sql,/TRIM_SCALE/);
 assert.ok(result.sql.includes("'\\1.'"));
});

test('fixed dates retain the complete wall-clock time and resolve RR at execution time',()=>{
 assert.equal(convert("SELECT TO_DATE('2024-06-15 12:34:56','YYYY-MM-DD HH24:MI:SS') FROM DUAL;").sql,
 'SELECT MAKE_TIMESTAMP(2024, 6, 15, 12, 34, 56);');
 const result=convert("SELECT TO_DATE('50-01-01','RR-MM-DD') FROM DUAL;");
 assert.match(result.sql,/EXTRACT\(YEAR FROM CURRENT_DATE\)/);
 assert.match(result.sql,/THEN -1/);
 assert.doesNotMatch(result.sql,/'YY-MM-DD'/);
});

test('format normalization never changes variables or quoted format text',()=>{
 const {context}=app();
 assert.equal(context.normalizeDateFormat('format_rr_column'),'format_rr_column');
 assert.equal(context.normalizeDateFormat("'RR \"RR\"'"),"'YY \"RR\"'");
});

test('dynamic numeric-format dates explicitly neutralize session timezone',()=>{
 const result=convert("SELECT TO_DATE(value,'YYYY-MM-DD HH24:MI:SS') FROM t;");
 assert.match(result.sql,/TZH:TZM/);
 assert.match(result.sql,/AT TIME ZONE 'UTC'/);
});

test('substring binds volatile arguments once and guards integer overflow',()=>{
 const result=convert('SELECT SUBSTR(s.NEXTVAL, -9007199254740993, 9007199254740993) FROM DUAL;');
 assert.equal((result.sql.match(/nextval\(/g)||[]).length,1);
 assert.ok(result.sql.includes('-9007199254740993'));
 assert.match(result.sql,/CHAR_LENGTH/);
 assert.match(result.sql,/OFFSET 0/);
});

test('quoted commas and AS inside CAST arguments cannot determine the wrong scalar type',()=>{
 const {context}=app();
 assert.equal(context.explicitExpressionType("CAST('AS NUMBER)' AS VARCHAR(50))"),'text');
 assert.equal(context.explicitExpressionType('CAST(CAST(1 AS NUMERIC) AS TEXT)'),'text');
 assert.equal(context.explicitExpressionType('CAST(1 AS DOUBLE PRECISION)'),'numeric');
});

test('derived literal projection supplies a known type instead of column-name guessing',()=>{
 const result=convert("SELECT NVL(flag, '0') FROM (SELECT CAST(1 AS NUMBER) flag FROM DUAL) t;");
 assert.doesNotMatch(result.sql,/NULLIF\(flag/);
 assert.match(result.sql,/COALESCE\(flag, CAST/);
 const unknown=convert("SELECT NVL(flag, '0') FROM real_table;");
 assert.ok(unknown.warnings.some(w=>w.includes('型はスキーマ未検証')));
});

test('MERGE projection parsing cannot confuse CASE END or arithmetic operands with aliases',()=>{
 const {context}=app();
 for(const expression of ["CASE WHEN 1=1 THEN 'yes' ELSE 'no' END",'1 + price','a || b']) {
  const parsed=context.parseSelectItem(expression,0,[]);
  assert.equal(parsed.value,expression);
  assert.equal(parsed.alias,'col1');
 }
});

for(const escape of ['\\u0041','\\u{1F600}','\\x41','\\b','\\f','\\0']) test(`host-string escape ${escape} retains its value`,()=>{
 const input=`const sql = "SELECT '${escape}' FROM DUAL;";`;
 const before=vm.runInNewContext(`${input}\nsql`);
 const output=convert(input).sql;
 const after=vm.runInNewContext(`${output}\nsql`);
 assert.equal(after,before.replace(' FROM DUAL',''));
});

test('unrecognized host-string escape syntax is preserved rather than partly decoded',()=>{
 const input=String.raw`const sql = "SELECT '\q' FROM DUAL;";`;
 assert.equal(convert(input).sql,input);
});

test('IME intermediate input does not trigger conversion; composition end runs once',()=>{
 const {context,elements}=app();
 const input=elements.get('oracleSql');
 let calls=0;const original=context.convertOracleToPostgres;
 context.convertOracleToPostgres=(...args)=>{calls++;return original(...args);};
 input.value='SELECT 1 FROM DUAL;';
 input.dispatchEvent({type:'input',isComposing:true});
 assert.equal(calls,0);
 input.dispatchEvent({type:'compositionend'});
 input.dispatchEvent({type:'input',isComposing:false});
 assert.equal(calls,1);
});

test('a clipboard promise that never settles cannot leave the button busy forever',async()=>{
 const {context,elements,advanceTime}=app();
 elements.get('postgresSql').value='SELECT 1;';
 context.navigator.clipboard.writeText=()=>new Promise(()=>{});
 context.document.execCommand=()=>false;
 const pending=context.copyPostgres();
 advanceTime(8000);
 await pending;
 assert.equal(elements.get('copyPostgresButton').getAttribute('aria-busy'),null);
 assert.equal(elements.get('copyPostgresButton').getAttribute('aria-label'),'コピーできませんでした');
});

for(const [value,expected] of [['.5','0.5'],['-.5','-0.5'],['-0.000','0'],['1.2e3','1200'],['00012.34000','12.34'],['123456789012345678901234567890.123400','123456789012345678901234567890.1234']]) test(`database comparisons normalize ${value} without precision loss`,()=>assert.equal(decimal(value),expected));

test('clock values are stable within a statement and Oracle DATE keeps second precision',()=>{
 const result=convert('SELECT SYSDATE, SYSTIMESTAMP, CURRENT_DATE, CURRENT_TIMESTAMP(3), LOCALTIMESTAMP FROM DUAL;');
 assert.doesNotMatch(result.sql,/CLOCK_TIMESTAMP/);
 assert.match(result.sql,/DATE_TRUNC\('second', STATEMENT_TIMESTAMP\(\)\)/);
 assert.match(result.sql,/TIMESTAMP\(3\) WITH TIME ZONE/);
 assert.match(result.sql,/CAST\(STATEMENT_TIMESTAMP\(\) AS TIMESTAMP\)/);
});
