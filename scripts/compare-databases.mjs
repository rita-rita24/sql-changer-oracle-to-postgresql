import { appFile, databaseCasesFile } from "./app-config.mjs";
// Real, disposable database comparison. Missing Docker/images/DB startup is a
// failure, never a skipped or successful comparison. No existing DB is touched.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import oracledb from "oracledb";
import pg from "pg";
import { loadApp } from "../tests/helpers/load-app.mjs";
import { decimal } from "../tests/helpers/decimal-value.mjs";
import { compareResults, oracleTypeFamily, postgresTypeFamily } from "../tests/helpers/compare-results.mjs";

const corpusFile = databaseCasesFile;
const { databaseCases, generation, holdoutGeneration } = await import(pathToFileURL(resolve(corpusFile)).href);
assert.equal(new Set(databaseCases.map((fixture) => fixture.id)).size, databaseCases.length, "Duplicate database case IDs");

process.env.TZ = "UTC";
oracledb.fetchAsString = [oracledb.NUMBER];
const run = promisify(execFile);
const context = process.env.SQL_CHANGER_DOCKER_CONTEXT;
const dockerArgs = context ? ["--context", context] : [];
const docker = async (...args) => (await run("docker", [...dockerArgs, ...args], { env: environment, timeout: 600_000, maxBuffer: 8_000_000 })).stdout.trim();
const password = `Test_${randomBytes(18).toString("hex")}`;
const environment = { ...process.env, ORACLE_PASSWORD: password, APP_USER: "converter_test", APP_USER_PASSWORD: password, POSTGRES_PASSWORD: password, POSTGRES_USER: "converter_test", POSTGRES_DB: "converter_test" };
const images = { oracle: "gvenzl/oracle-free:23.26.3-slim@sha256:6d61d267a3b978c24c5ac1790e62e927416a0aec446bd86e4b3a1527562757bd", postgres: "postgres:15.17@sha256:32016c79bea24c14917660106bc23a03341d94b9983aeb41f4130b4f3fbd6dd0" };
const reportPath = process.env.SQL_CHANGER_COMPARISON_REPORT || "reports/database-comparison-latest.json";
const convert = loadApp().convertOracleToPostgres;
const created = [];
const sourceFile = appFile;
const report = { schemaVersion: 2, startedAt: new Date().toISOString(), sourceFile, sourceSha256: createHash("sha256").update(await readFile(sourceFile)).digest("hex"), corpusFile, corpusSha256: createHash("sha256").update(JSON.stringify(databaseCases)).digest("hex"), generation, holdoutGeneration, oracleExecuted: false, postgresExecuted: false, images: {}, cases: [], cleanupComplete: false, passed: false };
let oracle, postgres;

async function start(engine, port, envNames) {
  console.log(`Starting disposable ${engine} (${images[engine]})`);
  const name = `sql-changer-${engine}-${randomBytes(5).toString("hex")}`;
  // Record the exact intended name before starting, including interrupted starts.
  created.push(name);
  await docker("run", "--detach", "--name", name, "--label", "sql-changer.validation=true", "--publish", `127.0.0.1::${port}`, ...envNames.flatMap((n) => ["--env", n]), images[engine]);
  const binding = JSON.parse(await docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", name))[`${port}/tcp`][0];
  const imageId = await docker("inspect", "--format", "{{.Image}}", name);
  report.images[engine] = { tag: images[engine], imageId, digests: JSON.parse(await docker("image", "inspect", "--format", "{{json .RepoDigests}}", imageId)) };
  return Number(binding.HostPort);
}
async function ready(connect, name) {
  let last;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { return await connect(); } catch (error) { last = error; }
    if (attempt % 10 === 0) console.log(`Waiting for ${name} initialization (${attempt * 2}s)`);
    await delay(2000);
  }
  throw new Error(`${name} did not start: ${last?.code || last?.message}`);
}
function normalize(value, numeric) {
  if (value === null || value === undefined) return null;
  if (numeric || typeof value === "number") return { type: "number", value: decimal(value) };
  if (value instanceof Date) return { type: "datetime", value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { type: "bytes", value: value.toString("hex") };
  return { type: typeof value, value };
}
async function query(engine, sql) {
  try {
    if (engine === "oracle") {
      const result = await oracle.execute(sql.replace(/;\s*$/, ""), [], { autoCommit: true });
      return { rows: result.rows?.map((row) => row.map((v, i) => normalize(v, result.metaData[i].dbType === oracledb.DB_TYPE_NUMBER))), columnTypes: result.metaData?.map((field) => oracleTypeFamily(field.dbTypeName)), affected: result.rowsAffected };
    }
    const result = await postgres.query({ text: sql, rowMode: "array" });
    return { rows: result.command === "SELECT" ? result.rows.map((row) => row.map((v, i) => normalize(v, [20,21,23,700,701,1700].includes(result.fields[i].dataTypeID)))) : undefined, columnTypes: result.command === "SELECT" ? result.fields.map((field) => postgresTypeFamily(field.dataTypeID)) : undefined, affected: result.command === "SELECT" ? undefined : result.rowCount ?? undefined };
  } catch (error) { return { error: engine === "oracle" ? `ORA-${String(error.errorNum).padStart(5, "0")}` : error.code, message: error.message.split("\n")[0] }; }
}
async function required(engine, sql) {
  const result = await query(engine, sql);
  assert.ok(!result.error, `${engine} setup failed: ${result.message}`);
}
try {
  const oraclePort = await start("oracle", 1521, ["ORACLE_PASSWORD", "APP_USER", "APP_USER_PASSWORD"]);
  const postgresPort = await start("postgres", 5432, ["POSTGRES_PASSWORD", "POSTGRES_USER", "POSTGRES_DB"]);
  oracle = await ready(() => oracledb.getConnection({ user: "converter_test", password, connectString: `127.0.0.1:${oraclePort}/FREEPDB1`, connectTimeout: 5 }), "Oracle");
  postgres = await ready(async () => {
    const client = new pg.Client({ host: "127.0.0.1", port: postgresPort, user: "converter_test", password, database: "converter_test", connectionTimeoutMillis: 5000 });
    try { await client.connect(); return client; } catch (error) { await client.end(); throw error; }
  }, "PostgreSQL");
  report.oracleVersion = (await oracle.execute("SELECT banner_full FROM v$version")).rows[0][0];
  report.postgresVersion = (await postgres.query("SHOW server_version")).rows[0].server_version;
  assert.match(report.postgresVersion, /^15\.17(?:\s|$)/);
  assert.ok(new Date().getUTCFullYear() >= 2000 && new Date().getUTCFullYear() <= 2049, "RR-century fixture needs reviewing outside 2000–2049");
  report.oracleExecuted = true;
  report.postgresExecuted = true;
  console.log(`Connected: ${report.oracleVersion.split("\n")[0]} / PostgreSQL ${report.postgresVersion}`);
  await required("oracle", "ALTER SESSION SET TIME_ZONE = '+00:00'");
  await required("oracle", "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYYMMDD'");
  await required("oracle", "ALTER SESSION SET NLS_NUMERIC_CHARACTERS = '.,'");
  await required("postgres", "SET TIME ZONE 'UTC'");
  await required("postgres", "SET statement_timeout = '10s'");
  report.oracleSession = (await oracle.execute("SELECT parameter,value FROM nls_session_parameters ORDER BY parameter")).rows;
  report.oracleCharacterSets = (await oracle.execute("SELECT parameter,value FROM nls_database_parameters WHERE parameter IN ('NLS_CHARACTERSET','NLS_NCHAR_CHARACTERSET') ORDER BY parameter")).rows;
  for (const sql of ["CREATE TABLE data_rows (id NUMBER, note VARCHAR2(80), n NUMBER)", "CREATE TABLE source_rows (id NUMBER, note VARCHAR2(80), n NUMBER)", "INSERT INTO data_rows VALUES (1,'one',0)", "INSERT INTO data_rows VALUES (2,'two',0)", "INSERT INTO data_rows VALUES (3,'three',0)", "INSERT INTO source_rows VALUES (1,'source',2)"]) {
    await required("oracle", sql); await required("postgres", convert(sql).sql);
  }
  for (const fixture of databaseCases) {
    if (fixture.timezone) {
      assert.match(fixture.timezone, /^[A-Za-z_]+\/[A-Za-z_]+$/);
      await required("oracle", `ALTER SESSION SET TIME_ZONE = '${fixture.timezone}'`);
      await postgres.query("SELECT set_config('TimeZone', $1, false)", [fixture.timezone]);
    }
    const conversion = convert(fixture.source);
    const originalResult = await query("oracle", fixture.source);
    const convertedResult = await query("postgres", conversion.sql);
    let oracleResult = originalResult, postgresResult = convertedResult;
    if (!originalResult.error && !convertedResult.error) {
      for (const sql of fixture.after || []) { await required("oracle", sql); await required("postgres", convert(sql).sql); }
      if (fixture.verify) { oracleResult = await query("oracle", fixture.verify); postgresResult = await query("postgres", convert(fixture.verify).sql); }
    }
    const issues = [];
    if (oracleResult.error && !fixture.expectedErrors) issues.push(`Oracle source failed: ${oracleResult.error}`);
    const comparison = compareResults(oracleResult, postgresResult, { affected: !fixture.verify, warnings: conversion.warnings });
    const actualEqual = comparison.equivalent;
    if (fixture.expectedErrors) {
      if (oracleResult.error !== fixture.expectedErrors.oracle || postgresResult.error !== fixture.expectedErrors.postgres) issues.push("Invalid input was not rejected with the expected database errors");
    } else if (fixture.exception) {
      const ex = fixture.exception;
      if (!conversion.warnings.length) issues.push("Policy exception has no user-visible warning");
      if (ex.oracle && !isDeepStrictEqual(ex.oracle, oracleResult.rows)) issues.push("Oracle differs from the explicit exception expectation");
      if (ex.postgresError ? postgresResult.error !== ex.postgresError : postgresResult.error || !isDeepStrictEqual(ex.postgres, postgresResult.rows)) issues.push("PostgreSQL differs from the explicit exception expectation");
    } else if (!actualEqual) issues.push("Unexpected value/type/row-count difference");
    const record = { id: fixture.id, category: fixture.category, source: fixture.source, converted: conversion.sql, warnings: conversion.warnings, oracle: oracleResult, postgres: postgresResult, ...comparison, compareColumnTypes: true, disposition: fixture.expectedErrors ? "rejected-input" : fixture.exception ? "policy-exception" : "equivalent", exception: fixture.exception, expectedErrors: fixture.expectedErrors, timezone: fixture.timezone, passed: !issues.length, issues };
    report.cases.push(record);
    if (issues.length) console.log(`FAIL ${fixture.id}: ${issues.join("; ")}`);
    if (report.cases.length % 250 === 0) console.log(`Compared ${report.cases.length}/${databaseCases.length} cases`);
    if (fixture.timezone) {
      await required("oracle", "ALTER SESSION SET TIME_ZONE = '+00:00'");
      await required("postgres", "SET TIME ZONE 'UTC'");
    }
  }
  report.summary = { total: report.cases.length, equivalent: report.cases.filter((r) => r.passed && r.disposition === "equivalent").length, policyExceptions: report.cases.filter((r) => r.passed && r.disposition === "policy-exception").length, rejectedInputs: report.cases.filter((r) => r.passed && r.disposition === "rejected-input").length, failed: report.cases.filter((r) => !r.passed).length };
  report.summary.silentMismatches = report.cases.filter((r) => r.classification === "silent-mismatch").length;
  report.summary.silentExecutionErrors = report.cases.filter((r) => r.classification === "silent-execution-error" && !r.expectedErrors).length;
  report.summary.sourceErrors = report.cases.filter((r) => r.classification === "source-error" && !r.expectedErrors).length;
  report.passed = report.summary.failed === 0;
} catch (error) { report.fatalError = error.message; process.exitCode = 1; }
finally {
  const closed = await Promise.allSettled([oracle?.close(), postgres?.end()]);
  const cleanup = await Promise.allSettled(created.map((name) => docker("rm", "--force", "--volumes", name)));
  report.cleanupComplete = cleanup.every((r) => r.status === "fulfilled") && closed.every((r) => r.status === "fulfilled");
  report.finishedAt = new Date().toISOString();
  if (!report.cleanupComplete) report.passed = false;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, ...report.summary, fatalError: report.fatalError, cleanupComplete: report.cleanupComplete, reportPath }));
  if (!report.passed) process.exitCode = 1;
}
