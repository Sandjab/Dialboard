import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBundle, decodeBundle, missingKeys } from '../js/bundle.js';

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
  assert.throws(() => decodeBundle(JSON.stringify({ layout, assets: {} })), /version|invalid/i);
});

test('decodeBundle : rejette un bundle sans layout (intent : un bundle tronqué échoue clairement)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ version: 1, assets: {} })), /version|invalid/i);
});

const stateMK = {
  pages: [{ background_image: 'bg1' }, { background_image: 'bg2' }],
  components: {
    c1: { type: 'image', src: 'img1' },
    c2: { type: 'image_anim', src: 'anim1' },
  },
};

test('missingKeys : liste par type les clés référencées absentes des assets (intent : avertir avant un bundle partiel)', () => {
  const assets = { bg: { bg1: new Uint8Array([1]) }, image: {}, aimg: { anim1: new Uint8Array([2]) } };
  assert.deepEqual(missingKeys(stateMK, assets), { bg: ['bg2'], image: ['img1'], aimg: [] });
});

test('missingKeys : assets vides → toutes les clés référencées manquent (intent : export sans cache = tout absent)', () => {
  assert.deepEqual(missingKeys(stateMK, {}), { bg: ['bg1', 'bg2'], image: ['img1'], aimg: ['anim1'] });
});

test('missingKeys : tout en cache → aucun manquant (intent : bundle complet = pas d\'avertissement)', () => {
  const full = { bg: { bg1: 1, bg2: 1 }, image: { img1: 1 }, aimg: { anim1: 1 } };
  assert.deepEqual(missingKeys(stateMK, full), { bg: [], image: [], aimg: [] });
});

test('decodeBundle : accepte un bundle v2 avec meta (intent : consommer un .dboard du Store)', () => {
  const v2 = JSON.stringify({
    version: 2,
    meta: { name: 'X', author: 'a', description: 'd', domain: 'time', tags: ['t'], requires: '' },
    layout,
    assets: { bg: { a1: 'AQID' }, image: {}, aimg: {} },   // AQID = base64 de [1,2,3]
  });
  const back = decodeBundle(v2);
  assert.deepEqual(JSON.parse(back.layout), layout);        // meta ignoré, layout intact
  assert.deepEqual([...back.assets.bg.a1], [1, 2, 3]);
});

test('decodeBundle : rejette une version inconnue (intent : ne pas charger un format futur non géré)', () => {
  assert.throws(() => decodeBundle(JSON.stringify({ version: 3, layout, assets: {} })), /version|invalid/i);
});
