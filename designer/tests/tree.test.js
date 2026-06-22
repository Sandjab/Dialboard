import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeModel, contextMenuItems } from '../js/tree.js';

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

const stateFix = () => ({
  pages: [
    { name: 'P1', place: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }] },  // z: a(fond,0) .. c(sommet,2)
    { name: 'P2', place: [] },
  ],
  components: { a: { type: 'label' }, b: { type: 'label' }, c: { type: 'label' } },
});

test('contextMenuItems : doc → vide', () => {
  assert.deepEqual(contextMenuItems({ kind: 'doc' }, stateFix(), {}), []);
});

test('contextMenuItems : null → vide', () => {
  assert.deepEqual(contextMenuItems(null, stateFix(), {}), []);
});

test('contextMenuItems : comp au milieu → toutes les actions, raiseZ/lowerZ actifs', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 1 }, stateFix(), { hasClipboard: true });
  const ids = items.map(i => i.id);
  for (const id of ['rename', 'duplicate', 'copy', 'cut', 'paste', 'delete', 'raiseZ', 'lowerZ', 'moveToPage'])
    assert.ok(ids.includes(id), `manque ${id}`);
  assert.equal(items.find(i => i.id === 'raiseZ').disabled, false);
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, false);
  assert.equal(items.find(i => i.id === 'paste').disabled, false);
});

test('contextMenuItems : comp au sommet z (dernier place) → raiseZ désactivé', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 2 }, stateFix(), {});
  assert.equal(items.find(i => i.id === 'raiseZ').disabled, true);
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, false);
});

test('contextMenuItems : comp au fond z (index 0) → lowerZ désactivé', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), {});
  assert.equal(items.find(i => i.id === 'lowerZ').disabled, true);
});

test('contextMenuItems : paste désactivé sans presse-papier', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), { hasClipboard: false });
  assert.equal(items.find(i => i.id === 'paste').disabled, true);
});

test('contextMenuItems : moveToPage liste les AUTRES pages', () => {
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, stateFix(), {});
  const sub = items.find(i => i.id === 'moveToPage').submenu;
  assert.deepEqual(sub.map(s => s.page), [1]);
  assert.equal(sub[0].label, 'P2');
});

test('contextMenuItems : comp dans un layout à une seule page → pas de moveToPage', () => {
  const s = { pages: [{ name: 'P1', place: [{ ref: 'a' }] }], components: { a: { type: 'label' } } };
  const items = contextMenuItems({ kind: 'comp', page: 0, index: 0 }, s, {});
  assert.equal(items.find(i => i.id === 'moveToPage'), undefined);
});

test('contextMenuItems : page au milieu → moveUp/moveDown actifs, delete actif', () => {
  const s = { pages: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }], components: {} };
  const items = contextMenuItems({ kind: 'page', page: 1 }, s, {});
  assert.equal(items.find(i => i.id === 'moveUp').disabled, false);
  assert.equal(items.find(i => i.id === 'moveDown').disabled, false);
  assert.equal(items.find(i => i.id === 'delete').disabled, false);
});

test('contextMenuItems : page unique → delete désactivé', () => {
  const s = { pages: [{ name: 'P1' }], components: {} };
  const items = contextMenuItems({ kind: 'page', page: 0 }, s, {});
  assert.equal(items.find(i => i.id === 'delete').disabled, true);
  assert.equal(items.find(i => i.id === 'moveUp').disabled, true);
  assert.equal(items.find(i => i.id === 'moveDown').disabled, true);
});
