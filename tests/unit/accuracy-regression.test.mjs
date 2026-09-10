import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { loadApp } from "../helpers/load-app.mjs";

const convert = (sql) => loadApp().convertOracleToPostgres(sql);
const policies = JSON.parse(readFileSync(new URL("../fixtures/conversion-policy.json", import.meta.url), "utf8"));
for (const [index, policy] of policies.entries()) {
  test(`preserves established conversion policy ${index + 1}: ${policy.input.slice(0, 65)}`, () => {
    assert.equal(convert(policy.input).sql, policy.sql);
  });
}

const audit = JSON.parse(readFileSync(new URL("../../reports/accuracy-audit-2026-09-07.json", import.meta.url), "utf8"));
const fixed = {
  "LIT-01": "UPDATE t a SET note = 'a.id=1';",
  "LIT-02": "MERGE INTO t USING s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET note='INSERT (t.id)';",
  "LIT-03": "SELECT 'WHERE ORDER BY' AS note FROM t\nLIMIT 2;",
  "ID-01": 'CREATE TABLE "DATE" ("NUMBER" NUMERIC);',
  "ROW-04": "SELECT * FROM t\nLIMIT 2;",
  "FUN-01": "SELECT COALESCE(NULLIF(COALESCE(NULLIF(a, ''), b), ''), c) FROM t;",
  "FUN-02": "SELECT (CASE WHEN x = 1 THEN (CASE WHEN y = 2 THEN 'yes' ELSE 'no' END) ELSE 'other' END) FROM t;",
  "FUN-03": "SELECT /* comment */COALESCE(NULLIF(name, ''), 'x') FROM t;",
  "NULL-01": "SELECT (CASE WHEN NULLIF('', '') IS NOT NULL THEN 1 ELSE 0 END);",
  "NULL-02": "SELECT (CASE WHEN CAST(NULL AS NUMERIC) IS NOT DISTINCT FROM CAST(NULL AS NUMERIC) THEN 1 ELSE 0 END);",
  "TYPE-01": "SELECT TO_NUMBER(CAST(123 AS TEXT), '999');",
  "TYPE-03": "SELECT COALESCE(NULLIF(CAST(NULL AS VARCHAR(10)), ''), CAST(0 AS TEXT));",
  "DDL-01": "CREATE TABLE t (id NUMERIC) ;\nCREATE TABLE u (id NUMERIC);",
  "DDL-02": "CREATE TABLE t (val DOUBLE PRECISION);",
  "SUB-01": "SELECT NULL;",
  "SUB-02": "SELECT NULL;",
  "SEQ-01": 'SELECT nextval(\'"MYSEQ"\');',
  "WARN-03": "-- fetch two rows\nSELECT * FROM t\nLIMIT 2;",
  "LEX-01": String.raw`SELECT '\' AS slash, COALESCE(NULLIF(name, ''), 'x') FROM t;`,
};
const review = {
  "ROW-01": /ROWNUM/,
  "ROW-02": /並べ替え前/,
  "ROW-03": /ROWNUM/,
  "ROW-05": /ROWNUM/,
  "TYPE-02": /型.*未検証/,
  "FMT-01": /小数部/,
  "FMT-02": /小数.*桁数/,
  "DATE-01": /時刻/,
  "DATE-02": /日数加減算/,
  "DATE-03": /世紀/,
  "DATE-04": /NLS/,
  "DDL-03": /IDENTITY.*整数型/,
  "DDL-04": /NUMBER\(\*,s\)/,
  "MERGE-01": /INSERT後WHERE/,
  "MERGE-02": /DELETE WHERE/,
  "DUAL-01": /FROM DUAL/,
  "DUAL-02": /FROM DUAL/,
  "WARN-01": /LISTAGG/,
  "WARN-02": /SOUNDEX/,
};
const retained = new Set(["ROW-01", "ROW-03", "ROW-05", "DUAL-01", "DUAL-02"]);
for (const probe of audit.observations) {
  test(`audit regression ${probe.id}: ${probe.category}`, () => {
    const result = convert(probe.input);
    if (probe.id in fixed) {
      assert.equal(result.sql, fixed[probe.id]);
      assert.ok(!result.warnings.some((w) => /引用符.*閉じていない/.test(w)));
    } else {
      assert.ok(probe.id in review, `Missing review disposition for ${probe.id}`);
      assert.match(result.warnings.join("\n"), review[probe.id]);
      assert.equal(result.sql, retained.has(probe.id) ? probe.input : probe.observed.sql);
    }
  });
}

test("preserves every literal and comment across DML transformations", () => {
  const payloads = ["a.id=1", "INSERT (t.id)", "WHERE ORDER BY", "; WHERE a.x=1", "t.id = 5, a.x=2", "NVL(x, y)", "a.id='x'"];
  for (const payload of payloads) {
    const literal = `'${payload.replaceAll("'", "''")}'`;
    const update = convert(`UPDATE t a SET a.note = ${literal}, a.n = 1 WHERE a.id=2;`);
    assert.equal(update.sql, `UPDATE t a SET note = ${literal}, n = 1 WHERE a.id=2;`);
    const merge = convert(`MERGE INTO t USING s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET t.note=${literal};`);
    assert.ok(merge.sql.includes(`note=${literal}`), payload);
  }
  const input = "/* UPDATE t a SET a.x=2; */\nUPDATE t a SET a.x = (SELECT CASE WHEN u.x=1 THEN 2 END FROM u WHERE u.id=a.id), a.y = 'WHERE';";
  assert.equal(convert(input).sql, input.replace("\nUPDATE t a SET a.x", "\nUPDATE t a SET x").replace(", a.y =", ", y ="));
});

test("shared lexer respects commas, parentheses and semicolons in protected text", () => {
  const app = loadApp();
  const { context } = app;
  const input = "a, q'[x'),;]', /* , ) ; */ NVL(x, y), $$,);$$, z";
  assert.equal(context.splitArgs(input).length, 5);
  assert.equal(context.findClosingParen("(q'[)]', /* ) */ a)", 0), 18);
  assert.equal(context.splitSqlStatements("SELECT q'[;]'; /* ; */ SELECT $$;$$; -- ;\nSELECT 3;").length, 3);
  const sql = "SELECT NVL/* ; ) */(a, NVL(b, 'x,y')) FROM DUAL;";
  const output = app.convertOracleToPostgres(sql).sql;
  assert.ok(output.includes("/* ; ) */"));
  assert.ok(output.includes("'x,y'"));
  assert.doesNotMatch(output, /\bNVL\s*\(/);
});

test("detects unterminated delimiters even after a complete comment or doubled quote", () => {
  for (const sql of ["/* ok */ SELECT 'unclosed", "SELECT 'abc''", 'SELECT "abc""', "/* ok */ SELECT /* open", "SELECT q'[unclosed'"]) {
    assert.ok(convert(sql).warnings.some((w) => w.includes("閉じていない")), sql);
  }
  assert.ok(!convert("/* ok */ SELECT 'abc''def' FROM DUAL;").warnings.some((w) => w.includes("閉じていない")));
});

test("separates SQL quoted identifiers from embedded program strings", () => {
  for (const sql of ['SELECT "SYSDATE()" AS "SELECT FROM DUAL" FROM t;', 'CREATE TABLE "DATE" ("NUMBER" NUMBER);', 'SELECT "DATE VALUE", "SYSDATE " FROM t;']) {
    const output = convert(sql).sql;
    for (const identifier of sql.match(/"[^"]*"/g)) assert.ok(output.includes(identifier), identifier);
  }
  const result = convert('const sql = "SELECT \\"DATE\\" AS x, NVL(NVL(a,b),c) FROM DUAL;";');
  assert.ok(result.sql.includes('\\"DATE\\"'));
  assert.doesNotMatch(result.sql, /\bNVL\(/);
  assert.ok(!result.warnings.some((w) => /閉じていない|括弧/.test(w)));
  assert.equal(convert('const sql = "SELECT 1 FROM DUAL;"; SELECT \'__SQL_CHANGER_EMBEDDED_0__\' FROM DUAL;').sql,
    'const sql = "SELECT 1;"; SELECT \'__SQL_CHANGER_EMBEDDED_0__\';');
});

test("supports quoted sequence names and protects sequence-like literal content", () => {
  assert.equal(convert('SELECT "A.B"."S""Q".NEXTVAL FROM DUAL;').sql, 'SELECT nextval(\'"A.B"."S""Q"\');');
  assert.equal(convert('SELECT \'"MYSEQ".NEXTVAL\' FROM DUAL;').sql, 'SELECT \'"MYSEQ".NEXTVAL\';');
  assert.equal(convert('SELECT "MYSEQ.NEXTVAL" FROM t;').sql, 'SELECT "MYSEQ.NEXTVAL" FROM t;');
});

test("does not rewrite keyword substrings of Oracle identifiers", () => {
  assert.equal(convert('SELECT NUMBER$CODE, SYSDATE#TEXT FROM t;').sql, 'SELECT NUMBER$CODE, SYSDATE#TEXT FROM t;');
});

test("only converts complete independent ROWNUM bounds", () => {
  assert.equal(convert('SELECT * FROM t WHERE ROWNUM <= 0;').sql, 'SELECT * FROM t\nLIMIT 0;');
  assert.equal(convert('SELECT * FROM t WHERE ROWNUM <= 10 AND x=1 AND ROWNUM <= 2;').sql, 'SELECT * FROM t WHERE x=1\nLIMIT 2;');
  for (const sql of [
    'SELECT * FROM t WHERE ROWNUM <= 2.5;',
    'SELECT * FROM t WHERE ROWNUM <= 2 AND n BETWEEN 1 AND 3;',
    'SELECT * FROM t WHERE ROWNUM <= 9223372036854775808;',
    'SELECT * FROM t WHERE ROWNUM <= 2 UNION ALL SELECT * FROM u;',
    'SELECT * FROM t WHERE x=1 -- preserve filter\nAND ROWNUM <= 2 ORDER BY id;',
    'SELECT * FROM t WHERE EXISTS (SELECT 1 FROM u WHERE ROWNUM <= 2);',
    'SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;',
    'WITH t AS (SELECT * FROM u) SELECT * FROM t WHERE ROWNUM <= 2;',
  ]) {
    const result = convert(sql);
    assert.equal(result.sql, sql);
    assert.ok(result.warnings.some((w) => w.includes('ROWNUM')));
  }
});

test("nested empty-string normalization applies to the full outer expression", () => {
  assert.equal(convert("SELECT NVL(NVL(a, b), c) FROM t;").sql, "SELECT COALESCE(NULLIF(COALESCE(NULLIF(a, ''), b), ''), c) FROM t;");
  assert.equal(convert("SELECT NVL2('', 1, 0) FROM DUAL;").sql, "SELECT (CASE WHEN NULLIF('', '') IS NOT NULL THEN 1 ELSE 0 END);");
  assert.equal(convert("SELECT SUBSTR('abc', -9) FROM DUAL;").sql, "SELECT NULL;");
});

test("warnings do not report unsupported functions mentioned only in literals", () => {
  const result = convert("SELECT 'LISTAGG(x) SOUNDEX(x) CURRENT_DATE' AS note FROM DUAL;");
  assert.equal(result.warnings.length, 0);
});

test("Oracle helper policy remains explicit for nested helper calls", () => {
  const result = convert("SELECT ADD_MONTHS(ADD_MONTHS(d, 1), 2), INSTR(code, '-') FROM DUAL;");
  assert.equal(result.sql, "SELECT ADD_MONTHS(ADD_MONTHS(d, 1), 2), INSTR(code, '-');");
  assert.match(result.warnings.join("\n"), /ADD_MONTHS/);
  assert.match(result.warnings.join("\n"), /INSTR/);
});

test("escapes newly introduced newlines in embedded SQL without changing the program string", () => {
  const output = convert('const sql = "SELECT * FROM t WHERE ROWNUM <= 2;";').sql;
  assert.equal(vm.runInNewContext(`${output}\nsql`), "SELECT * FROM t\nLIMIT 2;");
  assert.ok(output.includes("\\nLIMIT"));
  const malformed = 'const sql = "SELECT NUMBER';
  const result = convert(malformed);
  assert.equal(result.sql, malformed);
  assert.match(result.warnings.join("\n"), /閉じていない/);
});

test("bounds nested DECODE expansion and flags evaluation-sensitive expressions", () => {
  let expression = "x";
  for (let n = 0; n < 30; n++) expression = `DECODE(${expression}, 1, 2, 3, 4, 5)`;
  const result = convert(`SELECT ${expression} FROM t;`);
  assert.ok(result.sql.length < 20000);
  assert.match(result.warnings.join("\n"), /過大/);
  assert.match(convert("SELECT DECODE(SYSDATE, a, 1, b, 2, 0) FROM t;").warnings.join("\n"), /評価回数/);
});

test("retains ROWNUM with statistical aggregates and projected row numbers", () => {
  for (const sql of ["SELECT STDDEV(n) FROM t WHERE ROWNUM <= 2;", "SELECT ROWNUM AS rn FROM t WHERE ROWNUM <= 2;"]) {
    const result = convert(sql);
    assert.equal(result.sql, sql);
    assert.match(result.warnings.join("\n"), /ROWNUM/);
  }
});

test("preserves host variable names while converting their SQL string values", () => {
  const result = convert('const DATE = "SELECT SYSDATE FROM DUAL;";\nSELECT CAST(1 AS NUMBER) FROM DUAL;');
  assert.equal(result.sql, 'const DATE = "SELECT CLOCK_TIMESTAMP();";\nSELECT CAST(1 AS NUMERIC);');
});
