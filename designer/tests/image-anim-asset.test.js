import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packFrames, referencedAimgKeys } from '../js/image-anim-asset.js';

test('packFrames : concatene les frames et compte N', () => {
  const f0 = new Uint8Array([1, 2, 3]);
  const f1 = new Uint8Array([4, 5, 6]);
  const { bytes, frames } = packFrames([f0, f1]);
  assert.equal(frames, 2);
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6]);
});

test('packFrames : cle stable pour le meme contenu', () => {
  const a = packFrames([new Uint8Array([1, 2, 3])]).key;
  const b = packFrames([new Uint8Array([1, 2, 3])]).key;
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('referencedAimgKeys : src des composants image_anim, dedupliques', () => {
  const state = { components: {
    a: { type: 'image_anim', src: 'aaaa' },
    b: { type: 'image_anim', src: 'aaaa' },   // doublon
    c: { type: 'image_anim' },                // pas de src
    d: { type: 'image', src: 'zzzz' },        // pas une anim
  } };
  assert.deepEqual(referencedAimgKeys(state).sort(), ['aaaa']);
});
