export const databaseCases=[];
for(const text of ['日本語','A漢B','ｶﾅ','あいう','😀','é','é','Ω','中·文','ᄀ','👩‍💻']) for(const width of [1,2,3,4,5,6,7]) for(const fn of ['LPAD','RPAD']) {
 databaseCases.push({id:`pad-${databaseCases.length}`,source:`SELECT ${fn}('${text}',${width},'.') AS value FROM DUAL`,compareColumnTypes:true});
}
for(const text of ['a','漢','A漢']) for(const pad of ['漢','漢a','a漢','あい']) for(const width of [1,2,3,4,5,6,7]) for(const fn of ['LPAD','RPAD']) {
 databaseCases.push({id:`pad-${databaseCases.length}`,source:`SELECT ${fn}('${text}',${width},'${pad}') AS value FROM DUAL`,compareColumnTypes:true});
}
// Runtime columns, NULLs, fractional lengths and volatile inputs exercise the
// generated SQL independently of literal probes (no JavaScript folding).
for (const text of ["'日本語'", "'A漢B'", "'👩‍💻'", "''", 'CAST(NULL AS VARCHAR2(12))']) {
  for (const length of ['1','3.9','7','CAST(NULL AS NUMBER)']) for (const fn of ['LPAD','RPAD']) {
    databaseCases.push({id:`pad-runtime-${databaseCases.length}`,source:`SELECT ${fn}(x,n,p) AS value FROM (SELECT ${text} AS x,${length} AS n,'あb' AS p FROM DUAL) t`,compareColumnTypes:true});
  }
}
databaseCases.push(
 {id:'pad-volatile-sequence',source:'CREATE SEQUENCE pad_once START WITH 1 NOCACHE',verify:'SELECT pad_once.NEXTVAL FROM DUAL',compareColumnTypes:true},
 {id:'pad-volatile-value',source:"SELECT LPAD(TO_CHAR(pad_once.NEXTVAL),7,'漢') AS value FROM DUAL",compareColumnTypes:true},
 {id:'pad-volatile-after',source:'SELECT pad_once.CURRVAL AS value FROM DUAL',compareColumnTypes:true},
 {id:'pad-query-limit',source:"SELECT LPAD('日本語',5,'.') AS value FROM DUAL WHERE ROWNUM<=1",compareColumnTypes:true},
);
