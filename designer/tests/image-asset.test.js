import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgba8888ToRgb565a8, rgb565a8ToRgba8888, referencedImageKeys } from '../js/image-asset.js';
import { SWAP } from '../js/bg-image.js';

test('rgba8888ToRgb565a8 : 1 px rouge opaque → 3 octets [couleur swappée, alpha]', () => {
  // rouge pur R=255,G=0,B=0,A=255 → RGB565 = 0xF800 ; SWAP=true ⇒ octet fort d'abord.
  const out = rgba8888ToRgb565a8(new Uint8ClampedArray([255, 0, 0, 255]));
  assert.equal(out.length, 3);
  assert.deepEqual([...out], SWAP ? [0xF8, 0x00, 0xFF] : [0x00, 0xF8, 0xFF]);
});

test('rgba8888ToRgb565a8 : alpha préservé tel quel', () => {
  const out = rgba8888ToRgb565a8(new Uint8ClampedArray([0, 0, 0, 0x40]));
  assert.equal(out[2], 0x40);
});

test("round-trip 565a8 → rgba conserve l'alpha et approxime la couleur", () => {
  const rgba = new Uint8ClampedArray([248, 0, 0, 0x80]);   // R aligné sur un pas RGB565 (>>3<<3)
  const back = rgb565a8ToRgba8888(rgba8888ToRgb565a8(rgba));
  assert.equal(back[0], 248);
  assert.equal(back[3], 0x80);
});

test('referencedImageKeys : collecte les src des composants type image, dédupliqués', () => {
  const state = { components: {
    a: { type: 'image', src: 'aaaa' },
    b: { type: 'image', src: 'aaaa' },   // doublon
    c: { type: 'image' },                // pas de src
    d: { type: 'bar', src: 'zzzz' },     // pas une image
  } };
  assert.deepEqual(referencedImageKeys(state).sort(), ['aaaa']);
});
