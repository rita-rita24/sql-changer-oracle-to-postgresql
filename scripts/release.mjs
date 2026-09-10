import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildRelease } from "./build-release.mjs";

const sourceSha256 = createHash("sha256").update(await readFile("index.html")).digest("hex");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const steps = ["lint", "check:syntax", "test:unit", "test:e2e", "test:mutation", "test:databases"];
const checks = [];
for (const name of steps) {
  console.log(`\nRelease check: ${name}`);
  const startedAt = new Date().toISOString();
  await new Promise((done, reject) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", name], { stdio: "inherit", env: { ...process.env, SQL_CHANGER_COMPARISON_REPORT: "reports/database-comparison-latest.json" } });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`${name} failed (${code}); release was not built`)));
  });
  checks.push({ name, passed: true, startedAt, finishedAt: new Date().toISOString() });
}
await buildRelease({ version: pkg.version, sourceSha256, checks });
