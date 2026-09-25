import { databaseCases as previous } from './business-extended-database-cases.mjs';
const scalar = (id, expression) => ({ id, source: `SELECT ${expression} AS value FROM DUAL` });
export const databaseCases = [...previous];
for (const [index, expression] of [
  'TO_CHAR(1/2)', 'TO_CHAR(1+0.25)', 'TO_CHAR((3-1)/4)', 'TO_CHAR(1*-0.25)',
  'TO_CHAR(-CAST(0.5 AS NUMBER))', 'TO_CHAR(1 /* keep */ / 2)',
  "NVL(TO_CHAR(1/2),'x')", "LPAD('x',3.9,'0')", "LPAD('x',.9,'0')",
  "LPAD(CAST(1 AS NUMBER),3,'0')", "LPAD(CAST(1 AS NUMBER),3,CAST(0 AS NUMBER))",
  "LPAD(CAST('' AS VARCHAR2(10)),3,'0')", "LPAD(CAST('x' AS VARCHAR2(10)),3,CAST('' AS VARCHAR2(10)))",
  "LPAD(CAST('x' AS VARCHAR2(10)),CAST(0 AS NUMBER),'0')",
  "LPAD(CAST('x' AS VARCHAR2(10)),CAST(3.9 AS NUMBER),'0')",
  'TRUNC(CAST(1.234 AS BINARY_DOUBLE),2)', 'TRUNC(CAST(1.234 AS BINARY_FLOAT),1)',
  'TRUNC(1.234,1.9)', 'TRUNC(123.45,-1.9)', 'TRUNC(CAST(NULL AS BINARY_DOUBLE),2)',
].entries()) databaseCases.push(scalar(`quality-scalar-${index}`, expression));
for (const [index, value, oracle] of [
  [0, '2024-01-01 24:00:00', 'ORA-01850'],
  [1, '2024-01-01 23:59:60', 'ORA-01852'],
  [2, '2024-01-01 23:60:00', 'ORA-01851'],
]) databaseCases.push({
  ...scalar(`quality-invalid-time-${index}`, `TO_DATE('${value}','YYYY-MM-DD HH24:MI:SS')`),
  expectedErrors: { oracle, postgres: '22008' }
});

for (const [index, expression] of [
  "LPAD(0.5,4,'0')", "LPAD(-0.5,4,'0')", "LPAD(CAST(.5 AS NUMBER),4,'0')",
  "LPAD('x',5,1e2)", "LPAD('x',5,0.5)", "LPAD('x',5,CAST(.5 AS NUMBER))",
  "SUBSTR(0.5,1,1)", "SUBSTR(-0.5,1,2)", "SUBSTR(CAST(.5 AS NUMBER),1,1)"
].entries()) databaseCases.push(scalar(`quality-numeric-text-${index}`, expression));
for (const [index, value, oracle] of [[0,'20240101240000','ORA-01850'],[1,'20240101235960','ORA-01852']]) databaseCases.push({
  ...scalar(`quality-invalid-compact-time-${index}`, `TO_DATE('${value}','YYYYMMDDHH24MISS')`),
  expectedErrors: { oracle, postgres: '22008' }
});
