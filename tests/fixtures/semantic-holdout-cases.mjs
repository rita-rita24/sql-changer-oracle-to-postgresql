// Independent second-seed/deeper grammar and relational contexts, added after
// the first discovery pass. Oracle execution supplies every expected result.
import { createHash } from 'node:crypto';
const cases = new Map();
function add(category, expression, tail = ' FROM DUAL') {
  const source = `SELECT ${expression} AS value${tail}`;
  if (cases.has(source)) return;
  cases.set(source, { id: `holdout-${category}-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`, category, source, compareColumnTypes: true });
}
let state = 0xc0ffee23;
function choose(values) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return values[state % values.length]; }
const numbers = ['0', '2', '-2', '.125', '-.25', '2.50', 'CAST(NULL AS NUMBER)'];
function numeric(depth) {
  if (!depth) return choose(numbers);
  switch (choose(['binary', 'nvl', 'round', 'trunc', 'abs', 'mod'])) {
    case 'binary': return `(${numeric(depth - 1)} ${choose(['+', '-', '*'])} ${numeric(depth - 1)})`;
    case 'nvl': return `NVL(${numeric(depth - 1)},${choose(numbers)})`;
    case 'round': return `ROUND(${numeric(depth - 1)},${choose(['-1', '0', '1', '2'])})`;
    case 'trunc': return `TRUNC(${numeric(depth - 1)},${choose(['-1', '0', '1', '2'])})`;
    case 'mod': return `MOD(${numeric(depth - 1)},${choose(['0', '2', '-.5'])})`;
    default: return `ABS(${numeric(depth - 1)})`;
  }
}
for (let index = 0; index < 100; index++) {
  const expression = numeric(3);
  add('nested-number', expression);
  add('nested-number-text', `TO_CHAR(${expression})`);
}
const texts = ["''", "'  '", "'ab '", "'O''Brien'", "'日本語'", "CAST('a' AS CHAR(4))", "CAST(NULL AS VARCHAR2(12))"];
for (const value of texts) {
  for (const expression of [
    `LOWER(REPLACE(${value},'a',''))`, `UPPER(TRIM(${value}))`,
    `NVL(TRIM(${value}),'fallback')`, `NVL2(REPLACE(${value},'a',''),'yes','no')`,
    `LENGTH(SUBSTR(${value},1,3))`, `SUBSTR(${value},-2,2)`,
    `LPAD(RTRIM(${value}),5,'.')`, `RPAD(LTRIM(${value}),5,'.')`,
    `REPLACE(REPLACE(${value},'a',NULL),'b','')`,
    `COALESCE(TRANSLATE(${value},'ab','xy'),'fallback')`,
  ]) {
    add('nested-text', expression);
    add('derived-null-filter', 'COUNT(*)', ` FROM (SELECT ${expression} AS x FROM DUAL) t WHERE x IS NULL`);
    add('empty-result-type', expression, ' FROM DUAL WHERE 1=0');
  }
}
const rows = "(SELECT 1 AS id,CAST('' AS VARCHAR2(12)) AS x FROM DUAL UNION ALL SELECT 2,'  ' FROM DUAL UNION ALL SELECT 3,'ab ' FROM DUAL UNION ALL SELECT 4,'a' FROM DUAL) t";
for (const expression of ["TRIM(x)", "REPLACE(x,'a','')", "TRANSLATE(x,'ab','xy')", "NVL(TRIM(x),'fallback')", "SUBSTR(x,2,2)", 'RPAD(x,4,\'.\')']) {
  add('multirow-value', expression, ` FROM ${rows} ORDER BY id`);
  add('multirow-count', `COUNT(${expression})`, ` FROM ${rows}`);
  add('multirow-predicate', 'id', ` FROM ${rows} WHERE ${expression} IS NULL ORDER BY id`);
}
for (const date of ["DATE '2000-02-29'", "DATE '2024-12-31'", "CAST(NULL AS DATE)"]) {
  for (const number of ['.125', '-.25', "'.5'", 'NULL']) {
    add('nested-date', `((${date} + ${number}) - .5) - DATE '2024-01-01'`);
  }
}
export const generation = { version: 1, seed: '0xc0ffee23', kind: 'independent deeper grammar, nested strings, multirow and empty-result queries', cases: cases.size };
export const databaseCases = [...cases.values()];
// Lexical prefixes and UTF-8 byte-length CHAR casts must also survive the new
// empty-string and padding passes. These are executable differential cases.
for (const value of ["N''", "N'日本語'", "N'😀'", "CAST('日' AS CHAR(4))", "CAST('😀' AS CHAR(6))"]) {
 for (const expression of [value, `TO_CHAR(${value})`, `LENGTH(${value})`, `NVL(${value},'fallback')`, `SUBSTR(${value},1,2)`]) {
  const source=`SELECT ${expression} AS value FROM DUAL`;
  databaseCases.push({id:`holdout-lexical-${createHash('sha256').update(source).digest('hex').slice(0,12)}`,category:'national-and-char',source,compareColumnTypes:true});
 }
}
generation.version = 2;
generation.cases = databaseCases.length;
