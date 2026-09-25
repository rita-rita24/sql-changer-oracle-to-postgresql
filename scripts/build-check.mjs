import { appFile } from "./app-config.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const filename = appFile;
const html = readFileSync(filename, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];

assert.ok(html.includes("<!doctype html>"), `${filename} must be a standalone HTML document`);
assert.ok(scriptMatch, `${filename} must contain an inline application script`);
assert.ok(html.includes('id="oracleSql"'), "Oracle editor must exist");
assert.ok(html.includes('id="postgresHighlight"'), "PostgreSQL output highlight must exist");

for (const [index, script] of scripts.entries()) {
  new vm.Script(script[1], { filename: `${filename}<script ${index + 1}>` });
}

console.log(`build-check: ${filename} parsed and application script compiles`);
