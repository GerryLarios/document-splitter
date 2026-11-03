import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSelection, moveSelection, parseRange, toggleSelection } from '../src/lib/selection';

test('selection preserves chosen order across range additions, removal, and reordering', () => {
  let order = addSelection(['c', 'a'], ['a', 'b', 'd']);
  assert.deepEqual(order, ['c', 'a', 'b', 'd']);
  order = moveSelection(order, 3, 0);
  assert.deepEqual(order, ['d', 'c', 'a', 'b']);
  assert.deepEqual(toggleSelection(order, 'a'), ['d', 'c', 'b']);
  assert.deepEqual(moveSelection(order, -1, 0), order);
  assert.deepEqual(parseRange('3-5, 1, 4', 5), [0, 2, 3, 4]);
  for (const invalid of ['0', '6', '3-1', '', '1-9999999999999', 'abc', '1,']) assert.throws(() => parseRange(invalid, 5));
});
