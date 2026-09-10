import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "../helpers/load-app.mjs";

test("reports input errors and locates review items by SQL statement", () => {
  const { convertOracleToPostgres: convert } = loadApp();
  const result = convert("SELECT 1 FROM DUAL;\n\nSELECT COUNT(*) FROM t WHERE ROWNUM<=2;");
  assert.equal(result.status, "review-required");
  assert.equal(result.diagnostics[0].statement, 2);
  assert.equal(result.diagnostics[0].line, 3);
  assert.equal(convert("SELECT 'unclosed").status, "invalid-input");
  assert.equal(convert("SELECT 1 FROM DUAL;").status, "converted-unverified");
  assert.equal(convert("  ").status, "empty");
});

test("copy fallback failure is reported without claiming success", async () => {
  const { context, elements } = loadApp();
  elements.get("postgresSql").value = "SELECT 1;";
  context.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
  context.document.execCommand = () => false;
  await context.copyPostgres();
  assert.match(elements.get("toast").textContent, /コピーできません/);
  context.document.execCommand = () => { throw new Error("blocked"); };
  await context.copyPostgres();
  assert.match(elements.get("toast").textContent, /コピーできません/);
});

test("Oracle empty results remain NULL for literal function boundaries", () => {
  const { convertOracleToPostgres: convert } = loadApp();
  for (const expression of ["NVL(NULL, '')", "NVL2(1, '', 'x')", "DECODE(1, 1, '', 'x')"]) {
    assert.match(convert(`SELECT ${expression} FROM DUAL`).sql, /NULL/);
  }
  for (const expression of ["SUBSTR('abc', 4)", "SUBSTR('日本語', 4, 2)", "SUBSTR('', 1)"]) {
    assert.equal(convert(`SELECT ${expression} FROM DUAL`).sql, "SELECT NULL");
  }
});
