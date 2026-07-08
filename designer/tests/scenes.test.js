import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SCENE_NAMES, sceneFrameAt, sceneLayerColor, sceneDefaultColor } from '../js/scenes.js';

test('catalogue : 9 scènes, SCENE_NAMES == clés de SCENES, chaque scène a des couches', () => {
  assert.equal(SCENE_NAMES.length, 9);
  assert.deepEqual([...SCENE_NAMES].sort(), Object.keys(SCENES).sort());
  for (const n of SCENE_NAMES) assert.ok(SCENES[n].layers.length >= 1);
});

test('sceneFrameAt : rotate -> angle 0 à t=0, ~1800 à demi-période, périodique', () => {
  assert.equal(sceneFrameAt('sunny', 0)[0].angleDdeg, 0);
  const half = sceneFrameAt('sunny', 3500)[0].angleDdeg;
  assert.ok(half > 1700 && half < 1900);
  assert.equal(sceneFrameAt('sunny', 1234)[0].angleDdeg, sceneFrameAt('sunny', 1234 + 7000)[0].angleDdeg);
});

test('sceneFrameAt : translate_loop -> cy varie, opa bornée, phases décalées', () => {
  const fr = sceneFrameAt('rain', 550);
  assert.equal(fr.length, 4);
  assert.equal(fr[0].cy, 38);                       // couche statique fixe
  assert.ok(fr[1].opa >= 0 && fr[1].opa <= 255);
  assert.notEqual(fr[1].cy, fr[2].cy);              // phases différentes
});

test('sceneFrameAt : pulse -> scale >= 1, opa dans [0,255]', () => {
  const f = sceneFrameAt('alert', 700)[0];
  assert.ok(f.scale >= 1 && f.scale <= 1.5);
  assert.ok(f.opa >= 0 && f.opa <= 255);
});

test('sceneFrameAt : name inconnu -> []', () => { assert.deepEqual(sceneFrameAt('nope', 0), []); });

test('sceneLayerColor : principal suit, accent fixe', () => {
  const s = SCENES.storm;
  assert.equal(sceneLayerColor(s.layers[0], '#3399FF'), '#3399FF');
  assert.equal(sceneLayerColor(s.layers[1], '#3399FF'), '#F5C518');
  assert.equal(sceneDefaultColor('rain'), '#3B82F6');
});
