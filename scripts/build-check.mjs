import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("index.html", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];

assert.ok(html.includes("<!doctype html>"), "index.html must be a standalone HTML document");
assert.ok(scriptMatch, "index.html must contain an inline application script");
assert.ok(html.includes('id="oracleSql"'), "Oracle editor must exist");
assert.ok(html.includes('id="postgresHighlight"'), "PostgreSQL output highlight must exist");

for (const [index, script] of scripts.entries()) {
  new vm.Script(script[1], { filename: `index.html<script ${index + 1}>` });
}

console.log("build-check: index.html parsed and application script compiles");
