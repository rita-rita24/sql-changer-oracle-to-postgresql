import assert from 'node:assert/strict';
import test from 'node:test';
import { compareResults, oracleTypeFamily, postgresTypeFamily } from '../helpers/compare-results.mjs';
const result = (rows, columnTypes) => ({ rows, columnTypes });

test('differential checks catch type changes even when both values are NULL', () => {
  const check = compareResults(result([[null]], ['string']), result([[null]], ['number']), { columnTypes: true });
  assert.equal(check.equivalent, false);
  assert.equal(check.rowsEqual, true);
  assert.equal(check.typesEqual, false);
  assert.equal(check.classification, 'silent-mismatch');
});
test('empty result sets still retain type checks', () => {
  assert.equal(compareResults(result([], ['number']), result([], ['string']), { columnTypes: true }).equivalent, false);
});
test('warning presence never turns a result mismatch into a pass', () => {
  const check = compareResults(result([[1]], ['number']), result([[2]], ['number']), { warnings: ['review'] });
  assert.equal(check.equivalent, false);
  assert.equal(check.classification, 'warned-mismatch');
});
test('source errors and silent target errors are distinct from silent wrong results', () => {
  assert.equal(compareResults({ error: 'ORA-1' }, {}).classification, 'source-error');
  assert.equal(compareResults(result([[1]], ['number']), { error: '42883' }).classification, 'silent-execution-error');
  assert.equal(compareResults(result([[1]], ['number']), { error: '42883' }, { warnings: ['review'] }).classification, 'warned-execution-error');
});
test('comparison preserves NULL, empty text, numeric text, precision and row counts', () => {
  for (const [left, right] of [
    [null, { type: 'string', value: '' }],
    [{ type: 'number', value: '1' }, { type: 'string', value: '1' }],
    [{ type: 'number', value: '123456789012345678901' }, { type: 'number', value: '123456789012345678900' }],
  ]) assert.equal(compareResults(result([[left]], ['number']), result([[right]], ['number'])).equivalent, false);
  assert.equal(compareResults(result([[1]], ['number']), result([[1], [1]], ['number'])).equivalent, false);
  assert.equal(compareResults({ affected: 1 }, { affected: 2 }).equivalent, false);
});
test('type family mappings allow deliberate DATE/timestamp and NUMBER/numeric migrations', () => {
  assert.equal(oracleTypeFamily('DATE'), postgresTypeFamily(1114));
  assert.equal(oracleTypeFamily('NUMBER'), postgresTypeFamily(1700));
  assert.notEqual(oracleTypeFamily('DATE'), postgresTypeFamily(1186));
  assert.notEqual(oracleTypeFamily('VARCHAR2'), postgresTypeFamily(1700));
});
