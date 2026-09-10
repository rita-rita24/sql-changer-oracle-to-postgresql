import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

export async function buildRelease(validation) {
  const source = await readFile("index.html");
  const sha256 = createHash("sha256").update(source).digest("hex");
  assert.equal(validation.sourceSha256, sha256, "Validated source changed during release");
  const comparison = JSON.parse(await readFile("reports/database-comparison-latest.json", "utf8"));
  assert.ok(comparison.passed && comparison.oracleExecuted && comparison.postgresExecuted && comparison.cleanupComplete, "Both database engines must execute and all cases must pass");
  assert.equal(comparison.sourceSha256, sha256, "Stale database comparison");
  assert.equal(comparison.corpusSha256, createHash("sha256").update(await readFile("tests/fixtures/database-cases.mjs")).digest("hex"), "Stale comparison corpus");
  await mkdir("dist", { recursive: true });
  for (const file of ["index.html", "README.md", "CONVERSION_POLICY.md"]) await copyFile(file, `dist/${file}`);
  await copyFile("reports/database-comparison-latest.json", "dist/database-comparison.json");
  const manifest = { ...validation, databaseComparison: comparison.summary, oracleVersion: comparison.oracleVersion, postgresVersion: comparison.postgresVersion, builtAt: new Date().toISOString() };
  await writeFile("dist/validation.json", JSON.stringify(manifest, null, 2) + "\n");
  await writeFile("dist/SHA256SUMS", `${sha256}  index.html\n`);
  console.log(`Release built: dist/index.html (SHA-256 ${sha256})`);
}
