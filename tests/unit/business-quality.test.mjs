import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "../helpers/load-app.mjs";

const app = () => loadApp({ file: process.env.BUSINESS_QA_SOURCE });
const convert = app().convertOracleToPostgres;

for (const source of [
  "SELECT enable, disable, byte, nocache, noorder, nocycle, storage FROM t;",
  "SELECT STORAGE(1), tablespace users FROM t;",
  "CREATE TABLE enable (disable NUMBER, byte VARCHAR2(10));",
  "CREATE TABLE t (enable NUMBER, disable NUMBER, noorder NUMBER);",
  "SELECT 日本NUMBER, 日付DATE, データNVL(a,b), NVL日本(a,b), 𠮷NUMBER FROM t;",
]) {
  test(`preserves identifiers: ${source}`, () => {
    const expected = source.startsWith("CREATE") ? source.replace(/\bNUMBER\b/g, "NUMERIC").replace("VARCHAR2(10)", "VARCHAR(10)") : source;
    assert.equal(convert(source).sql, expected);
  });
}

for (const identifier of ["a$tag$", "日本$tag$", "a$$", "a$日本$"]) {
  test(`dollar signs in ${identifier} are not quote delimiters`, () => {
    const result = convert(`SELECT ${identifier}, NVL(NULL, 1) FROM DUAL;`);
    assert.equal(result.sql, `SELECT ${identifier}, COALESCE(NULL, 1);`);
    assert.notEqual(result.status, "invalid-input");
  });
}

for (const tag of ["$$", "$tag$", "$日本$"]) {
  test(`preserves complete dollar quoted body ${tag}`, () => {
    const body = `${tag}q'[x]'; NVL(a,b) NUMBER /*${tag}`;
    const result = convert(`SELECT ${body}, NVL(NULL, 1) FROM DUAL;`);
    assert.equal(result.sql, `SELECT ${body}, COALESCE(NULL, 1);`);
    assert.equal(result.warnings.length, 0);
  });
}

test("nested block comments remain byte-identical and do not split statements", () => {
  const comment = "/* outer /* inner */ NVL(a,b); NUMBER */";
  const source = `${comment} SELECT NVL(NULL, 1) FROM DUAL;`;
  assert.equal(convert(source).sql, `${comment} SELECT COALESCE(NULL, 1);`);
  assert.equal(app().highlightSql(comment), `<span class="tok-comment">${comment}</span>`);
  assert.equal(convert("/* outer /* inner */ SELECT 1;").status, "invalid-input");
});

for (const newline of ["\r", "\n", "\r\n"]) {
  test(`line comments end at ${JSON.stringify(newline)}`, () => {
    assert.equal(convert(`-- header${newline}SELECT NVL(NULL, 1) FROM DUAL;`).sql,
      `-- header${newline}SELECT COALESCE(NULL, 1);`);
  });
}

test("mixed line endings inside literal values are preserved", () => {
  const literal = "'first\nsecond\r\nthird\rfourth'";
  assert.equal(convert(`SELECT ${literal} FROM DUAL;\r\nSELECT 1 FROM DUAL;`).sql,
    `SELECT ${literal};\r\nSELECT 1;`);
});

test("Unicode case folding cannot shift subsequent function offsets", () => {
  assert.equal(convert("SELECT İ, NVL(NULL, 1) FROM DUAL;").sql, "SELECT İ, COALESCE(NULL, 1);");
  assert.equal(convert("SELECT İNVL(NULL, 1), NVL(NULL, 2) FROM DUAL;").sql,
    "SELECT İNVL(NULL, 1), COALESCE(NULL, 2);");
  assert.equal(convert("SELECT İ FROM t WHERE TRIM(x) IS NULL;").sql,
    "SELECT İ FROM t WHERE NULLIF(TRIM(x), '') IS NULL;");
  assert.equal(convert("SELECT 日本TRIM(x), TRIM$tag$(x) FROM t WHERE 日本TRIM(x) IS NULL;").sql,
    "SELECT 日本TRIM(x), TRIM$tag$(x) FROM t WHERE 日本TRIM(x) IS NULL;");
});

for (const value of ["$&", "$$", "$`", "$'", "$1", "__SQL_CHANGER_EMBEDDED_0__"]) {
  test(`embedded host strings preserve replacement characters ${value}`, () => {
    const literal = `'${value.replaceAll("'", "''")}'`;
    assert.equal(convert(`const sql = "SELECT ${literal} FROM DUAL;";`).sql,
      `const sql = "SELECT ${literal};";`);
  });
}

test("DDL storage removal respects comments and balanced parentheses", () => {
  const source = "CREATE TABLE t (n NUMBER) STORAGE(INITIAL 64K /* ) */ NEXT 64K) TABLESPACE users;";
  assert.equal(convert(source).sql, "CREATE TABLE t (n NUMERIC) /* ) */ ;");
});

test("DDL options are removed only after the object name and body", () => {
  assert.equal(convert("CREATE SEQUENCE nocache START WITH 1 NOCACHE NOORDER;").sql,
    "CREATE SEQUENCE nocache START WITH 1 CACHE 1 ;");
  assert.equal(convert("CREATE TABLE t (id NUMBER PRIMARY KEY ENABLE, enable NUMBER);").sql,
    "CREATE TABLE t (id NUMERIC PRIMARY KEY , enable NUMERIC);");
});

test("character length semantics are normalized inside type declarations", () => {
  assert.equal(convert("CREATE TABLE t (a VARCHAR2(10 CHAR), b VARCHAR2(20 BYTE));").sql,
    "CREATE TABLE t (a VARCHAR(10), b VARCHAR(20));");
});

test("clear and undo preserve source and backward selection", () => {
  const { context, elements } = app();
  const input = elements.get("oracleSql");
  input.value = "SELECT NVL(NULL, 1) FROM DUAL;";
  input.setSelectionRange(3, 12, "backward");
  input.scrollTop = 24;
  context.convert();
  context.clearOracle();
  context.undoClear();
  assert.equal(input.value, "SELECT NVL(NULL, 1) FROM DUAL;");
  assert.equal(input.selectionDirection, "backward");
  assert.equal(input.selectionStart, 3);
  assert.equal(input.selectionEnd, 12);
  assert.equal(input.scrollTop, 24);
});

test("unavailable selection during copy fallback resolves with existing failure feedback", async () => {
  const { context, elements } = app();
  elements.get("postgresSql").value = "SELECT 1;";
  context.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
  context.window.getSelection = () => null;
  await context.copyPostgres();
  assert.equal(elements.get("copyPostgresButton").getAttribute("aria-label"), "コピーできませんでした");
  assert.equal(elements.get("copyPostgresButton").getAttribute("aria-busy"), null);
});

test("a transient conversion failure can retry the unchanged source", () => {
  const { context, elements } = app();
  const original = context.convertOracleToPostgres;
  elements.get("oracleSql").value = "SELECT 1 FROM DUAL;";
  context.convertOracleToPostgres = () => { throw new Error("temporary failure"); };
  context.convert();
  assert.equal(elements.get("outputStatus").dataset.state, "invalid-input");
  context.convertOracleToPostgres = original;
  context.convert();
  assert.equal(elements.get("postgresSql").value, "SELECT 1;");
});

test("copy success resets after two seconds without a toast", async () => {
  const { context, elements, advanceTime } = app();
  elements.get("postgresSql").value = "SELECT 1;";
  await context.copyPostgres();
  const button = elements.get("copyPostgresButton");
  assert.equal(context.__copiedText, "SELECT 1;");
  assert.equal(button.getAttribute("aria-label"), "コピーしました");
  assert.equal(elements.get("toast").textContent, "");
  advanceTime(1999);
  assert.equal(button.dataset.copied, "true");
  advanceTime(1);
  assert.equal(button.getAttribute("aria-label"), "PostgreSQLをコピー");
});

for (const staleAction of ["edit", "clear", "pagehide"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(`stale clipboard ${outcome} after ${staleAction} cannot claim success or copy fallback data`, async () => {
      const { context, elements } = app();
      elements.get("oracleSql").value = "SELECT 1 FROM DUAL;";
      context.convert();
      let complete;
      let writes = 0;
      let fallbacks = 0;
      context.navigator.clipboard.writeText = () => {
        writes += 1;
        return new Promise((resolve, reject) => { complete = outcome === "resolve" ? resolve : reject; });
      };
      context.document.execCommand = () => { fallbacks += 1; return true; };
      const copying = context.copyPostgres();
      await context.copyPostgres();
      assert.equal(writes, 1);
      if (staleAction === "edit") {
        elements.get("oracleSql").value = "SELECT 2 FROM DUAL;";
        context.convert();
      } else if (staleAction === "clear") context.clearOracle();
      else context.window.dispatchEvent({ type: "pagehide" });
      complete();
      await copying;
      const button = elements.get("copyPostgresButton");
      assert.equal(button.dataset.copied, "false");
      assert.equal(button.getAttribute("aria-busy"), null);
      assert.equal(fallbacks, 0);
    });
  }
}

test("protected data survives a deterministic lexical boundary corpus", () => {
  const payloads = ["NUMBER NVL(a,b); FROM DUAL", "$& $` $' $$", "日本語 𠮷 İ", "</script><img src=x onerror=alert(1)>", "a\rb\nc\r\nd", "/* nested */ ) , '"];
  const wrappers = [
    (s) => `'${s.replaceAll("'", "''")}'`,
    (s) => `"${s.replaceAll('"', '""')}"`,
    (s) => `$qa$${s}$qa$`,
    (s) => `q'[${s}]'`,
    (s) => `/* ${s} */`,
  ];
  for (const payload of payloads) for (const wrap of wrappers) {
    const token = wrap(payload);
    const source = `SELECT ${token}, NVL(NULL, 1) FROM DUAL;`;
    assert.equal(convert(source).sql, `SELECT ${token}, COALESCE(NULL, 1);`);
  }
});
