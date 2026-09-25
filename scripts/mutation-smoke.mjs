import assert from "node:assert/strict";

import { loadApp } from "../tests/helpers/load-app.mjs";

function replaceRequired(script, search, replacement) {
  const found = search instanceof RegExp ? search.test(script) : script.includes(search);
  assert.ok(found, `mutation target not found: ${search}`);
  return script.replace(search, replacement);
}

const mutants = [
  {
    name: "disable VARCHAR2 conversion",
    mutateScript: (script) =>
      replaceRequired(
        script,
        '[/\\bVARCHAR2\\s*\\(/gi, "VARCHAR("],',
        '[/\\bVARCHAR2_DISABLED\\s*\\(/gi, "VARCHAR("],'
      ),
    assertion(convert) {
      assert.match(convert("CREATE TABLE t (name VARCHAR2(10));").sql, /VARCHAR\(10\)/);
    }
  },
  {
    name: "remove protected-range guard from regex replacement",
    mutateScript: (script) =>
      replaceRequired(
        script,
        /if\s*\(isProtectedIndex\(\(ranges\s*\?\?=\s*getSqlProtectedRanges\(sql\)\),\s*offset\)\)\s*\{\s*return match;\s*\}/,
        ""
      ),
    assertion(convert) {
      assert.match(
        convert("SELECT 'VARCHAR2 NUMBER' AS text FROM DUAL;").sql,
        /'VARCHAR2 NUMBER' AS text/
      );
    }
  },
  {
    name: "break ROWNUM limit appending",
    mutateScript: (script) =>
      replaceRequired(
        script,
        "return `${trimmedBody}\\n${comments}LIMIT ${limit}${semicolon}`;",
        "return `${trimmedBody}${semicolon}`;"
      ),
    assertion(convert) {
      assert.equal(
        convert("SELECT * FROM users WHERE ROWNUM <= 10;").sql,
        "SELECT * FROM users\nLIMIT 10;"
      );
    }
  },
  {
    name: "restore invalid numeric TRUNC date_trunc conversion",
    mutateScript: (script) =>
      replaceRequired(
        script,
        'return formatCall("TRUNC", args, argsText, context);',
        "return `date_trunc('day', ${args[0]})`;"
      ),
    assertion(convert) {
      const result = convert("SELECT TRUNC(amount) FROM DUAL;");
      assert.match(result.sql, /TRUNC\(amount\)/);
      assert.doesNotMatch(result.sql, /date_trunc/);
    }
  },
  {
    name: "restore MONTHS_BETWEEN approximation",
    mutateScript: (script) =>
      replaceRequired(
        script,
        /context\.warnings\?\.push\(\s*"MONTHS_BETWEEN はOracleの月末\/小数月セマンティクスと差が出やすいため、自動近似せず手動確認してください。"\s*\);\s*return `MONTHS_BETWEEN\(\$\{argsText\}\)`;/,
        "return `(EXTRACT(YEAR FROM age(${args[0]}, ${args[1]})) * 12 + EXTRACT(MONTH FROM age(${args[0]}, ${args[1]})))`;"
      ),
    assertion(convert) {
      const result = convert("SELECT MONTHS_BETWEEN(end_date, start_date) FROM DUAL;");
      assert.equal(result.sql, "SELECT MONTHS_BETWEEN(end_date, start_date);");
      assert.ok(result.warnings.some((warning) => warning.includes("MONTHS_BETWEEN")));
    }
  },
  {
    name: "disable plain highlighting for large SQL",
    mutateScript: (script) =>
      replaceRequired(
        script,
        "const highlightTokenizeLimit = 120000;",
        "const highlightTokenizeLimit = 1200000000;"
      ),
    assertion(convert, app) {
      const largeSql = Array.from({ length: 6500 }, (_, index) => {
        return `SELECT ${index} AS id, CAST(${index} AS NUMBER) AS amount FROM DUAL;`;
      }).join("\n");
      const oracleSql = app.elements.get("oracleSql");
      oracleSql.value = largeSql;
      oracleSql.dispatchEvent({ type: "input", defaultPrevented: false });
      assert.equal(app.elements.get("oracleHighlight").dataset.highlightMode, "plain");
      assert.equal(app.elements.get("postgresHighlight").dataset.highlightMode, "plain");
    }
  }
];

if (typeof loadApp().context.convertExpressionOperations === "function")
  mutants.push(
    {
      name: "disable numeric and date expression correction",
      mutateScript: (script) =>
        replaceRequired(
          script,
          "sql = convertExpressionOperations(sql);",
          "/* expression correction disabled */"
        ),
      assertion(convert) {
        assert.equal(convert("SELECT 1/2 FROM DUAL;").sql, "SELECT 1/CAST(2 AS NUMERIC);");
      }
    },
    {
      name: "re-enable cycling when NOCYCLE was requested",
      mutateScript: (script) => replaceRequired(script, 'NOCYCLE: "NO CYCLE"', 'NOCYCLE: "CYCLE"'),
      assertion(convert) {
        assert.equal(convert("ALTER SEQUENCE s NOCYCLE;").sql, "ALTER SEQUENCE s NO CYCLE;");
      }
    },
    {
      name: "rewrite qualified user functions as built-ins",
      mutateScript: (script) => replaceRequired(script, /qualified\.has\(found\)\s*\|\|\s*/, ""),
      assertion(convert) {
        assert.equal(convert("SELECT app . NVL(a,b) FROM t;").sql, "SELECT app . NVL(a,b) FROM t;");
      }
    },
    {
      name: "corrupt Unicode host-string escapes",
      mutateScript: (script) =>
        replaceRequired(script, "text += String.fromCodePoint(code);", 'text += "?";'),
      assertion(convert) {
        assert.equal(
          convert(String.raw`const sql = "SELECT '\u0041' FROM DUAL;";`).sql,
          "const sql = \"SELECT 'A';\";"
        );
      }
    },
    {
      name: "drop identity sequence options",
      mutateScript: (script) =>
        replaceRequired(script, "normalizeSequenceOptions(sql.slice(open + 1, close))", '""'),
      assertion(convert) {
        assert.match(
          convert("CREATE TABLE t (id INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 40));").sql,
          /START WITH 40/
        );
      }
    },
    {
      name: "discard the newline terminating an argument comment",
      mutateScript: (script) =>
        replaceRequired(script, 'return trimmed + "\\n";', "return trimmed;"),
      assertion(convert) {
        const result = convert("SELECT NVL(1 -- note\n,2) FROM DUAL;");
        assert.match(result.sql, /-- note\n,/);
      }
    },
    {
      name: "stop protecting national alternative quotes",
      mutateScript: (script) =>
        replaceRequired(script, /&&\s*\/\[qQ\]\/\.test\(sql\[index \+ 1\] \|\| ""\)/, "&& false"),
      assertion(convert) {
        assert.equal(
          convert("SELECT nq'[it's NVL(x,0); DATE]' FROM DUAL;").sql,
          "SELECT nq'[it's NVL(x,0); DATE]';"
        );
      }
    }
  );

let killed = 0;
const survived = [];

for (const mutant of mutants) {
  const baseline = loadApp();
  mutant.assertion(baseline.convertOracleToPostgres, baseline);
  // Creating a mutant must succeed. A missing target or syntax error is not a kill.
  const app = loadApp({ mutateScript: mutant.mutateScript });
  try {
    mutant.assertion(app.convertOracleToPostgres, app);
    survived.push(mutant.name);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    killed += 1;
  }
}

assert.equal(survived.length, 0, `survived mutants: ${survived.join(", ")}`);
console.log(`mutation-smoke: ${killed}/${mutants.length} mutants killed`);
