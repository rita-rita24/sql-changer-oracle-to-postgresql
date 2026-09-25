import { databaseCases as baselineCases } from "./database-cases.mjs";

export const databaseCases = [...baselineCases,
  {
    id: "qa-keyword-identifiers",
    source: "CREATE TABLE qa_names (enable NUMBER, disable NUMBER, byte NUMBER, nocache NUMBER, noorder NUMBER, storage NUMBER)",
    after: ["INSERT INTO qa_names VALUES (1,2,3,4,5,6)"],
    verify: "SELECT enable,disable,byte,nocache,noorder,storage FROM qa_names",
  },
  {
    id: "qa-unicode-identifiers",
    source: "CREATE TABLE qa_unicode (日本NUMBER NUMBER, 日付DATE NUMBER)",
    after: ["INSERT INTO qa_unicode VALUES (1,2)"],
    verify: "SELECT 日本NUMBER,日付DATE FROM qa_unicode",
  },
  { id: "qa-unicode-case-offsets", source: "SELECT 7 AS İ, NVL(NULL, 1) AS n FROM DUAL" },
  {
    id: "qa-dollar-identifier",
    source: "CREATE TABLE qa_dollar (a$tag$ NUMBER)",
    after: ["INSERT INTO qa_dollar VALUES (3)"],
    verify: "SELECT a$tag$, NVL(NULL, 1) FROM qa_dollar",
  },
  {
    id: "qa-length-semantics",
    source: "CREATE TABLE qa_lengths (a VARCHAR2(10 CHAR), b VARCHAR2(20 BYTE))",
    after: ["INSERT INTO qa_lengths VALUES ('日本語','ascii')"],
    verify: "SELECT a,b FROM qa_lengths",
  },
  {
    id: "qa-storage-comment",
    source: "CREATE TABLE qa_storage (n NUMBER) STORAGE(INITIAL 64K /* ) */ NEXT 64K)",
    after: ["INSERT INTO qa_storage VALUES (9)"],
    verify: "SELECT n FROM qa_storage",
  },
];
