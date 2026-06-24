import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numDragValue } from '../js/numdrag.js';

test('numDragValue : 1px = 1 unite', () => {
  assert.equal(numDragValue(60, 0, false), 60);
  assert.equal(numDragValue(60, 5, false), 65);
  assert.equal(numDragValue(60, -8, false), 52);
});
test('numDragValue : Shift = pas de 10', () => {
  assert.equal(numDragValue(60, 3, true), 90);
  assert.equal(numDragValue(60, -2, true), 40);
});
test('numDragValue : arrondit le delta fractionnaire', () => {
  assert.equal(numDragValue(0, 2.6, false), 3);
  assert.equal(numDragValue(0, 2.4, false), 2);
});
test('numDragValue : base non numerique traitee comme 0', () => {
  assert.equal(numDragValue(NaN, 4, false), 4);
});
