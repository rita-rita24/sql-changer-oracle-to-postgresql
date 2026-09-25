import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { appFile, databaseCasesFile } from "./app-config.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export async function writeReleaseReport(validation) {
  const source = await readFile(appFile);
  const sha256 = createHash("sha256").update(source).digest("hex");
  assert.equal(validation.sourceSha256, sha256, "Validated source changed during release");
  const comparison = JSON.parse(await readFile("reports/database-comparison-latest.json", "utf8"));
  assert.ok(comparison.passed && comparison.oracleExecuted && comparison.postgresExecuted && comparison.cleanupComplete, "Both database engines must execute and all cases must pass");
  assert.equal(comparison.sourceSha256, sha256, "Stale database comparison");
  assert.equal(comparison.corpusSha256, createHash("sha256").update(JSON.stringify((await import(pathToFileURL(resolve(databaseCasesFile)).href)).databaseCases)).digest("hex"), "Stale comparison corpus");
  await mkdir("reports", { recursive: true });
  // The validated source is also the distributable; keep only one app HTML.
  const sourceFile = relative(resolve("reports"), resolve(appFile)).split(sep).join("/");
  const manifest = { ...validation, sourceFile, databaseComparison: comparison.summary, oracleVersion: comparison.oracleVersion, postgresVersion: comparison.postgresVersion, builtAt: new Date().toISOString() };
  await writeFile("reports/release-validation.json", JSON.stringify(manifest, null, 2) + "\n");
  await writeFile("reports/release-SHA256SUMS", `${sha256}  ${sourceFile}\n`);
  await writeFile("reports/release-verification.md", `# 単一HTMLの検証記録\n\n作成日時: ${manifest.builtAt}\n\n対象: [${appFile}](${sourceFile})\n\n検証済みの本体HTMLをそのまま利用・配布します。検証記録はreportsに集約します。\n\nSHA-256: ${sha256}\n\n検査: ${validation.checks.map((check) => check.name).join(", ")}\n\n実DB比較: ${JSON.stringify(comparison.summary)}\n\n検証の詳細は [release-validation.json](release-validation.json) と [database-comparison-latest.json](database-comparison-latest.json) を参照してください。\n`);
  console.log(`Release verified: ${appFile} (SHA-256 ${sha256}); evidence saved in reports/`);
}
