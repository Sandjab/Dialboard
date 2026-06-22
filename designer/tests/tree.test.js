import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeModel } from '../js/tree.js';

// État avec 2 pages ; page 0 a 3 placements dans l'ordre [ring, readout, image].
const fresh = () => ({
  title: 'Mon dash',
  components: {
    temp_ring: { type: 'ring', color: '#fff' },
    temp_val:  { type: 'readout' },
    logo_bg:   { type: 'image', visible: false },
  },
  pages: [
    { name: 'Accueil', place: [
      { ref: 'temp_ring', radius: 80 },
      { ref: 'temp_val', anchor: 'CENTER' },
      { ref: 'logo_bg', anchor: 'CENTER' },
    ] },
    { name: 'Détails', place: [] },
  ],
});

test('treeModel expose le titre et les pages dans l’ordre de navigation', () => {
  const t = treeModel(fresh());
  assert.equal(t.title, 'Mon dash');
  assert.deepEqual(t.pages.map(p => p.name), ['Accueil', 'Détails']);
  assert.deepEqual(t.pages.map(p => p.index), [0, 1]);
});

test('treeModel rend les composants en z-order INVERSÉ avec leur index RÉEL', () => {
  const comps = treeModel(fresh()).pages[0].components;
  // place[] = [ring(0), readout(1), image(2)] → affichage [image, readout, ring]
  assert.deepEqual(comps.map(c => c.ref), ['logo_bg', 'temp_val', 'temp_ring']);
  assert.deepEqual(comps.map(c => c.index), [2, 1, 0]);   // index dans place[], pas l'ordre d'affichage
});

test('treeModel dérive le libellé de type depuis le registre', () => {
  const comps = treeModel(fresh()).pages[0].components;
  const byRef = Object.fromEntries(comps.map(c => [c.ref, c]));
  assert.equal(byRef.temp_ring.type, 'ring');
  assert.equal(byRef.temp_ring.label, 'Anneau');   // COMPONENTS.ring.label
  assert.equal(byRef.temp_val.label, 'Lecture');   // COMPONENTS.readout.label
});

test('treeModel : visible=false seulement si la clé vaut explicitement false', () => {
  const comps = treeModel(fresh()).pages[0].components;
  const byRef = Object.fromEntries(comps.map(c => [c.ref, c]));
  assert.equal(byRef.logo_bg.visible, false);   // visible:false dans le composant
  assert.equal(byRef.temp_val.visible, true);   // clé absente → visible
});

test('treeModel : ref orpheline → type null, libellé de repli, ligne conservée', () => {
  const s = fresh();
  s.pages[0].place.push({ ref: 'fantome' });   // aucun composant 'fantome'
  const comps = treeModel(s).pages[0].components;
  const ghost = comps.find(c => c.ref === 'fantome');
  assert.equal(ghost.type, null);
  assert.equal(ghost.label, '?');
  assert.equal(ghost.visible, true);
});

test('treeModel tolère un état vide / sans pages (pas de throw)', () => {
  assert.deepEqual(treeModel({}).pages, []);
  assert.equal(treeModel({}).title, '');
});
