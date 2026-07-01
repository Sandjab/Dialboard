import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from '../js/inspector.js';

test('parseOptions : une option par ligne, vides retirées', () => {
  assert.deepEqual(parseOptions('OFF\nLOW\nHIGH'), ['OFF', 'LOW', 'HIGH']);
  assert.deepEqual(parseOptions('  OFF \n\n  ON\n'), ['OFF', 'ON']);   // trim + lignes vides ignorées
  assert.deepEqual(parseOptions(''), []);
  assert.deepEqual(parseOptions('   \n  '), []);
});
