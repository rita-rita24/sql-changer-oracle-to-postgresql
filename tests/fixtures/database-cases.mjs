// Synthetic data only. Equivalence is required unless a specific policy exception
// names the expected Oracle value and PostgreSQL value/error independently.
const select = (id, expression, extra = {}) => ({ id, source: `SELECT ${expression} AS v FROM DUAL`, ...extra });
const number = (value) => ({ type: "number", value: String(value) });
const string = (value) => ({ type: "string", value });
export const databaseCases = [
  select("literal-protection", "'NVL NUMBER SYSDATE ; a.id=1'"),
  select("backslash", String.raw`'\'`),
  select("quoted-identifier", '1 AS "NUMBER", 2'),
  select("nested-nvl", "NVL(NVL(CAST(NULL AS VARCHAR2(10)), ''), 'fallback')"),
  select("nested-decode", "DECODE(1, 1, DECODE(2, 2, 'yes', 'no'), 'other')"),
  select("comment-function", "NVL/* , ) ; */(CAST(NULL AS VARCHAR2(10)), 'fallback')"),
  select("nvl-coercion", "NVL(CAST(NULL AS VARCHAR2(10)), 0)"),
  select("nvl-empty-result", "NVL(CAST(NULL AS VARCHAR2(10)), '')"),
  select("decode-null", "DECODE(CAST(NULL AS NUMBER), CAST(NULL AS NUMBER), 1, 0)"),
  select("decode-empty-result", "DECODE(1, 1, '', 'other')"),
  select("nvl2-empty-result", "NVL2(1, '', 'other')"),
  select("nvl-numeric-text-cast", "NVL(CAST(NULL AS NUMBER), CAST('12' AS VARCHAR2(10)))"),
  select("nvl2-result-text", "NVL2(1, CAST('yes' AS VARCHAR2(10)), 0)"),
  select("nvl2-result-number", "NVL2(NULL, 12, CAST('10' AS VARCHAR2(10)))"),
  select("nvl2-null-result", "NVL2(1, NULL, 12)"),
  select("decode-result-type", "DECODE(2, 1, 'yes', 2, 12, 0)"),
  select("decode-null-first-result", "DECODE(2, 1, NULL, 2, 12, 0)"),
  select("decode-search-type", "DECODE(CAST('1' AS VARCHAR2(10)), 1, 'yes', 'no')"),
  select("decode-numeric-search-text", "DECODE(1, CAST('1' AS VARCHAR2(10)), 'yes', 'no')"),
  select("lpad-number", "LPAD(12, 4, 0)"),
  select("lpad-default", "LPAD('x', 3)"),
  select("lpad-empty", "LPAD('', 3, 'x')"),
  select("lpad-zero", "LPAD('x', 0, 'y')"),
  select("lpad-negative", "LPAD('x', -1, 'y')"),
  select("substr-numeric", "SUBSTR(12345, 2, 2)"),
  select("to-number-numeric-format", "TO_NUMBER(123, '999')"),
  select("trim-null", "CASE WHEN TRIM('   ') IS NULL THEN 1 ELSE 0 END"),
  select("date-format", "TO_CHAR(TO_DATE('20240615', 'YYYYMMDD'), 'YYYY-MM-DD')"),
  select("date-literal", "TO_CHAR(DATE '2024-06-15', 'YYYY-MM-DD')"),
  select("number-format", "TO_CHAR(123.45, 'FM999.00')"),
  select("trunc-number", "TRUNC(12.345, 2)"),
  { id: "rownum-min", source: "SELECT id FROM data_rows WHERE ROWNUM <= 10 AND ROWNUM <= 2" },
  { id: "rownum-zero", source: "SELECT id FROM data_rows WHERE ROWNUM <= 0" },
  { id: "minus", source: "SELECT id FROM data_rows MINUS SELECT id FROM data_rows WHERE id=1 ORDER BY id" },
  { id: "update-literal", source: "UPDATE data_rows a SET a.note='a.id=1' WHERE a.id=1", verify: "SELECT note FROM data_rows WHERE id=1" },
  { id: "update-case", source: "UPDATE data_rows a SET a.n=CASE WHEN a.id=1 THEN 12 ELSE 13 END WHERE a.id<=2", verify: "SELECT id,n FROM data_rows WHERE id<=2 ORDER BY id" },
  { id: "merge-update", source: "MERGE INTO data_rows t USING source_rows s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET t.note='INSERT (t.id)' WHERE s.n=2", verify: "SELECT note FROM data_rows WHERE id=1" },
  { id: "merge-values", source: "MERGE INTO data_rows t USING (SELECT 4 AS id, 'new' AS note FROM DUAL) s ON (t.id=s.id) WHEN NOT MATCHED THEN INSERT (id,note) VALUES (s.id,s.note)", verify: "SELECT id,note FROM data_rows WHERE id=4" },
  { id: "ddl-types", source: "CREATE TABLE type_probe (id NUMBER(12,0), amount NUMBER(10,2), label VARCHAR2(20), d DATE)", after: ["INSERT INTO type_probe VALUES (1, 12.34, '日本語', DATE '2024-06-15')"], verify: "SELECT id,amount,label,TO_CHAR(d, 'YYYY-MM-DD') FROM type_probe" },
  { id: "ddl-quoted", source: 'CREATE TABLE "DATE" ("NUMBER" NUMBER)', after: ['INSERT INTO "DATE" VALUES (123)'], verify: 'SELECT "NUMBER" FROM "DATE"' },
  { id: "ddl-float", source: "CREATE TABLE float_probe (v FLOAT(126))", after: ["INSERT INTO float_probe VALUES (12.5)"], verify: "SELECT v FROM float_probe" },
  { id: "sequence", source: "CREATE SEQUENCE seq_probe START WITH 1 INCREMENT BY 1 NOCACHE", after: [], verify: "SELECT seq_probe.NEXTVAL FROM DUAL" },
  { id: "quoted-sequence", source: 'CREATE SEQUENCE "MYSEQ" START WITH 1 INCREMENT BY 1', verify: 'SELECT "MYSEQ".NEXTVAL FROM DUAL' },
  select("policy-to-char-decimal", "TO_CHAR(12.34)", { exception: { reason: "従来のFM999999999補完", oracle: [[string("12.34")]], postgres: [[string("12")]] } }),
  select("policy-to-date-time", "TO_CHAR(TO_DATE('2024-06-15 12:34:56','YYYY-MM-DD HH24:MI:SS'),'HH24:MI:SS')", { exception: { reason: "TO_DATE維持に伴う時刻消失", oracle: [[string("12:34:56")]], postgres: [[string("00:00:00")]] } }),
  select("policy-rr-century", "TO_CHAR(TO_DATE('50-01-01','RR-MM-DD'),'YYYY-MM-DD')", { exception: { reason: "RR→YYの世紀差（現在年2000–2049で検証）", oracle: [[string("1950-01-01")]], postgres: [[string("2050-01-01")]] } }),
  select("policy-date-arithmetic", "DATE '2024-06-15' + 1", { exception: { reason: "DATE→TIMESTAMP方針で日数加算は要対応", postgresError: "42883" } }),
  select("policy-null-concat", "'A' || CAST(NULL AS VARCHAR2(10))", { exception: { reason: "連結式保持のNULL差", oracle: [[string("A")]], postgres: [[null]] } }),
  { id: "policy-identity", source: "CREATE TABLE identity_probe (id NUMBER GENERATED ALWAYS AS IDENTITY)", exception: { reason: "NUMBER→NUMERIC方針ではIDENTITY非対応", postgresError: "22023" } },
  { id: "policy-unknown-type", source: "SELECT NVL(flag, '0') FROM (SELECT CAST(1 AS NUMBER) flag FROM DUAL) t", exception: { reason: "既存の列名による型推定", oracle: [[number(1)]], postgresError: "22P02" } },
  { id: "policy-substr-column-forward", source: "SELECT SUBSTR(note, 10) FROM data_rows WHERE id=2", exception: { reason: "列のSUBSTR維持による範囲外NULLの差", oracle: [[null]], postgres: [[string("")]] } },
  { id: "policy-substr-column-backward", source: "SELECT SUBSTR(note, -10) FROM data_rows WHERE id=2", exception: { reason: "既存のRIGHT変換による範囲外NULLの差", oracle: [[null]], postgres: [[string("two")]] } },
  { id: "manual-aggregate-rownum", source: "SELECT COUNT(*) FROM data_rows WHERE ROWNUM<=2", exception: { reason: "集計のROWNUMは手動変換", oracle: [[number(2)]], postgresError: "42703" } },
  select("helper-add-months", "ADD_MONTHS(DATE '2024-01-31',1)", { exception: { reason: "互換関数の導入が必要", postgresError: "42883" } }),
  select("helper-months-between", "MONTHS_BETWEEN(DATE '2024-02-29',DATE '2024-01-31')", { exception: { reason: "互換関数の導入が必要", oracle: [[number(1)]], postgresError: "42883" } }),
  select("helper-last-day", "LAST_DAY(DATE '2024-02-01')", { exception: { reason: "互換関数の導入が必要", postgresError: "42883" } }),
  select("helper-instr", "INSTR('abcabc','b',1,2)", { exception: { reason: "互換関数の導入が必要", oracle: [[number(5)]], postgresError: "42883" } }),
  select("helper-trunc-date", "TRUNC(DATE '2024-06-15','MM')", { exception: { reason: "互換関数の導入が必要", postgresError: "42883" } }),
];
for (const value of ["NULL", "''", "'abc'", "'日本語'", "'a''b'", "CAST(NULL AS VARCHAR2(10))"]) {
  databaseCases.push(select(`nvl-${value}`, `NVL(${value}, 'fallback')`));
  databaseCases.push(select(`nvl2-${value}`, `NVL2(${value}, 1, 0)`));
  databaseCases.push(select(`decode-${value}`, `DECODE(${value}, NULL, 'missing', 'abc', 'match', 'other')`));
}
for (const value of ["0", "-123", "12.34", "'12.34'", "NULL", "''", "'12345678901234567890.12'"]) {
  databaseCases.push(select(`to-number-${value}`, `TO_NUMBER(${value})`));
}
for (const value of ["'abc'", "'日本語'", "''", "CAST(NULL AS VARCHAR2(10))"]) {
  for (const start of [-9, -2, 0, 1, 3, 4]) {
    for (const length of [undefined, -1, 0, 2]) {
      databaseCases.push(select(`substr-${value}-${start}-${length}`, `SUBSTR(${value}, ${start}${length === undefined ? "" : `, ${length}`})`));
    }
  }
}
