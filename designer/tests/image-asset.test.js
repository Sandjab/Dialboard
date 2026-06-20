import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgba8888ToRgb565a8, rgb565a8ToRgba8888, referencedImageKeys } from '../js/image-asset.js';
import { SWAP, rgba8888ToRgb565 } from '../js/bg-image.js';

test('rgba8888ToRgb565a8 : plan couleur en byte order INVERSE du fond RGB565 (LVGL 9 lit RGB565A8 en little-endian)', () => {
  // POURQUOI : vérifié on-device — LVGL 9 lit le plan couleur de RGB565A8 en little-endian natif, à
  // l'opposé du fond RGB565 plein. Sans cette inversion : teinte fausse (orange→magenta) + frange de bord.
  const rgba = new Uint8ClampedArray([255, 0, 0, 0xFF]);   // rouge opaque (RGB565 0xF800)
  const out = rgba8888ToRgb565a8(rgba);
  const bg = rgba8888ToRgb565(rgba);                       // fond : ordre device RGB565 (suit SWAP)
  assert.equal(out.length, 3);
  assert.deepEqual([out[0], out[1]], [bg[1], bg[0]]);      // octets couleur inversés vs le fond
  assert.equal(out[2], 0xFF);                              // alpha (plan A8, sans byte order)
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

test('rgba8888ToRgb565a8 : layout PLANAIRE (plan couleur puis plan alpha), pas entrelacé', () => {
  // POURQUOI : LVGL 9 lit RGB565A8 en « color array followed by alpha array ». Un layout entrelacé
  // (v8 : [R,R,A, G,G,A]) corrompt le rendu on-device. Ce test échoue si on régresse vers l'entrelacé.
  // 2 px : rouge opaque (RGB565 0xF800), vert α=0x40 (0x07E0).
  const out = rgba8888ToRgb565a8(new Uint8ClampedArray([255, 0, 0, 0xFF,  0, 255, 0, 0x40]));
  assert.equal(out.length, 6);                              // 2 px × 3 octets
  const red   = SWAP ? [0x00, 0xF8] : [0xF8, 0x00];         // 0xF800, plan couleur little-endian (cf. test ci-dessus)
  const green = SWAP ? [0xE0, 0x07] : [0x07, 0xE0];         // 0x07E0
  assert.deepEqual([...out], [...red, ...green, 0xFF, 0x40]); // 4 octets couleur PUIS 2 octets alpha
});

test('round-trip PLANAIRE multi-px : alpha exact et couleur approximée, par pixel', () => {
  const rgba = new Uint8ClampedArray([248, 0, 0, 0x80,  0, 248, 0, 0x20]); // R/G alignés sur RGB565
  const back = rgb565a8ToRgba8888(rgba8888ToRgb565a8(rgba));
  assert.equal(back[0], 248); assert.equal(back[3], 0x80);  // px0 : R + α
  assert.equal(back[5], 248); assert.equal(back[7], 0x20);  // px1 : G + α (pas de fuite d'un plan sur l'autre)
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
