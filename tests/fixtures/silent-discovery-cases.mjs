// Deterministic cross-product corpus. Expectations come from Oracle execution,
// never from the converter output. Every new case requires full equivalence.
import { createHash } from 'node:crypto';
const cases = new Map();
function add(category, expression, tail = ' FROM DUAL') {
  const source = `SELECT ${expression} AS value${tail}`;
  if (cases.has(source)) return;
  const id = `silent-${category}-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
  cases.set(source, { id, category, source, compareColumnTypes: true });
}
const texts = ["''", "' '", "'x'", "'x '", "CAST(NULL AS VARCHAR2(12))", "CAST('' AS VARCHAR2(12))", "TRIM(' ')", "SUBSTR('x',2)", "CAST('x' AS CHAR(3))"];
const numericTexts = ["''", "'0'", "'01'", "'.5'", "'1.20'", "CAST(NULL AS VARCHAR2(12))", "CAST('1' AS CHAR(3))"];
const numbers = ['NULL', '0', '1', '-1', '.5', '-.5', '1.2300', '123456789012345678901234567890.12', 'CAST(NULL AS NUMBER)', 'TRUNC(.55,1)', 'ROUND(.55,1)'];
for (const value of texts) {
  for (const fn of ['', 'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM', 'LENGTH']) {
    const expression = fn ? `${fn}(${value})` : value;
    add('empty-string', expression);
    add('empty-predicate', `CASE WHEN ${expression} IS NULL THEN 1 ELSE 0 END`);
  }
  for (const fallback of ["''", "'x'", "CAST(NULL AS VARCHAR2(12))", '0', '.5', '-.5']) add('nvl', `NVL(${value},${fallback})`);
  for (const replacement of ["''", "'x'", 'NULL']) {
    add('replace', `REPLACE(${value},'x',${replacement})`);
    add('translate', `TRANSLATE(${value},'x',${replacement})`);
  }
  for (const alternative of ["''", "'x'", "CAST(NULL AS VARCHAR2(12))"]) {
    add('coalesce', `COALESCE(${value},${alternative},'fallback')`);
    if (!["TRIM(' ')", "SUBSTR('x',2)"].includes(value)) add('nullif', `NULLIF(${value},${alternative})`);
  }
  for(const length of ['0','1','3','3.9']) {
    add('lpad', `LPAD(${value},${length},'0')`);
    add('rpad', `RPAD(${value},${length},'0')`);
  }
  for (const fn of ['COUNT', 'MIN', 'MAX']) add('aggregate-empty', `${fn}(${value})`);
}
const branches = ['NULL', "''", "'01'", "CAST(NULL AS VARCHAR2(12))", "CAST('1' AS CHAR(3))", '0', '.5', 'CAST(NULL AS NUMBER)'];
for (const condition of ['NULL', "''", '1']) for (const yes of branches) for (const no of branches) add('nvl2', `NVL2(${condition},${yes},${no})`);
for (const value of [...numericTexts, '1', '.5', 'CAST(NULL AS NUMBER)']) {
  for (const search of [...numericTexts, '1', '.5', 'CAST(NULL AS NUMBER)']) {
    add('decode', `DECODE(${value},${search},'match','01','second','miss')`);
  }
}
for (const value of [...numbers, ...numericTexts]) {
  add('number-text', `TO_CHAR(${value})`);
  add('cast-text', `CAST(${value} AS VARCHAR2(80))`);
  for (const fn of ['ABS', 'CEIL', 'FLOOR', 'SIGN', 'ROUND', 'TRUNC']) add('numeric-function', `TO_CHAR(${fn}(${value}))`);
  for (const other of ['NULL', '0', '2', '.5', "'2'"]) {
    for(const op of ['+','-','*','/','||']) {
      if(op==='/' && other==='0') continue;
      add('arithmetic', `${value} ${op} ${other}`);
    }
  }
  for(const precision of ['-1','0','1','1.9','NULL']) {
    add('round', `ROUND(${value},${precision})`);
    add('trunc', `TRUNC(${value},${precision})`);
  }
  for(const divisor of ['0','2','-.5','NULL']) add('mod',`MOD(${value},${divisor})`);
}
for (const expression of ["''", "TRIM(' ')", "CAST('' AS VARCHAR2(12))", "CAST('x' AS CHAR(3))"]) {
  add('table-empty', 'COUNT(*)', ` FROM (SELECT ${expression} AS x FROM DUAL) t WHERE x IS NULL`);
  add('table-empty', 'COUNT(x)', ` FROM (SELECT ${expression} AS x FROM DUAL) t`);
  add('table-empty', "NVL(x,'fallback')", ` FROM (SELECT ${expression} AS x FROM DUAL) t`);
}
for (const date of ["DATE '2024-01-02'", "CAST(NULL AS DATE)", "TO_DATE('20240102','YYYYMMDD')", "TRUNC(DATE '2024-01-02')"]) {
  for(const day of ['0','1','-.5',"'1'",'CAST(NULL AS NUMBER)']) {
    for(const op of ['+','-']) {
      add('date-arithmetic', `TO_CHAR(${date} ${op} ${day},'YYYY-MM-DD HH24:MI:SS')`);
      add('date-nested', `(${date} ${op} ${day})-DATE '2024-01-01'`);
    }
  }
}
// Seeded grammar samples exercise combinations, not just individual functions.
let state = 0x5eed2026;
function choose(values) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return values[state % values.length]; }
const leaves = ['0', '1', '.5', '-.5', '1.25', 'CAST(NULL AS NUMBER)'];
function numeric(depth) {
  if (!depth) return choose(leaves);
  const kind = choose(['binary', 'nvl', 'round', 'trunc', 'abs']);
  if(kind==='binary') return `(${numeric(depth-1)} ${choose(['+','-','*'])} ${numeric(depth-1)})`;
  if(kind==='nvl') return `NVL(${numeric(depth-1)},${choose(leaves)})`;
  if(kind==='abs') return `ABS(${numeric(depth-1)})`;
  return `${kind.toUpperCase()}(${numeric(depth-1)},${choose(['-1','0','1','2'])})`;
}
for(let index=0;index<160;index++) {
  const expression=numeric(2);
  add('generated-composition', expression);
  add('generated-format', `TO_CHAR(${expression})`);
}
// Extra seeds only add coverage; they never replace the permanent regressions.
const extraSeeds = (process.env.SQL_CHANGER_DISCOVERY_SEEDS || '').split(',').filter(Boolean).map(Number);
if (extraSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error('Discovery seeds must be unsigned 32-bit integers');
for (const seed of extraSeeds) {
  state = seed;
  for (let index = 0; index < 160; index++) {
    const expression = numeric(3);
    add('extra-composition', expression);
    add('extra-format', `TO_CHAR(${expression})`);
  }
}
export const generation = { version: 2, seed: '0x5eed2026', extraSeeds, kind: 'cross-products and bounded numeric grammar', cases: cases.size };
export const databaseCases = [...cases.values()];
