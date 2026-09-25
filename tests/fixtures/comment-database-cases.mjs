// Oracle executes the original SQL to supply independent expectations. Each
// comment sits immediately before syntax the converter may move or generate.
export const databaseCases = [];
const calls = [
  ['NVL', ['1', '2']], ['NVL', ['NULL', "'x'"]],
  ['NVL2', ['1', "'yes'", "'no'"]], ['DECODE', ['1', '1', "'yes'", "'no'"]],
  ['TO_CHAR', ['0.5']], ['TO_NUMBER', ["'12.5'"]],
  ['SUBSTR', ["'abc'", '1', '2']], ['INSTR', ["'abc'", "'b'"]],
  ['TRUNC', ['1.25', '1']], ['ROUND', ['1.25', '1']],
  ['ABS', ['-1']], ['MOD', ['7', '0']],
  ['LOWER', ["'ABC'"]], ['UPPER', ["'abc'"]], ['TRIM', ["' a '"]],
  ['LENGTH', ["'abc'"]], ['REPLACE', ["'aba'", "'a'", "'x'"]],
  ['TRANSLATE', ["'abc'", "'ac'", "'xz'"]],
  ['LPAD', ["'x'", '3', "'0'"]], ['RPAD', ["'漢'", '5', "'.'"]],
  ['NVL', ["TRIM(' ')", "'x'"]],
];
// Bare CR is not a line-comment terminator in the validation Oracle instance.
for (const newline of ['\n', '\r\n']) {
  for (const [name, args] of calls) for (let index = 0; index < args.length; index++) {
    const annotated = args.map((arg, i) => i === index ? `${arg} -- argument ${i + 1}${newline}` : arg);
    databaseCases.push({ id: `comment-call-${databaseCases.length}`, category: 'comment-boundary', source: `SELECT ${name}(${annotated.join(',')}) AS value FROM DUAL`, compareColumnTypes: true });
  }
}
for (const source of [
  "SELECT CAST(0.5 -- keep decimal\n AS VARCHAR2(20)) AS value FROM DUAL",
  "SELECT NVL(1 -- outer\n, NVL(2 -- inner\n,3)) AS value FROM DUAL",
  "SELECT id FROM comment_rows -- source\n WHERE ROWNUM<=2 ORDER BY id DESC",
  "SELECT id FROM comment_rows WHERE id>0 -- predicate\n AND ROWNUM<=2 ORDER BY id DESC",
  "SELECT NVL('a--b', 'x'), NVL('/* */', 'x') FROM DUAL",
  "SELECT NVL(1 /* keep block */,2), LENGTH('abc' /* keep block */) FROM DUAL",
  "SELECT id FROM comment_rows WHERE ROWNUM -- bound\n<=2 ORDER BY id DESC",
  "SELECT id FROM comment_rows WHERE ROWNUM<=2 -- bound\n AND id>0 ORDER BY id DESC",
  "SELECT id FROM comment_rows WHERE id>0 AND ROWNUM<=2 -- last\n ORDER BY id DESC",
  "SELECT id FROM comment_rows WHERE ROWNUM<=2 -- last\n",
  "SELECT id FROM comment_rows WHERE ROWNUM<=2 -- first\n AND ROWNUM<2 -- second\n ORDER BY id DESC",
  "SELECT id FROM comment_rows /* table */ WHERE ROWNUM /* bound */ <=2 ORDER BY id DESC",
  "SELECT a.id FROM comment_rows /* table */ a WHERE ROWNUM<=2 ORDER BY a.id DESC",
  "SELECT id FROM comment_rows WHERE note<>'-- literal' AND ROWNUM<=2 ORDER BY id DESC",
  "SELECT COUNT(*) FROM comment_rows WHERE ROWNUM<=2 -- aggregate\n",
  "SELECT id FROM comment_rows WHERE id>0 -- filter\n AND ROWNUM<=2",
]) databaseCases.push({ id: `comment-query-${databaseCases.length}`, category: 'comment-boundary', source, compareColumnTypes: true });

for (const source of [
  "MERGE INTO comment_rows d USING (SELECT 1 -- value\n AS id FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=2",
  "MERGE INTO comment_rows d USING (SELECT 1 AS id FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=3 WHERE d.id>0 -- condition\n",
  "MERGE INTO comment_rows d USING (SELECT 1 AS id FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=4 -- assignment\n WHERE d.id>0",
  "MERGE INTO comment_rows d USING (SELECT 1 AS id -- alias\n FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=5",
  "MERGE INTO comment_rows d USING (SELECT 1 id -- alias\n FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=6",
  "MERGE INTO comment_rows d USING (SELECT 1 AS /* keep */ id -- alias\n FROM DUAL) s ON (d.id=s.id) WHEN MATCHED THEN UPDATE SET d.n=7",
  'MERGE INTO comment_rows d USING (SELECT 1 AS "id space" -- alias\n FROM DUAL) s ON (d.id=s."id space") WHEN MATCHED THEN UPDATE SET d.n=8',
]) databaseCases.push({ id: `comment-merge-${databaseCases.length}`, category: 'comment-boundary', source, verify: 'SELECT id,n FROM comment_rows ORDER BY id', compareColumnTypes: true });

// Keep scan-order probes independent of earlier DML in the combined corpus.
// ORDER BY intentionally follows the bound: it must not be moved before it.
databaseCases.unshift(
  { id: 'comment-setup-create', source: 'CREATE TABLE comment_rows (id NUMBER, note VARCHAR2(80), n NUMBER)', verify: 'SELECT id,note,n FROM comment_rows' },
  ...[1, 2, 3].map((id) => ({ id: `comment-setup-row-${id}`, source: `INSERT INTO comment_rows VALUES (${id}, 'row ${id}', 0)` })),
);
