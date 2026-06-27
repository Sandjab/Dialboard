import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhysicalType, physicalTypes, physicalComponentIds,
  stripPhysicalPlacements, ensurePhysicals, pruneOrphans
} from '../js/physical.js';

test('isPhysicalType : led_ring/sound physiques, label/inconnu non', () => {
  assert.equal(isPhysicalType('led_ring'), true);
  assert.equal(isPhysicalType('sound'), true);
  assert.equal(isPhysicalType('label'), false);
  assert.equal(isPhysicalType('inconnu'), false);
});

test('physicalTypes : contient led_ring et sound, pas label', () => {
  const ts = physicalTypes();
  assert.ok(ts.includes('led_ring') && ts.includes('sound'));
  assert.equal(ts.includes('label'), false);
});

test('physicalComponentIds : ne renvoie que les physiques', () => {
  const s = { components: { titre: { type: 'label' }, led: { type: 'led_ring' } }, pages: [] };
  assert.deepEqual(physicalComponentIds(s), ['led']);   // 'titre' (label) exclu
});

test('stripPhysicalPlacements : retire physiques, garde visuels + composants', () => {
  const s = {
    components: { led: { type: 'led_ring' }, buzz: { type: 'sound' }, titre: { type: 'label' } },
    pages: [
      { name: 'P1', place: [{ ref: 'led' }, { ref: 'titre' }] },
      { name: 'P2', place: [{ ref: 'buzz' }] }
    ]
  };
  stripPhysicalPlacements(s);
  assert.deepEqual(s.pages[0].place, [{ ref: 'titre' }]);
  assert.deepEqual(s.pages[1].place, []);
  assert.ok(s.components.led && s.components.buzz && s.components.titre);   // composants conservés
});

test('stripPhysicalPlacements : idempotent', () => {
  const s = { components: { led: { type: 'led_ring' } }, pages: [{ name: 'P1', place: [{ ref: 'led' }] }] };
  stripPhysicalPlacements(s); stripPhysicalPlacements(s);
  assert.deepEqual(s.pages[0].place, []);
});

test('ensurePhysicals : injecte led_ring(off) et sound(buzz) si absents', () => {
  const s = { components: {}, pages: [] };
  ensurePhysicals(s);
  assert.equal(s.components.led?.type, 'led_ring');
  assert.equal(s.components.led?.mode, 'off');           // neutre par défaut
  assert.equal(s.components.buzz?.type, 'sound');
});

test('ensurePhysicals : pas de doublon si le type est déjà présent', () => {
  const s = { components: { myled: { type: 'led_ring', mode: 'solid' }, b: { type: 'sound' } }, pages: [] };
  ensurePhysicals(s);
  assert.equal(Object.values(s.components).filter(c => c.type === 'led_ring').length, 1);
  assert.equal(Object.values(s.components).filter(c => c.type === 'sound').length, 1);
});

test('ensurePhysicals : préserve un led_ring déjà configuré (ne réinitialise pas)', () => {
  const s = { components: { myled: { type: 'led_ring', mode: 'solid', color: '#FF0000' } }, pages: [] };
  ensurePhysicals(s);
  assert.equal(s.components.myled.mode, 'solid');
  assert.equal(s.components.myled.color, '#FF0000');
});

test('ensurePhysicals : id par défaut déjà pris par autre chose → dé-dup', () => {
  const s = { components: { led: { type: 'label', text: 'X' } }, pages: [] };   // 'led' occupé par un label
  ensurePhysicals(s);
  const ringId = Object.keys(s.components).find(k => s.components[k].type === 'led_ring');
  assert.ok(ringId && ringId !== 'led', `id ring attendu != 'led', reçu ${ringId}`);
  assert.equal(s.components.led.type, 'label');           // le label 'led' est intact
});

test('ensurePhysicals : idempotent', () => {
  const s = { components: {}, pages: [] };
  ensurePhysicals(s); ensurePhysicals(s);
  assert.equal(Object.values(s.components).filter(c => c.type === 'led_ring').length, 1);
  assert.equal(Object.values(s.components).filter(c => c.type === 'sound').length, 1);
});

test('pruneOrphans : retire un composant non placé et non physique', () => {
  const s = { components: { titre: { type: 'label' }, vieux: { type: 'bar' } },
              pages: [{ name: 'P1', place: [{ ref: 'titre' }] }] };
  pruneOrphans(s);
  assert.ok(s.components.titre);                 // placé → conservé
  assert.equal(s.components.vieux, undefined);   // orphelin hérité → retiré
});

test('pruneOrphans : conserve les physiques même non placés', () => {
  const s = { components: { led: { type: 'led_ring' }, buzz: { type: 'sound' } },
              pages: [{ name: 'P1', place: [] }] };
  pruneOrphans(s);
  assert.ok(s.components.led && s.components.buzz);   // globaux sans placement → conservés
});

test('pruneOrphans : conserve un composant placé sur n\'importe quelle page', () => {
  const s = { components: { a: { type: 'bar' } },
              pages: [{ name: 'P1', place: [] }, { name: 'P2', place: [{ ref: 'a' }] }] };
  pruneOrphans(s);
  assert.ok(s.components.a);
});

test('pruneOrphans : idempotent', () => {
  const s = { components: { x: { type: 'label' } }, pages: [{ name: 'P1', place: [] }] };
  pruneOrphans(s); pruneOrphans(s);
  assert.equal(s.components.x, undefined);
});
