import { isDeepStrictEqual } from 'node:util';

// Column families are compared even when every cell is NULL or there are no rows.
// Oracle DATE intentionally maps to PostgreSQL timestamp, and NUMBER to numeric.
export function compareResults(oracle, postgres, { columnTypes = true, affected = true, warnings = [] } = {}) {
  const sourceValid = !oracle.error;
  const targetValid = !postgres.error;
  const rowsEqual = sourceValid && targetValid && isDeepStrictEqual(oracle.rows, postgres.rows);
  const typesEqual = !columnTypes || isDeepStrictEqual(oracle.columnTypes, postgres.columnTypes);
  const affectedEqual = !affected || oracle.affected === postgres.affected;
  const equivalent = rowsEqual && typesEqual && affectedEqual;
  const classification = !sourceValid ? 'source-error' : !targetValid
    ? (warnings.length ? 'warned-execution-error' : 'silent-execution-error')
    : equivalent ? 'equivalent' : warnings.length ? 'warned-mismatch' : 'silent-mismatch';
  return { equivalent, classification, rowsEqual, typesEqual, affectedEqual };
}

export function oracleTypeFamily(name) {
  if (/NUMBER|BINARY_FLOAT|BINARY_DOUBLE/.test(name)) return 'number';
  if (/CHAR|CLOB|LONG$/.test(name)) return 'string';
  if (/DATE|TIMESTAMP/.test(name)) return 'datetime';
  if (/INTERVAL/.test(name)) return 'interval';
  if (/RAW|BLOB/.test(name)) return 'bytes';
  if (/BOOLEAN/.test(name)) return 'boolean';
  return `oracle:${name}`;
}

export function postgresTypeFamily(oid) {
  if ([20, 21, 23, 700, 701, 1700].includes(oid)) return 'number';
  if ([18, 19, 25, 1042, 1043].includes(oid)) return 'string';
  if ([1082, 1114, 1184].includes(oid)) return 'datetime';
  if (oid === 1186) return 'interval';
  if (oid === 17) return 'bytes';
  if (oid === 16) return 'boolean';
  return `postgres:${oid}`;
}
