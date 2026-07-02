import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, rollerOptionsTooLong, ROLLER_OPTS_MAX } from '../js/inspector.js';

test('parseOptions : une option par ligne, vides retirées', () => {
  assert.deepEqual(parseOptions('OFF\nLOW\nHIGH'), ['OFF', 'LOW', 'HIGH']);
  assert.deepEqual(parseOptions('  OFF \n\n  ON\n'), ['OFF', 'ON']);   // trim + lignes vides ignorées
  assert.deepEqual(parseOptions(''), []);
  assert.deepEqual(parseOptions('   \n  '), []);
});

test('rollerOptionsTooLong : sous la limite firmware → false, au-delà → true', () => {
  assert.equal(rollerOptionsTooLong(['OFF', 'ON']), false);
  assert.equal(rollerOptionsTooLong([]), false);
  const fit = 'a'.repeat(ROLLER_OPTS_MAX);                 // 1 option, pas de séparateur → exactement la limite
  assert.equal(rollerOptionsTooLong([fit]), false);
  assert.equal(rollerOptionsTooLong([fit + 'a']), true);  // +1 octet → tronqué côté firmware
});

test('rollerOptionsTooLong : octets UTF-8 (accents = 2 octets) + séparateurs \\n comptés', () => {
  const atLimit = Array(80).fill('a');                     // 80 chars + 79 '\n' = 159 octets = limite exacte
  assert.equal(new TextEncoder().encode(atLimit.join('\n')).length, ROLLER_OPTS_MAX);
  assert.equal(rollerOptionsTooLong(atLimit), false);
  assert.equal(rollerOptionsTooLong(Array(80).fill('é')), true);   // « é » = 2 octets → dépasse
});
