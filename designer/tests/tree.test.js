import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeModel, reorderTargetIndex, insertTargetIndex } from '../js/tree.js';
import { contextMenuItems } from '../js/contextmenu.js';

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

// ── reorderTargetIndex ──────────────────────────────────────────────────────
// Applique le déplacement et renvoie l'ordre d'AFFICHAGE (dessus d'abord = place[] inversé).
function displayAfterDrop(refs, fromRef, toRef, before) {
  const place = refs.map(r => ({ ref: r }));
  const from = place.findIndex(p => p.ref === fromRef);
  const to = place.findIndex(p => p.ref === toRef);
  const target = reorderTargetIndex(place, from, to, before);
  const [m] = place.splice(from, 1);
  place.splice(target, 0, m);
  return place.map(p => p.ref).reverse();   // display order
}

// Fournis par la spec (exemples de référence) :
test('reorderTargetIndex : drag a au-dessus de c → a juste au-dessus de c en affichage', () => {
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'a', 'c', true), ['a','c','b']);
});
test('reorderTargetIndex : drag a au-dessus de b → a juste au-dessus de b', () => {
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'a', 'b', true), ['c','a','b']);
});

// Tests dérivés de l'INTENTION : before=false = curseur moitié basse → atterrit SOUS la ligne cible.
// Affichage initial pour ['a','b','c'] = [c, b, a] (top-first).

test('reorderTargetIndex : drag c en dessous de a (before=false) → c juste en-dessous de a', () => {
  // Intention : 'c' (sommet display) déplacé sous 'a' (bas display) → affichage [b, a, c]
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'c', 'a', false), ['b','a','c']);
});

test('reorderTargetIndex : drag b en dessous de a (before=false) → b juste en-dessous de a', () => {
  // Intention : 'b' déplacé sous 'a' → affichage [c, a, b]
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'b', 'a', false), ['c','a','b']);
});

test('reorderTargetIndex : drag sur soi-même → ordre inchangé (no-op)', () => {
  // Un drop sur soi-même retourne from → le DOM ignore (to === from), l'ordre reste intact.
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'b', 'b', true), ['c','b','a']);
});

test('reorderTargetIndex : cas 4 éléments — drag d au-dessus de b', () => {
  // place[]=[a,b,c,d], affichage=[d,c,b,a]. Drag d (sommet) au-dessus de b (display pos 2).
  // Intention : d atterrit juste au-dessus de b → affichage [c,d,b,a]
  assert.deepEqual(displayAfterDrop(['a','b','c','d'], 'd', 'b', true), ['c','d','b','a']);
});

test('reorderTargetIndex : drag c au-dessus de b → c juste au-dessus de b', () => {
  // Intention : 'c' (display top) déplacé au-dessus de 'b' (display pos 1) → affichage [c, b, a]
  // (c était déjà là — no-op effectif : target === from)
  assert.deepEqual(displayAfterDrop(['a','b','c'], 'c', 'b', true), ['c','b','a']);
});

// ── insertTargetIndex ───────────────────────────────────────────────────────
// Insertion d'un composant VENU D'UNE AUTRE PAGE dans le tableau cible (pas de retrait préalable dans
// cette page → pas la compensation de splice de reorderTargetIndex). Renvoie l'affichage (top-first).
function displayAfterInsert(targetRefs, insertRef, toRef, before) {
  const place = targetRefs.map(r => ({ ref: r }));
  const to = place.findIndex(p => p.ref === toRef);
  const target = insertTargetIndex(place, to, before);
  place.splice(target, 0, { ref: insertRef });
  return place.map(p => p.ref).reverse();
}

test('insertTargetIndex : X au-dessus de c (sommet display) → X tout en haut', () => {
  assert.deepEqual(displayAfterInsert(['a','b','c'], 'X', 'c', true), ['X','c','b','a']);
});
test('insertTargetIndex : X au-dessus de b → X juste au-dessus de b', () => {
  assert.deepEqual(displayAfterInsert(['a','b','c'], 'X', 'b', true), ['c','X','b','a']);
});
test('insertTargetIndex : X sous a (bas display, before=false) → X tout en bas', () => {
  assert.deepEqual(displayAfterInsert(['a','b','c'], 'X', 'a', false), ['c','b','a','X']);
});
test('insertTargetIndex : X sous b (before=false) → X juste sous b', () => {
  assert.deepEqual(displayAfterInsert(['a','b','c'], 'X', 'b', false), ['c','b','X','a']);
});
test('insertTargetIndex : page cible à un seul élément, X au-dessus → X en tête display', () => {
  assert.deepEqual(displayAfterInsert(['a'], 'X', 'a', true), ['X','a']);
});
