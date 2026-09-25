// Keep preview, tests, database verification and release on the same source.
export const appFile = process.env.SQL_CHANGER_HTML || "sql-changer-oracle-to-postgresql.html";
export const databaseCasesFile = process.env.SQL_CHANGER_DATABASE_CASES || "tests/fixtures/semantic-database-cases.mjs";
