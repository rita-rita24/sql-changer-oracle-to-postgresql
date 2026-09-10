import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
      if (result.status !== 0) throw new Error(`Syntax check failed: ${path}`);
    }
  }
}
await check("scripts");
await check("tests");
await import("./build-check.mjs");
console.log("All application and test JavaScript syntax checks passed (not static type checking).");
