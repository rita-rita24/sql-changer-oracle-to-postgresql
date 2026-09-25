import { databaseCases as previous } from './business-database-cases.mjs';
const corrected = new Set([
 'policy-to-char-decimal','policy-to-date-time','policy-rr-century','policy-date-arithmetic',
 'policy-null-concat','policy-unknown-type','policy-substr-column-forward','policy-substr-column-backward',
 'manual-aggregate-rownum','helper-instr','helper-trunc-date'
]);
const scalar=(id,expression)=>({id,source:`SELECT ${expression} AS value FROM DUAL`});
export const databaseCases=previous.map((fixture)=>{
 if(!corrected.has(fixture.id)) return fixture;
 const {exception,...equivalent}=fixture;
 return equivalent;
});
for(const [i,value] of ['12.3400','0.5','-0.5','0','-0','1e-7','1e20','12345678901234567890123456789012345678'].entries()) databaseCases.push(scalar(`precision-char-${i}`,`TO_CHAR(${value})`));
for(const [i,value] of ["'12.3400'","'.5'","'-.5'","'1e-7'","'12345678901234567890123456789012345678'","'   '","NULL","''"].entries()) databaseCases.push(scalar(`precision-number-${i}`,`TO_NUMBER(${value})`));
for(const start of ['1.8','-1.8','0','-0.8','1e2','-1000000000000000000000000000000','1000000000000000000000000000000','NULL']) databaseCases.push(scalar(`substring-position-${start}`,`SUBSTR(CAST('abcd' AS VARCHAR2(10)), ${start}, 2.8)`));
for(const length of ['0','-2.8','NULL','1e2','1000000000000000000000000000000']) databaseCases.push(scalar(`substring-length-${length}`,`SUBSTR(CAST('日本語abcd' AS VARCHAR2(20)), -4, ${length})`));
for(const [i,expression] of [
 '1/2', '7/2', '-7/2', '1/(2+3)', '1/2*3+4', '(1+2)/4', 'CAST(7 AS INTEGER)/2', "'4'/'2'",
 "DATE '2024-06-15'+1", "DATE '2024-06-15'+(1/24)", "DATE '2024-06-15'-1", "1+DATE '2024-06-15'",
 "'A' || CAST(NULL AS VARCHAR2(10))", "CAST(NULL AS VARCHAR2(10)) || 'A'", "'' || ''", "'A' || 'B' || ''",
 "LPAD('abcd',2,'')", "LPAD('abcd',5,'')", "LPAD('abcd',2,NULL)",
 "INSTR('aaaa','aa',1,2)", "INSTR('aaaa','aa',-1,2)", "INSTR('日本語日本語','語',1,2)", "INSTR('abc','',1,1)",
 "INSTR(CAST('abc' AS VARCHAR2(10)),CAST('b' AS VARCHAR2(10)))",
 "TO_CHAR(TO_DATE('2024-03-10 02:30:00','YYYY-MM-DD HH24:MI:SS'),'YYYY-MM-DD HH24:MI:SS')",
 "TO_CHAR(TO_DATE(CAST('2024-03-10 02:30:00' AS VARCHAR2(30)),'YYYY-MM-DD HH24:MI:SS'),'YYYY-MM-DD HH24:MI:SS')",
 "TO_CHAR(TO_DATE('49-12-31','RR-MM-DD'),'YYYY-MM-DD')", "TO_CHAR(TO_DATE('99-12-31','RR-MM-DD'),'YYYY-MM-DD')",
 "TO_CHAR(TRUNC(DATE '2024-06-15','Q'),'YYYY-MM-DD')", "TO_CHAR(TRUNC(DATE '2024-06-15','IW'),'YYYY-MM-DD')",
].entries()) databaseCases.push(scalar(`extended-expression-${i}`,expression));
databaseCases.push(
 {id:'extended-expression-30',source:"SELECT NVL(flag, '0') AS value FROM (SELECT CAST(1 AS NUMBER) flag FROM DUAL) t"},
 {id:'ordered-rownum-setup',source:'CREATE TABLE qa_ordered (id NUMBER, label VARCHAR2(20))',after:["INSERT INTO qa_ordered VALUES (3,'three')","INSERT INTO qa_ordered VALUES (1,'one')","INSERT INTO qa_ordered VALUES (2,'two')"],verify:'SELECT id,label FROM qa_ordered ORDER BY id'},
 {id:'ordered-rownum-first',source:'SELECT id FROM qa_ordered WHERE ROWNUM <= 2 ORDER BY id'},
 {id:'ordered-rownum-qualified',source:'SELECT a.label FROM qa_ordered a WHERE ROWNUM <= 2 ORDER BY a.id'},
 {id:'aggregate-rownum',source:'SELECT SUM(id),COUNT(*) FROM qa_ordered WHERE ROWNUM <= 2'},
 {id:'strict-rownum',source:'SELECT COUNT(*) FROM qa_ordered WHERE ROWNUM < 2'},
 {id:'distinct-rownum',source:'SELECT DISTINCT id FROM qa_ordered WHERE ROWNUM <= 2 ORDER BY id'},
 {id:'identity-start',source:'CREATE TABLE qa_identity (id INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 40 INCREMENT BY 2 NOCACHE), label VARCHAR2(20))',after:["INSERT INTO qa_identity (label) VALUES ('a')","INSERT INTO qa_identity (label) VALUES ('b')"],verify:'SELECT id,label FROM qa_identity ORDER BY id'},
 {id:'sequence-unicode',source:'CREATE SEQUENCE 日本MYSEQ START WITH 7 NOCACHE',verify:'SELECT 日本MYSEQ.NEXTVAL FROM DUAL'},
 {id:'sequence-comment',source:'CREATE SEQUENCE qa_comment_seq START WITH 9 NOCACHE',verify:'SELECT qa_comment_seq /* . NEXTVAL */ . NEXTVAL FROM DUAL'},
 {id:'sequence-cycle-start',source:'CREATE SEQUENCE qa_cycle START WITH 1 MAXVALUE 3 CYCLE NOCACHE',verify:'SELECT qa_cycle.NEXTVAL FROM DUAL'},
 {id:'sequence-cycle-disable',source:'ALTER SEQUENCE qa_cycle NOCYCLE',verify:'SELECT qa_cycle.NEXTVAL FROM DUAL'},
 {id:'ordinary-duel-table',source:'CREATE TABLE duel (n NUMBER)',after:['INSERT INTO duel VALUES (3)','INSERT INTO duel VALUES (8)'],verify:'SELECT n FROM duel ORDER BY n'},
 {id:'ordinary-select-name',source:'CREATE TABLE qa_names2 (sealect NUMBER)',after:['INSERT INTO qa_names2 VALUES (11)'],verify:'SELECT sealect FROM qa_names2'},
 {id:'quoted-table-dot',source:'CREATE TABLE "qa.dot" (n NUMBER)',after:['INSERT INTO "qa.dot" VALUES (1)','UPDATE "qa.dot" SET "qa.dot".n=3'],verify:'SELECT n FROM "qa.dot"'},
);
// Invalid inputs must remain errors; a NULL or a partial number is not a pass.
databaseCases.find(c=>c.id==='precision-number-5').expectedErrors={oracle:'ORA-01722',postgres:'22P02'};
for(const value of ['NaN','Infinity','-Infinity','1x','1 2']) databaseCases.push({...scalar(`invalid-number-${value}`,`TO_NUMBER('${value}')`),expectedErrors:{oracle:'ORA-01722',postgres:'22P02'}});
for(const timezone of ['America/New_York','Asia/Tokyo']) for(const datetime of ['2024-03-10 02:30:00','2024-11-03 01:30:00']) databaseCases.push({
 ...scalar(`wall-clock-${timezone}-${datetime}`,`TO_CHAR(TO_DATE(CAST('${datetime}' AS VARCHAR2(30)),'YYYY-MM-DD HH24:MI:SS'),'YYYY-MM-DD HH24:MI:SS')`),timezone,
});
for(const name of ['SYSDATE','SYSTIMESTAMP','CURRENT_DATE','CURRENT_TIMESTAMP','LOCALTIMESTAMP']) databaseCases.push(scalar(`statement-stable-${name}`,`CASE WHEN ${name}=${name} THEN 1 ELSE 0 END`));
// Oracle DATE does not accept FF; second precision is checked with an explicit TIMESTAMP cast.
// The seconds themselves differ across sequential DB requests, so inspect only the fractional part.
databaseCases.push(scalar('sysdate-second-precision',"TO_CHAR(CAST(SYSDATE AS TIMESTAMP),'FF6')"));
