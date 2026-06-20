import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverRect, rgba8888ToRgb565, rgb565ToRgba8888, fnv1a64Hex, SWAP } from '../js/bg-image.js';

test('coverRect : source paysage → crop horizontal centré (carré cible)', () => {
  assert.deepEqual(coverRect(800, 600, 360, 360), { sx: 100, sy: 0, sw: 600, sh: 600 });
});
test('coverRect : source portrait → crop vertical centré (carré cible)', () => {
  assert.deepEqual(coverRect(600, 800, 360, 360), { sx: 0, sy: 100, sw: 600, sh: 600 });
});
test('coverRect : déjà au bon ratio → pleine source', () => {
  assert.deepEqual(coverRect(360, 360, 360, 360), { sx: 0, sy: 0, sw: 360, sh: 360 });
});

// Tests avec swap explicite : true = octet fort d'abord, false = octet faible d'abord (little-endian).
test('rgba→565 : blanc opaque', () => {
  assert.deepEqual([...rgba8888ToRgb565(new Uint8ClampedArray([255,255,255,255]), true)], [0xFF, 0xFF]);
});
test('rgba→565 : rouge (swap → hi,lo)', () => {
  assert.deepEqual([...rgba8888ToRgb565(new Uint8ClampedArray([255,0,0,255]), true)], [0xF8, 0x00]);
});
test('rgba→565 : vert', () => {
  assert.deepEqual([...rgba8888ToRgb565(new Uint8ClampedArray([0,255,0,255]), true)], [0x07, 0xE0]);
});
test('rgba→565 : bleu', () => {
  assert.deepEqual([...rgba8888ToRgb565(new Uint8ClampedArray([0,0,255,255]), true)], [0x00, 0x1F]);
});
test('rgba→565 : sans swap = octets inversés', () => {
  assert.deepEqual([...rgba8888ToRgb565(new Uint8ClampedArray([255,0,0,255]), false)], [0x00, 0xF8]);
});

test('565→rgba : round-trip rouge (canaux reconstruits)', () => {
  const back = rgb565ToRgba8888(new Uint8Array([0xF8, 0x00]), true);
  assert.deepEqual([...back], [248, 0, 0, 255]);   // 31<<3 = 248
});

test('fnv1a64Hex : vecteur connu "a" → af63dc4c8601ec8c', () => {
  assert.equal(fnv1a64Hex(new Uint8Array([0x61])), 'af63dc4c8601ec8c');
});
test('fnv1a64Hex : déterministe et 16 hex', () => {
  const h = fnv1a64Hex(new Uint8Array([1,2,3,4]));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, fnv1a64Hex(new Uint8Array([1,2,3,4])));
});

test('SWAP par défaut = false (LVGL 9 lit les sources en little-endian natif)', () => {
  assert.equal(SWAP, false);
});
