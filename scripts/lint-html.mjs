import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

assert.deepEqual(duplicates, [], `duplicate ids found: ${duplicates.join(", ")}`);
assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline event handlers are not allowed");
assert.match(html, /<textarea[^>]+id="oracleSql"[^>]+aria-label=/, "Oracle textarea needs an accessible name");
assert.doesNotMatch(html, /letter-spacing:\s*-/i, "negative letter-spacing is not allowed");
assert.doesNotMatch(html, /waitForTimeout/, "tests must not rely on waitForTimeout");

console.log("lint-html: static HTML checks passed");
