import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhysicalType, physicalTypes, physicalComponentIds,
  addPhysicalComponent, removeComponent, stripPhysicalPlacements, canAddType
} from '../js/physical.js';

const fresh = () => ({
  components: { titre: { type: 'label', text: 'Hi' } },
  pages: [{ name: 'P1', place: [{ ref: 'titre', anchor: 'CENTER' }] }]
});

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

test('addPhysicalComponent : ajoute dans components SANS placement', () => {
  const s = fresh();
  const id = addPhysicalComponent(s, 'led_ring');
  assert.equal(s.components[id].type, 'led_ring');
  assert.equal(s.pages.some(p => p.place.some(pl => pl.ref === id)), false);
});

test('addPhysicalComponent : id unique par type', () => {
  const s = fresh();
  assert.notEqual(addPhysicalComponent(s, 'sound'), addPhysicalComponent(s, 'sound'));
});

test('physicalComponentIds : ne renvoie que les physiques', () => {
  const s = fresh();
  const id = addPhysicalComponent(s, 'led_ring');
  assert.deepEqual(physicalComponentIds(s), [id]);   // 'titre' (label) exclu
});

test('removeComponent : purge components + placements sur toutes les pages', () => {
  const s = {
    components: { led: { type: 'led_ring' }, titre: { type: 'label' } },
    pages: [
      { name: 'P1', place: [{ ref: 'led' }, { ref: 'titre' }] },
      { name: 'P2', place: [{ ref: 'led' }] }
    ]
  };
  removeComponent(s, 'led');
  assert.equal('led' in s.components, false);
  assert.equal(s.components.titre.type, 'label');
  assert.deepEqual(s.pages[0].place, [{ ref: 'titre' }]);
  assert.deepEqual(s.pages[1].place, []);
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

test('canAddType : led_ring singleton (true puis false)', () => {
  const s = fresh();
  assert.equal(canAddType(s, 'led_ring'), true);
  addPhysicalComponent(s, 'led_ring');
  assert.equal(canAddType(s, 'led_ring'), false);
});

test('canAddType : sound 0..N (toujours true)', () => {
  const s = fresh();
  addPhysicalComponent(s, 'sound');
  assert.equal(canAddType(s, 'sound'), true);
});
