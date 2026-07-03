import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrModules } from '../js/qr.js';

test('qrModules : déterministe pour un même texte', () => {
  const a = qrModules('http://dialboard.local');
  const b = qrModules('http://dialboard.local');
  assert.equal(a.size, b.size);
  assert.equal(a.get(0, 0), b.get(0, 0));
  assert.equal(a.get(0, 0), true);
});

test('qrModules : version croît avec la longueur', () => {
  const court = qrModules('hi').size;
  const long = qrModules('x'.repeat(200)).size;
  assert.ok(long > court);
});
