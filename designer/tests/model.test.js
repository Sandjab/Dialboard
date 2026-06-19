import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../js/model.js';

test('commit applique une mutation et la rend visible', () => {
  const m = createModel();
  m.commit(s => { s.title = 'X'; });
  assert.equal(m.state.title, 'X');
});

test("undo restaure l'état précédent", () => {
  const m = createModel();
  const before = m.state.title;
  m.commit(s => { s.title = 'X'; });
  m.undo();
  assert.equal(m.state.title, before);
});

test('redo réapplique', () => {
  const m = createModel();
  m.commit(s => { s.title = 'X'; });
  m.undo(); m.redo();
  assert.equal(m.state.title, 'X');
});

test('une nouvelle mutation vide la pile redo', () => {
  const m = createModel();
  m.commit(s => { s.title = 'A'; });
  m.undo();
  m.commit(s => { s.title = 'B'; });
  assert.equal(m.canRedo(), false);
});

test('subscribe est notifié à chaque changement', () => {
  const m = createModel();
  let n = 0; m.subscribe(() => n++);
  m.commit(s => { s.title = 'X'; });
  m.undo();
  assert.equal(n, 2);
});

test('toJSON / loadJSON round-trip', () => {
  const m = createModel();
  const json = m.toJSON();
  const original = JSON.parse(json).title;
  m.commit(s => { s.title = 'changed'; });
  m.loadJSON(json);
  assert.equal(m.state.title, original);
});

test('les snapshots sont clonés (pas de fuite par référence)', () => {
  const m = createModel();
  m.commit(s => { s.title = 'A'; });
  m.commit(s => { s.title = 'B'; });
  m.undo();
  assert.equal(m.state.title, 'A');
});

test('loadJSON laisse le modèle intact si le JSON est invalide', () => {
  const m = createModel();
  const before = m.toJSON();
  assert.throws(() => m.loadJSON('{invalid'), SyntaxError);
  assert.equal(m.toJSON(), before);
  assert.equal(m.canUndo(), false); // snapshot() ne doit PAS avoir été appelé
});

test('unsubscribe arrête les notifications', () => {
  const m = createModel();
  let n = 0;
  const off = m.subscribe(() => n++);
  m.commit(s => { s.title = 'A'; });
  off();
  m.commit(s => { s.title = 'B'; });
  assert.equal(n, 1);
});

test('undo/redo sont des no-op (sans notification) sur un modèle frais', () => {
  const m = createModel();
  let n = 0; m.subscribe(() => n++);
  assert.equal(m.canUndo(), false);
  assert.equal(m.canRedo(), false);
  m.undo(); m.redo();
  assert.equal(n, 0); // aucun emit
});

test('loadJSON est annulable (crée une entrée undo)', () => {
  const m = createModel();
  const before = m.state.title;
  m.loadJSON(JSON.stringify({ ...m.state, title: 'Loaded' }));
  assert.equal(m.state.title, 'Loaded');
  assert.equal(m.canUndo(), true);
  m.undo();
  assert.equal(m.state.title, before);
});
