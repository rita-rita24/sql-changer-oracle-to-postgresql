import assert from "node:assert/strict";
import test from "node:test";

import { loadApp } from "../helpers/load-app.mjs";

function convert(sql) {
  return loadApp().convertOracleToPostgres(sql);
}

test("targets PostgreSQL 15.17 for conversion decisions", () => {
  const result = convert("SELECT 1 FROM DUAL;");

  assert.equal(result.targetPostgresVersion, "15.17");
});

test("converts executable Oracle tokens without rewriting string literals, comments, or quoted identifiers", () => {
  const source = [
    "-- NUMBER VARCHAR2 SYSDATE should remain comment text",
    "SELECT 'VARCHAR2 NUMBER SYSDATE FROM DUAL' AS text_value,",
    '       "DATE" AS "NUMBER",',
    "       CAST(1 AS NUMBER) AS amount",
    "FROM DUAL;",
    "/* TABLESPACE users and DATE should remain comment text */"
  ].join("\n");

  const result = convert(source);

  assert.match(result.sql, /-- NUMBER VARCHAR2 SYSDATE should remain comment text/);
  assert.match(result.sql, /'VARCHAR2 NUMBER SYSDATE FROM DUAL' AS text_value/);
  assert.match(result.sql, /"DATE" AS "NUMBER"/);
  assert.match(result.sql, /CAST\(1 AS NUMERIC\) AS amount/);
  assert.match(result.sql, /\/\* TABLESPACE users and DATE should remain comment text \*\//);
  assert.doesNotMatch(result.sql, /"TIMESTAMP" AS "NUMERIC"/);
  assert.ok(!result.warnings.some((warning) => warning.includes("FROM DUAL が残っています")));
});

test("converts SQL stored inside double-quoted strings while preserving quoted identifiers", () => {
  const result = convert([
    'const firstSql = "SELECT SYSDATE AS now_at, CAST(1 AS NUMBER) AS amount FROM DUAL;";',
    'const secondSql = "SELECT MYSEQ.NEXTVAL AS id, \\"DATE\\" AS \\"NUMBER\\" FROM DUAL;";',
    'SELECT "DATE" AS "NUMBER", CAST(2 AS NUMBER) AS amount FROM DUAL;'
  ].join("\n"));

  assert.match(result.sql, /"SELECT CLOCK_TIMESTAMP\(\) AS now_at, CAST\(1 AS NUMERIC\) AS amount;"/);
  assert.match(result.sql, /"SELECT nextval\('myseq'\) AS id, \\"DATE\\" AS \\"NUMBER\\";"/);
  assert.match(result.sql, /SELECT "DATE" AS "NUMBER", CAST\(2 AS NUMERIC\) AS amount;/);
  assert.doesNotMatch(result.sql, /"TIMESTAMP" AS "NUMERIC"/);
  assert.ok(!result.warnings.some((warning) => warning.includes("FROM DUAL が残っています")));
});

test("converts Oracle SQL fragments inside double-quoted data strings", () => {
  const result = convert([
    '(" SYSDATE ")',
    'const tokenSql = "SYSDATE";',
    'const typeSql = " CAST(1 AS NUMBER) ";',
    'SELECT "DATE" AS "NUMBER" FROM DUAL;'
  ].join("\n"));

  assert.match(result.sql, /\(" CLOCK_TIMESTAMP\(\) "\)/);
  assert.match(result.sql, /const tokenSql = "CLOCK_TIMESTAMP\(\)";/);
  assert.match(result.sql, /const typeSql = " CAST\(1 AS NUMERIC\) ";/);
  assert.match(result.sql, /SELECT "DATE" AS "NUMBER";/);
  assert.doesNotMatch(result.sql, /"TIMESTAMP" AS "NUMERIC"/);
});

test("preserves sequence-like text and storage-clause text inside literals while converting executable SQL", () => {
  const result = convert([
    "CREATE TABLE audit_log (",
    "  id NUMBER,",
    "  note VARCHAR2(100) DEFAULT 'MYSEQ.NEXTVAL TABLESPACE users'",
    ") TABLESPACE appdata;",
    "SELECT 'MYSEQ.NEXTVAL' AS literal_value, MYSEQ.NEXTVAL AS next_id FROM DUAL;"
  ].join("\n"));

  assert.match(result.sql, /id NUMERIC/);
  assert.match(result.sql, /note VARCHAR\(100\) DEFAULT 'MYSEQ.NEXTVAL TABLESPACE users'/);
  assert.doesNotMatch(result.sql, /TABLESPACE appdata/);
  assert.match(result.sql, /'MYSEQ.NEXTVAL' AS literal_value/);
  assert.match(result.sql, /nextval\('myseq'\) AS next_id/);
  assert.doesNotMatch(result.sql, /nextval\('myseq'\) TABLESPACE users/);
});

test("does not convert function-looking text inside literals or comments", () => {
  const result = convert([
    "-- DECODE(status, 'A', 'active') is documentation",
    "SELECT 'DECODE(status, ''A'', ''active'', ''inactive'')' AS sample,",
    "       DECODE(status, 'A', 'active', 'inactive') AS status_label",
    "FROM DUAL;"
  ].join("\n"));

  assert.match(result.sql, /-- DECODE\(status, 'A', 'active'\) is documentation/);
  assert.match(result.sql, /'DECODE\(status, ''A'', ''active'', ''inactive''\)' AS sample/);
  assert.match(result.sql, /\(CASE WHEN status = 'A' THEN 'active' ELSE 'inactive' END\) AS status_label/);
});

test("converts DECODE NULL comparisons using IS NULL semantics", () => {
  const result = convert("SELECT DECODE(status, NULL, 'missing', 'ok') FROM DUAL;");

  assert.equal(result.sql, "SELECT (CASE WHEN status IS NULL THEN 'missing' ELSE 'ok' END);");
});

test("moves ROWNUM limits after ORDER BY for top-level SELECT statements", () => {
  const result = convert("SELECT * FROM users WHERE ROWNUM <= 10 ORDER BY id;");

  assert.equal(result.sql, "SELECT * FROM users ORDER BY id\nLIMIT 10;");
  assert.ok(result.warnings.some((warning) => warning.includes("並べ替え前")));
});

test("removes middle ROWNUM predicates without dropping surrounding filters", () => {
  const result = convert("SELECT * FROM users WHERE active = 1 AND ROWNUM <= 10 AND deleted = 0;");

  assert.equal(result.sql, "SELECT * FROM users WHERE active = 1 AND deleted = 0\nLIMIT 10;");
  assert.equal(result.warnings.length, 0);
});

test("converts TRUNC with numeric and date overloads without producing invalid date_trunc for numeric values", () => {
  const result = convert([
    "SELECT TRUNC(amount) AS amount_floor,",
    "       TRUNC(total_amount, 2) AS amount_rounded,",
    "       TRUNC(CURRENT_DATE) AS today_floor,",
    "       TRUNC(SYSDATE) AS current_floor,",
    "       TRUNC(created_at, 'MM') AS month_floor",
    "FROM DUAL;"
  ].join("\n"));

  assert.match(result.sql, /TRUNC\(amount\) AS amount_floor/);
  assert.match(result.sql, /TRUNC\(total_amount, 2\) AS amount_rounded/);
  assert.match(result.sql, /TRUNC\(CURRENT_DATE\) AS today_floor/);
  assert.match(result.sql, /TRUNC\(CLOCK_TIMESTAMP\(\)\) AS current_floor/);
  assert.match(result.sql, /TRUNC\(created_at, 'MM'\) AS month_floor/);
  assert.doesNotMatch(result.sql, /date_trunc\('day', amount\)/);
  assert.ok(result.warnings.some((warning) => warning.includes("TRUNC")));
});

test("does not silently approximate MONTHS_BETWEEN because Oracle fractional month semantics differ", () => {
  const result = convert("SELECT MONTHS_BETWEEN(end_date, start_date) AS diff_months FROM DUAL;");

  assert.equal(result.sql, "SELECT MONTHS_BETWEEN(end_date, start_date) AS diff_months;");
  assert.ok(result.warnings.some((warning) => warning.includes("MONTHS_BETWEEN")));
  assert.doesNotMatch(result.sql, /EXTRACT\(YEAR FROM age/);
});

test("applies PostgreSQL-required function argument policy for common Oracle functions", () => {
  const result = convert([
    "SELECT NVL(col, 'x') AS fallback_value,",
    "       NVL2(flag, 'Y', 'N') AS flag_label,",
    "       TO_NUMBER(TRIM(amount_txt)) AS amount_num,",
    "       TO_CHAR(created_at) AS created_text,",
    "       TO_DATE('2024-06-15') AS created_date,",
    "       SUBSTR(code, 0, 3) AS code_prefix,",
    "       SUBSTR(code, -2) AS code_suffix,",
    "       LPAD(12, 4, 0) AS padded_num,",
    "       LAST_DAY(created_at) AS month_end,",
    "       SYSDATE AS current_at,",
    "       SYSDATE - 1 AS yesterday_at,",
    "       SYSTIMESTAMP AS stamped_at",
    "FROM DUAL;"
  ].join("\n"));

  assert.match(result.sql, /COALESCE\(NULLIF\(col, ''\), 'x'\) AS fallback_value/);
  assert.match(result.sql, /\(CASE WHEN NULLIF\(flag, ''\) IS NOT NULL THEN 'Y' ELSE 'N' END\) AS flag_label/);
  assert.match(result.sql, /TO_NUMBER\(NULLIF\(TRIM\(amount_txt\), ''\), '999999999'\) AS amount_num/);
  assert.match(result.sql, /TO_CHAR\(created_at, 'YYYY-MM-DD HH24:MI:SS'\) AS created_text/);
  assert.match(result.sql, /TO_DATE\('2024-06-15', 'YYYY-MM-DD'\) AS created_date/);
  assert.match(result.sql, /SUBSTR\(code, 1, 3\) AS code_prefix/);
  assert.match(result.sql, /RIGHT\(code, 2\) AS code_suffix/);
  assert.doesNotMatch(result.sql, /SUBSTRING/);
  assert.match(result.sql, /LPAD\(CAST\(12 AS TEXT\), 4, '0'\) AS padded_num/);
  assert.match(result.sql, /LAST_DAY\(created_at\) AS month_end/);
  assert.match(result.sql, /CLOCK_TIMESTAMP\(\) AS current_at/);
  assert.match(result.sql, /CLOCK_TIMESTAMP\(\) - INTERVAL '1 day' AS yesterday_at/);
  assert.match(result.sql, /CLOCK_TIMESTAMP\(\) AS stamped_at/);
  assert.ok(!result.warnings.some((warning) => warning.includes("SYSDATE の日数加減算")));
});

test("normalizes empty strings to null for string-like conversion inputs", () => {
  const result = convert([
    "SELECT NVL(name, '未設定') AS display_name,",
    "       NVL(amount, 0) AS amount_value,",
    "       TO_NUMBER(amount_txt) AS amount_num,",
    "       TO_DATE(date_txt) AS date_value",
    "FROM users",
    "WHERE TRIM(name) IS NULL",
    "   OR TRIM(note) IS NOT NULL;"
  ].join("\n"));

  assert.match(result.sql, /COALESCE\(NULLIF\(name, ''\), '未設定'\) AS display_name/);
  assert.match(result.sql, /COALESCE\(amount, 0\) AS amount_value/);
  assert.match(result.sql, /TO_NUMBER\(NULLIF\(amount_txt, ''\), '999999999'\) AS amount_num/);
  assert.match(result.sql, /TO_DATE\(NULLIF\(date_txt, ''\), 'YYYYMMDD'\) AS date_value/);
  assert.match(result.sql, /WHERE NULLIF\(TRIM\(name\), ''\) IS NULL/);
  assert.match(result.sql, /OR NULLIF\(TRIM\(note\), ''\) IS NOT NULL/);
  assert.doesNotMatch(result.sql, /NULLIF\(amount, ''\)/);
});

test("warns about string concatenation without rewriting operands", () => {
  const result = convert([
    "SELECT first_name || ' ' || last_name AS full_name,",
    "       'ID:' || code || 123 AS code_text,",
    "       COALESCE(note, '') || suffix AS note_text,",
    "       amount || '円' AS amount_text",
    "FROM users",
    "WHERE status || '-' || kind = 'A-B'",
    "  AND message <> 'do not rewrite a || b inside literal';"
  ].join("\n"));

  assert.match(result.sql, /first_name \|\| ' ' \|\| last_name AS full_name/);
  assert.match(result.sql, /'ID:' \|\| code \|\| 123 AS code_text/);
  assert.match(result.sql, /COALESCE\(note, ''\) \|\| suffix AS note_text/);
  assert.match(result.sql, /amount \|\| '円' AS amount_text/);
  assert.match(result.sql, /WHERE status \|\| '-' \|\| kind = 'A-B'/);
  assert.match(result.sql, /'do not rewrite a \|\| b inside literal'/);
  assert.ok(result.warnings.some((warning) => warning.includes("文字列連結")));
});

test("warns when a derived table has no alias required by PostgreSQL", () => {
  const withoutAlias = convert("SELECT * FROM (SELECT id FROM users) WHERE id = 1;");
  const withAlias = convert("SELECT * FROM (SELECT id FROM users) AS u WHERE u.id = 1;");

  assert.match(withoutAlias.sql, /FROM \(SELECT id FROM users\) WHERE id = 1/);
  assert.ok(withoutAlias.warnings.some((warning) => warning.includes("サブクエリに別名が必要")));
  assert.ok(withoutAlias.warnings.some((warning) => warning.includes("PostgreSQL 15.17")));
  assert.ok(!withAlias.warnings.some((warning) => warning.includes("サブクエリに別名が必要")));
});

test("warns about Oracle-only syntax that PostgreSQL 15.17 cannot parse directly", () => {
  const result = convert([
    "INSERT ALL",
    "  INTO users(id) VALUES (:id)",
    "  INTO audit(id) VALUES (&audit_id)",
    "SELECT 1 FROM DUAL;",
    "SELECT q'[a'b]' AS text_value FROM DUAL;",
    "CREATE OR REPLACE FORCE VIEW v_users AS SELECT * FROM users;",
    "CREATE BITMAP INDEX user_flag_bix ON users(flag);",
    "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYYMMDD';",
    "PROMPT done",
    "/"
  ].join("\n"));
  const warningText = result.warnings.join("\n");

  assert.match(warningText, /INSERT ALL\/FIRST/);
  assert.match(warningText, /バインド変数/);
  assert.match(warningText, /SQL\*Plus置換変数/);
  assert.match(warningText, /q'\[\.\.\.\]' 形式/);
  assert.match(warningText, /CREATE FORCE VIEW/);
  assert.match(warningText, /BITMAP INDEX/);
  assert.match(warningText, /ALTER SESSION\/ALTER SYSTEM/);
  assert.match(warningText, /SQL\*Plusコマンド/);
  assert.match(warningText, /単独スラッシュ/);
});

test("warns about malformed SQL delimiters and parentheses", () => {
  const result = convert("SELECT (id FROM users WHERE name = 'unterminated;");
  const warningText = result.warnings.join("\n");

  assert.match(warningText, /引用符、ドルクォート、またはブロックコメントが閉じていない/);
  assert.match(warningText, /括弧の対応が崩れている/);
});

test("does not treat PostgreSQL casts or literal text as Oracle bind and substitution variables", () => {
  const result = convert("SELECT created_at::date AS d, ':id' AS bind_text, '&name' AS subst_text FROM users;");

  assert.ok(!result.warnings.some((warning) => warning.includes("バインド変数")));
  assert.ok(!result.warnings.some((warning) => warning.includes("SQL*Plus置換変数")));
});

test("keeps helper-function policies explicit when PostgreSQL has no direct equivalent", () => {
  const result = convert("SELECT ADD_MONTHS(base_date, 1), INSTR(code, '-', 2, 1), SUBSTRB(name, 1, 2) FROM DUAL;");

  assert.equal(
    result.sql,
    "SELECT ADD_MONTHS(base_date, 1), INSTR(code, '-', 2, 1), SUBSTRB(name, 1, 2);"
  );
  assert.ok(result.warnings.some((warning) => warning.includes("ADD_MONTHS")));
  assert.ok(result.warnings.some((warning) => warning.includes("INSTR")));
  assert.ok(result.warnings.some((warning) => warning.includes("SUBSTRB")));
});

test("removes target qualifiers from ordinary UPDATE SET clauses only", () => {
  const result = convert("UPDATE TEST A SET A.X = B, TEST.Y = 2 WHERE A.ID = B.ID;");

  assert.equal(result.sql, "UPDATE TEST A SET X = B, Y = 2 WHERE A.ID = B.ID;");
});

test("moves Oracle MERGE UPDATE SET WHERE clauses to PostgreSQL WHEN MATCHED conditions", () => {
  const result = convert("MERGE INTO tgt t USING src s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.name = s.name WHERE s.active = 1 WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name);");

  assert.equal(
    result.sql,
    "MERGE INTO tgt t USING src s ON (t.id = s.id) WHEN MATCHED AND (s.active = 1) THEN UPDATE SET name = s.name WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name);"
  );
  assert.equal(result.warnings.length, 0);
});

test("combines existing MERGE MATCHED conditions and ignores nested WHERE inside SET expressions", () => {
  const result = convert("MERGE INTO tgt t USING src s ON (t.id = s.id) WHEN MATCHED AND t.kind = s.kind THEN UPDATE SET t.name = s.name, t.note = (SELECT x.note FROM x WHERE x.id = s.id), t.status = s.status WHERE s.active = 1 AND t.locked = 0;");

  assert.equal(
    result.sql,
    "MERGE INTO tgt t USING src s ON (t.id = s.id) WHEN MATCHED AND (t.kind = s.kind) AND (s.active = 1 AND t.locked = 0) THEN UPDATE SET name = s.name, note = (SELECT x.note FROM x WHERE x.id = s.id), status = s.status;"
  );
  assert.equal(result.warnings.length, 0);
});

test("escapes highlighted SQL so dangerous markup is displayed as text", () => {
  const { highlightSql } = loadApp();
  const html = highlightSql("SELECT '<img src=x onerror=\"alert(1)\">' AS payload FROM DUAL;");

  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("onerror=\"alert(1)\""));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("property: dangerous literal payloads survive conversion exactly as literal text", () => {
  const payloads = [
    "FROM DUAL",
    "VARCHAR2 NUMBER SYSDATE",
    "MYSEQ.NEXTVAL",
    "TABLESPACE users",
    "<script>alert(1)</script>",
    "長い日本語ラベル".repeat(8),
    "emoji-😀-zero-width-\u200b",
    "line1\\nline2",
    "DECODE(a,b,c)"
  ];

  for (const payload of payloads) {
    const literal = payload.replaceAll("'", "''");
    const result = convert(`SELECT '${literal}' AS payload FROM DUAL;`);
    assert.match(result.sql, new RegExp(`SELECT '${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}' AS payload;`));
    assert.ok(!result.warnings.some((warning) => warning.includes("FROM DUAL が残っています")), payload);
  }
});
