import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSelection, createSelection, isSelectionValid } from '../js/selection.js';

test('sameSelection : deux null sont égaux', () => {
  assert.equal(sameSelection(null, null), true);
});

test('sameSelection : null vs objet → différent', () => {
  assert.equal(sameSelection(null, { kind: 'doc' }), false);
  assert.equal(sameSelection({ kind: 'doc' }, null), false);
});

test('sameSelection : deux doc → égaux', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'doc' }), true);
});

test('sameSelection : kinds différents → différents', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'page', page: 0 }), false);
});

test('sameSelection : pages par index', () => {
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 1 }), true);
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 2 }), false);
});

test('sameSelection : composants par page + index', () => {
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 2 }), true);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 3 }), false);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 1, index: 2 }), false);
});

test('createSelection : get rend la sélection initiale (null par défaut)', () => {
  assert.equal(createSelection().get(), null);
  assert.deepEqual(createSelection({ kind: 'doc' }).get(), { kind: 'doc' });
});

test('createSelection : set change la valeur et notifie les abonnés', () => {
  const sel = createSelection();
  let seen;
  sel.subscribe(s => { seen = s; });
  sel.set({ kind: 'page', page: 2 });
  assert.deepEqual(sel.get(), { kind: 'page', page: 2 });
  assert.deepEqual(seen, { kind: 'page', page: 2 });
});

test('createSelection : set d\'une sélection identique n\'émet pas', () => {
  const sel = createSelection({ kind: 'comp', page: 0, index: 1 });
  let calls = 0;
  sel.subscribe(() => calls++);
  sel.set({ kind: 'comp', page: 0, index: 1 });
  assert.equal(calls, 0);
});

test('createSelection : clear remet à null et notifie', () => {
  const sel = createSelection({ kind: 'doc' });
  let seen = 'unset';
  sel.subscribe(s => { seen = s; });
  sel.clear();
  assert.equal(sel.get(), null);
  assert.equal(seen, null);
});

test('createSelection : subscribe renvoie un désabonnement', () => {
  const sel = createSelection();
  let calls = 0;
  const off = sel.subscribe(() => calls++);
  sel.set({ kind: 'doc' });
  off();
  sel.set({ kind: 'page', page: 0 });
  assert.equal(calls, 1);
});

const S = () => ({
  components: { a: {} },
  pages: [{ name: 'P1', place: [{ ref: 'a' }, { ref: 'b' }] }, { name: 'P2', place: [] }],
});

test('isSelectionValid : null → false', () => {
  assert.equal(isSelectionValid(S(), null), false);
});

test('isSelectionValid : doc → toujours valide', () => {
  assert.equal(isSelectionValid(S(), { kind: 'doc' }), true);
});

test('isSelectionValid : page existante / inexistante', () => {
  assert.equal(isSelectionValid(S(), { kind: 'page', page: 1 }), true);
  assert.equal(isSelectionValid(S(), { kind: 'page', page: 9 }), false);
});

test('isSelectionValid : composant existant', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 0, index: 1 }), true);
});

test('isSelectionValid : composant à un index disparu → false', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 0, index: 5 }), false);
});

test('isSelectionValid : composant sur une page disparue → false', () => {
  assert.equal(isSelectionValid(S(), { kind: 'comp', page: 9, index: 0 }), false);
});

test('isSelectionValid : composant sur une page sans tableau place → false', () => {
  assert.equal(isSelectionValid({ pages: [{ name: 'P' }] }, { kind: 'comp', page: 0, index: 0 }), false);
});
