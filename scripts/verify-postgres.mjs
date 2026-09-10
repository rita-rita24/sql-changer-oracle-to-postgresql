// Optional execution checks against a fresh, disposable PostgreSQL 15.17 cluster.
// Install embedded-postgres@15.17.0-beta.17 separately and set SQL_CHANGER_PG_MODULE
// to its dist/index.js. Never connects to an existing database or reads credentials.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp } from "../tests/helpers/load-app.mjs";

const modulePath = process.env.SQL_CHANGER_PG_MODULE;
if (!modulePath) throw new Error("Set SQL_CHANGER_PG_MODULE to embedded-postgres@15.17.0-beta.17/dist/index.js. See CONVERSION_POLICY.md.");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(modulePath)).href);
const reservation = createServer();
await new Promise((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const databaseDir = await mkdtemp(join(tmpdir(), "sql-changer-pg15-"));
const logs = [];
const pg = new EmbeddedPostgres({
  databaseDir, port, user: "postgres", password: randomUUID(),
  persistent: false, createPostgresUser: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", `unix_socket_directories=${databaseDir}`],
  onLog(message) { logs.push(String(message)); if (logs.length > 5) logs.shift(); },
  onError(message) { logs.push(String(message)); if (logs.length > 5) logs.shift(); },
});
const convert = loadApp().convertOracleToPostgres;
const checks = [];
let client;
try {
  await pg.initialise();
  await pg.start();
  client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const version = (await client.query("SHOW server_version")).rows[0].server_version;
  assert.match(version, /^15\.17(?:\s|$)/);
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("CREATE TABLE t (id integer, note text, n integer); INSERT INTO t VALUES (1, '', 0), (2, '', 0), (3, '', 0); CREATE TABLE s (id integer, note text, n integer); INSERT INTO s VALUES (1, 'x', 2);");

  async function scalar(id, source, expected, category = "fixed") {
    const converted = convert(source);
    const result = await client.query(converted.sql);
    const actual = Object.values(result.rows[0])[0];
    assert.equal(actual, expected, id);
    if (category === "policy-limitation") assert.ok(converted.warnings.length > 0, id);
    checks.push({ id, category, input: source, sql: converted.sql, actual, warnings: converted.warnings });
  }
  async function execute(id, source, verifySql, expectedRows) {
    const converted = convert(source);
    await client.query(converted.sql);
    const { rows } = await client.query(verifySql);
    assert.deepEqual(rows, expectedRows, id);
    checks.push({ id, category: "fixed", input: source, sql: converted.sql, actual: rows, warnings: converted.warnings });
  }
  async function expectedError(id, source, expectedCode) {
    const converted = convert(source);
    assert.ok(converted.warnings.length > 0, id);
    await assert.rejects(client.query(converted.sql), (error) => {
      assert.equal(error.code, expectedCode, id);
      checks.push({ id, category: "policy-limitation", input: source, sql: converted.sql, expectedErrorCode: error.code, warnings: converted.warnings });
      return true;
    });
  }

  await execute("update-literal", "UPDATE t a SET a.note = 'a.id=1' WHERE a.id=1;", "SELECT note FROM t WHERE id=1", [{ note: "a.id=1" }]);
  await execute("merge-literal", "MERGE INTO t USING s ON (t.id=s.id) WHEN MATCHED THEN UPDATE SET t.note='INSERT (t.id)';", "SELECT note FROM t WHERE id=1", [{ note: "INSERT (t.id)" }]);
  await scalar("nested-nvl", "SELECT NVL(NVL(CAST(NULL AS VARCHAR2(10)), ''), 'fallback') FROM DUAL;", "fallback");
  await scalar("nested-decode", "SELECT DECODE(1, 1, DECODE(2, 2, 'yes', 'no'), 'other') FROM DUAL;", "yes");
  await scalar("comment-function", "SELECT NVL/* , ) ; */(CAST(NULL AS VARCHAR2(10)), 'fallback') FROM DUAL;", "fallback");
  await scalar("null-nvl2", "SELECT NVL2('', 1, 0) FROM DUAL;", 0);
  await scalar("null-decode", "SELECT DECODE(CAST(NULL AS NUMBER), CAST(NULL AS NUMBER), 1, 0) FROM DUAL;", 1);
  await scalar("numeric-input", "SELECT TO_NUMBER(123) FROM DUAL;", "123");
  await scalar("decimal-input", "SELECT TO_NUMBER('12.34') FROM DUAL;", "12.34");
  await scalar("nvl-common-type", "SELECT NVL(CAST(NULL AS VARCHAR2(10)), 0) FROM DUAL;", "0");
  await scalar("substring-zero", "SELECT SUBSTR('abc', 1, 0) FROM DUAL;", null);
  await scalar("substring-negative", "SELECT SUBSTR('abc', 1, -1) FROM DUAL;", null);
  await scalar("substring-out-of-range", "SELECT SUBSTR('abc', -9) FROM DUAL;", null);
  await scalar("backslash", String.raw`SELECT '\' FROM DUAL;`, "\\");
  await scalar("protected-rownum-literal", "SELECT 'WHERE ORDER BY' FROM t WHERE ROWNUM <= 2;", "WHERE ORDER BY");
  const bounded = convert("SELECT * FROM t WHERE ROWNUM <= 10 AND ROWNUM <= 2;");
  assert.equal((await client.query(bounded.sql)).rows.length, 2);
  checks.push({ id: "multiple-rownum-bounds", category: "fixed", sql: bounded.sql, rowCount: 2 });
  await execute("ddl-separator", "CREATE TABLE storage_a (id NUMBER) TABLESPACE users;\nCREATE TABLE storage_b (id NUMBER);", "SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_name IN ('storage_a', 'storage_b')", [{ n: 2 }]);
  await execute("quoted-ddl", 'CREATE TABLE "DATE" ("NUMBER" NUMBER);', "SELECT column_name FROM information_schema.columns WHERE table_name='DATE'", [{ column_name: "NUMBER" }]);
  await execute("float-precision", "CREATE TABLE float_probe (v FLOAT(126));", "SELECT data_type FROM information_schema.columns WHERE table_name='float_probe'", [{ data_type: "double precision" }]);
  await client.query('CREATE SEQUENCE "MYSEQ"');
  await scalar("quoted-sequence", 'SELECT "MYSEQ".NEXTVAL FROM DUAL;', "1");

  // These differences deliberately remain under the user's unchanged policies.
  await scalar("policy-numeric-format", "SELECT TO_CHAR(12.34) FROM DUAL;", "12", "policy-limitation");
  const dated = convert("SELECT TO_DATE('2024-06-15 12:34:56', 'YYYY-MM-DD HH24:MI:SS') FROM DUAL;");
  assert.ok(dated.warnings.some((w) => w.includes("時刻")));
  const dateRow = (await client.query(`SELECT pg_typeof(d)::text AS type, to_char(d, 'HH24:MI:SS') AS time FROM (${dated.sql.replace(/;\s*$/, "")}) q(d)`)).rows[0];
  assert.deepEqual(dateRow, { type: "date", time: "00:00:00" });
  checks.push({ id: "policy-date-time", category: "policy-limitation", sql: dated.sql, actual: dateRow, warnings: dated.warnings });
  await expectedError("policy-date-arithmetic", "SELECT DATE '2024-06-15' + 1 FROM DUAL;", "42883");
  await expectedError("policy-identity-type", "CREATE TABLE identity_probe (id NUMBER GENERATED ALWAYS AS IDENTITY);", "22023");
  await expectedError("policy-unknown-column-type", "SELECT NVL(flag, '0') FROM (SELECT CAST(1 AS NUMBER) flag FROM DUAL) t;", "22P02");
  await expectedError("manual-aggregate-rownum", "SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;", "42703");

  const sourceSha256 = createHash("sha256").update(await readFile("index.html")).digest("hex");
  const report = { sourceSha256, postgresVersion: version, oracleExecuted: false, disposableCluster: true, passed: checks.length, fixes: checks.filter((c) => c.category === "fixed").length, policyLimitations: checks.filter((c) => c.category === "policy-limitation").length, checks };
  if (process.env.SQL_CHANGER_PG_REPORT) await writeFile(process.env.SQL_CHANGER_PG_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(`postgres verification: ${report.passed} checks passed on ${version} (${report.fixes} fixes, ${report.policyLimitations} explicit limitations)`);
} catch (error) {
  if (!client) console.error(logs.join("\n"));
  throw error;
} finally {
  if (client) await client.end();
  await pg.stop();
  await rm(databaseDir, { recursive: true, force: true });
}
