// Read-only converter probes. Run from the project root:
// node reports/accuracy-audit-2026-09-07.mjs
// This records conversion output; it does not execute SQL or measure DB equivalence.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadApp } from "../tests/helpers/load-app.mjs";

const probes = [
  ["LIT-01", "文字列データの破壊", "UPDATE t a SET a.note = 'a.id=1';", "格納する文字列 a.id=1 をそのまま保持する必要がある。"],
  ["LIT-02", "文字列データの破壊", "MERGE INTO t USING s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET t.note='INSERT (t.id)';", "文字列内の INSERT (t.id) を保持する必要がある。"],
  ["LIT-03", "文字列データの破壊", "SELECT 'WHERE ORDER BY' AS note FROM t WHERE ROWNUM <= 2;", "文字列 WHERE ORDER BY を保持する必要がある。"],
  ["ID-01", "引用識別子の破壊", 'CREATE TABLE "DATE" ("NUMBER" NUMBER);', 'テーブル名 "DATE" と列名 "NUMBER" を保持する必要がある。'],
  ["ROW-01", "集計前後の行数制限", "SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;", "集計対象は最大2行。COUNTの結果行へのLIMITでは同じ意味にならない。"],
  ["ROW-02", "整列前後の行数制限", "SELECT * FROM t WHERE ROWNUM <= 2 ORDER BY id;", "同一問い合わせブロックのROWNUMはORDER BY前。単純なORDER BY後のLIMITは等価でない。"],
  ["ROW-03", "サブクエリの範囲", "SELECT * FROM t WHERE EXISTS (SELECT 1 FROM u WHERE ROWNUM <= 2 AND u.id=t.id);", "内側のROWNUMを外側SELECTのLIMITへ移してはならない。"],
  ["ROW-04", "複数の上限制約", "SELECT * FROM t WHERE ROWNUM <= 10 AND ROWNUM <= 2;", "両方の条件を満たす上限は2。"],
  ["ROW-05", "論理式の範囲", "SELECT * FROM t WHERE active=1 OR deleted=0 AND ROWNUM <= 2;", "ORの一方にだけ付くROWNUMをSELECT全体のLIMITへ移してはならない。"],
  ["FUN-01", "同名関数の入れ子", "SELECT NVL(NVL(a, b), c) FROM t;", "内側のNVLも変換または未対応として警告する必要がある。"],
  ["FUN-02", "同名関数の入れ子", "SELECT DECODE(x, 1, DECODE(y, 2, 'yes', 'no'), 'other') FROM t;", "内側のOracle DECODEも変換または警告する必要がある。"],
  ["FUN-03", "関数と括弧の間のコメント", "SELECT NVL/* comment */(name, 'x') FROM t;", "コメントが挟まってもNVL関数として扱う必要がある。"],
  ["NULL-01", "空文字のNULL扱い", "SELECT NVL2('', 1, 0) FROM DUAL;", "Oracleでは空文字がNULLのため0。生成CASEでは空文字が非NULLになり1。"],
  ["NULL-02", "DECODEのNULL比較", "SELECT DECODE(CAST(NULL AS NUMBER), CAST(NULL AS NUMBER), 1, 0) FROM DUAL;", "OracleのDECODEはNULL同士も一致するため1。通常の等号では一致せず0。"],
  ["TYPE-01", "数値への空文字比較", "SELECT TO_NUMBER(123) FROM DUAL;", "数値123をNULLIF(123, '')で処理するとPostgreSQLで型エラーになる。"],
  ["TYPE-02", "列名による型推測", "SELECT NVL(flag, '0') FROM (SELECT CAST(1 AS NUMBER) flag FROM DUAL) t;", "flagは数値。NULLIF(flag, '')を挿入してはならない。"],
  ["TYPE-03", "NVLの暗黙変換", "SELECT NVL(CAST(NULL AS VARCHAR2(10)), 0) FROM DUAL;", "Oracleは第2引数を文字列へ変換する。PostgreSQL COALESCEのvarcharとintegerは共通型に解決できない。"],
  ["FMT-01", "数値の小数精度", "SELECT TO_CHAR(12.34) FROM DUAL;", "小数のないFM999999999という書式を補完すると12.34の小数部を保持できない。"],
  ["FMT-02", "未知の数値書式", "SELECT TO_NUMBER(amount_txt) FROM t;", "列の実データやNLSを調べず9桁整数書式を補完しており、小数・桁数の意味を保証できない。"],
  ["DATE-01", "TO_DATEの時刻保持", "SELECT TO_DATE('2024-06-15 12:34:56', 'YYYY-MM-DD HH24:MI:SS') FROM DUAL;", "Oracle DATEは時刻を持つ。PostgreSQL to_dateの戻り値は日付のみ。"],
  ["DATE-02", "日付の加算", "SELECT DATE '2024-06-15' + 1 FROM DUAL;", "Oracleの日数加算がTIMESTAMP + integerになり、PostgreSQL標準の演算子がない。"],
  ["DATE-03", "RRの世紀解釈", "SELECT TO_DATE('50-01-01', 'RR-MM-DD') FROM DUAL;", "Oracleの現在年が2026ならRRの50は1950。PostgreSQL YYの50は2020に近い2050。"],
  ["DATE-04", "NLS指定の欠落", "SELECT TO_DATE('15-JUIN-2024', 'DD-MON-YYYY', 'NLS_DATE_LANGUAGE=FRENCH') FROM DUAL;", "第3引数の言語指定を黙って落としており、フランス語の月名を保証できない。"],
  ["DDL-01", "文区切りの破壊", "CREATE TABLE t (id NUMBER) TABLESPACE users;\nCREATE TABLE u (id NUMBER);", "TABLESPACE削除時に最初のセミコロンを消してはならない。"],
  ["DDL-02", "FLOATの精度指定", "CREATE TABLE t (val FLOAT(126));", "DOUBLE PRECISION(126)はPostgreSQLの有効な型指定ではない。"],
  ["DDL-03", "IDENTITYの型", "CREATE TABLE t (id NUMBER GENERATED ALWAYS AS IDENTITY);", "PostgreSQLのIDENTITYには整数型が必要。NUMERICへの一律変換では不足。"],
  ["DDL-04", "NUMBERの精度省略", "CREATE TABLE t (val NUMBER(*,2));", "NUMERIC(*,2)はPostgreSQLの有効な型指定ではない。"],
  ["MERGE-01", "INSERT側のWHERE", "MERGE INTO t USING s ON (t.id=s.id) WHEN NOT MATCHED THEN INSERT (id) VALUES (s.id) WHERE s.active=1;", "INSERT後のWHEREはPostgreSQL 15のMERGE構文へ変換または警告が必要。"],
  ["MERGE-02", "UPDATEとDELETEの組み合わせ", "MERGE INTO t USING s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET t.n=s.n DELETE WHERE t.n=0;", "OracleのUPDATE後DELETE WHEREはPostgreSQL 15でそのまま実行できない。"],
  ["DUAL-01", "DUALの列参照", "SELECT dummy FROM DUAL;", "DUALを消すだけではdummy列の参照先がなくなる。"],
  ["DUAL-02", "DUALとのJOIN", "SELECT t.id FROM DUAL d CROSS JOIN t;", "FROMを消すとSELECT t.id CROSS JOIN tという不正な構文になる。"],
  ["SUB-01", "SUBSTRの長さゼロ", "SELECT SUBSTR('abc', 1, 0) FROM DUAL;", "OracleのNULLとPostgreSQLの空文字の差を扱う必要がある。"],
  ["SUB-02", "SUBSTRの負の長さ", "SELECT SUBSTR('abc', 1, -1) FROM DUAL;", "OracleではNULL。PostgreSQLでは負のsubstring長のエラーになる。"],
  ["SEQ-01", "引用されたシーケンス", 'SELECT "MYSEQ".NEXTVAL FROM DUAL;', "引用されたシーケンスのNEXTVALが未変換のまま残る。"],
  ["WARN-01", "未対応集計の見落とし", "SELECT LISTAGG(name, ',') WITHIN GROUP (ORDER BY name) FROM t;", "標準PostgreSQL 15にはこのOracle LISTAGGがない。変換または警告が必要。"],
  ["WARN-02", "拡張機能依存の見落とし", "SELECT SOUNDEX('hello') FROM DUAL;", "PostgreSQLではfuzzystrmatchなどの拡張が必要だが、依存関係が通知されない。"],
  ["WARN-03", "コメントによる誤警告", "-- fetch two rows\nSELECT * FROM t WHERE ROWNUM <= 2;", "SELECTであるのにSELECT以外のROWNUMという警告になる。"],
  ["LEX-01", "SQLとホスト言語の引用規則", String.raw`SELECT '\' AS slash, NVL(name, 'x') FROM t;`, "Oracleの通常リテラルではバックスラッシュは終端引用符をエスケープしない。現在は未閉じ引用符と誤判定する。"],
];

const controls = [
  ["CONTROL-01", "単純な型置換", "CREATE TABLE t (id NUMBER(10,0), name VARCHAR2(20));", "NUMERIC(10,0)とVARCHAR(20)への基本変換。"],
  ["CONTROL-02", "基本的なリテラル保護", "SELECT 'NVL SYSDATE NUMBER' AS note FROM DUAL;", "リテラル内容の維持とFROM DUALの除去。"],
  ["CONTROL-03", "未対応関数の警告", "SELECT MONTHS_BETWEEN(d1, d2) FROM t;", "関数を保持して意味差の確認を促す既存方針。"],
];

const convert = loadApp().convertOracleToPostgres;
function observe([id, category, input, expectation]) {
  return { id, category, input, expectation, observed: convert(input) };
}
const observations = probes.map(observe);
console.log(JSON.stringify({
  auditDate: "2026-09-07",
  sourceSha256: createHash("sha256").update(readFileSync("index.html")).digest("hex"),
  targetPostgresVersion: "15.17",
  method: "Converter executed locally; SQL semantics assessed against official documentation. No Oracle/PostgreSQL server execution.",
  limitation: "Deliberately selected edge cases, not a representative sample. Counts are not accuracy or failure rates.",
  probeCount: observations.length,
  probesWithNoWarnings: observations.filter(({ observed }) => observed.warnings.length === 0).length,
  controls: controls.map(observe),
  observations,
}, null, 2));
