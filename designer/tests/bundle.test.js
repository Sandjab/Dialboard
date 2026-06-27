import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBundle, decodeBundle } from '../js/bundle.js';

const layout = { title: 'X', pages: [{ name: 'p', place: [] }] };
const assets = {
  bg:    { a1: new Uint8Array([1, 2, 3]) },
  image: { b2: new Uint8Array([4, 5, 6, 7]) },
  aimg:  { c3: new Uint8Array([8, 9]) },
};

test('round-trip : layout + assets des 3 types survivent à encode→decode (intent : le bundle est fidèle)', () => {
  const back = decodeBundle(encodeBundle(JSON.stringify(layout), assets));
  assert.deepEqual(JSON.parse(back.layout), layout);
  assert.deepEqual([...back.assets.bg.a1], [1, 2, 3]);
  assert.deepEqual([...back.assets.image.b2], [4, 5, 6, 7]);
  assert.deepEqual([...back.assets.aimg.c3], [8, 9]);
});

test('encodeBundle : pose version 1 et des assets base64 (intent : format stable et lisible)', () => {
  const o = JSON.parse(encodeBundle(JSON.stringify(layout), assets));
  assert.equal(o.version, 1);
  assert.equal(typeof o.assets.bg.a1, 'string');
});

test('decodeBundle : rejette un bundle sans version (intent : ne pas charger un format inconnu)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ layout, assets: {} })), /version|invalide/i);
});

test('decodeBundle : rejette un bundle sans layout (intent : un bundle tronqué échoue clairement)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ version: 1, assets: {} })), /layout|invalide/i);
});
