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

// --- Coalescence d'undo (F2 : flèches/spinner d'un champ numérique ne doivent pas inonder l'undo) ---

test('commits de même clé de coalescence fusionnent en UNE entrée d’undo', () => {
  const m = createModel();
  const base = m.state.title;
  m.commit(s => { s.title = '1'; }, { coalesce: 'k' });
  m.commit(s => { s.title = '2'; }, { coalesce: 'k' });
  m.commit(s => { s.title = '3'; }, { coalesce: 'k' });
  assert.equal(m.state.title, '3');
  m.undo();                              // UNE annulation revient à l'état pré-édition
  assert.equal(m.state.title, base);
  assert.equal(m.canUndo(), false);      // pas d'entrées intermédiaires
});

test('clés de coalescence différentes = entrées séparées', () => {
  const m = createModel();
  m.commit(s => { s.title = 'A'; }, { coalesce: 'x' });
  m.commit(s => { s.title = 'B'; }, { coalesce: 'y' });
  m.undo();
  assert.equal(m.state.title, 'A');
});

test('un commit sans clé casse la coalescence', () => {
  const m = createModel();
  m.commit(s => { s.title = 'A'; }, { coalesce: 'k' });
  m.commit(s => { s.title = 'B'; });            // sans clé → entrée neuve
  m.commit(s => { s.title = 'C'; }, { coalesce: 'k' });   // ne refusionne pas avec 'A'
  m.undo(); assert.equal(m.state.title, 'B');
  m.undo(); assert.equal(m.state.title, 'A');
});

test('breakCoalesce() coupe la chaîne malgré une clé identique (fin de session au blur)', () => {
  const m = createModel();
  const base = m.state.title;
  m.commit(s => { s.title = 'A'; }, { coalesce: 'k' });
  m.breakCoalesce();
  m.commit(s => { s.title = 'B'; }, { coalesce: 'k' });
  m.undo(); assert.equal(m.state.title, 'A');
  m.undo(); assert.equal(m.state.title, base);
});

test('undo réinitialise la coalescence (le commit suivant ne refusionne pas par-dessus le redo)', () => {
  const m = createModel();
  const base = m.state.title;
  m.commit(s => { s.title = 'A'; }, { coalesce: 'k' });
  m.undo();                                      // revient à base, lastCoalesce remis à null
  m.commit(s => { s.title = 'B'; }, { coalesce: 'k' });
  m.undo(); assert.equal(m.state.title, base);   // B était bien une entrée neuve
});
