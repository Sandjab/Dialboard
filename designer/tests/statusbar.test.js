import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValidationSummary } from '../js/statusbar.js';

test("formatValidationSummary : 0 erreur 0 avert → ✓ valid, niveau ok (intent : feu vert, push possible)", () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: [] });
  assert.equal(r.text, '✓ valid');
  assert.equal(r.level, 'ok');
});

test("formatValidationSummary : erreurs → ✗ N error(s), niveau err (intent : push bloqué, compte visible)", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a', 'b'], warnings: [] });
  assert.equal(r.text, '✗ 2 error(s)');
  assert.equal(r.level, 'err');
});

test("formatValidationSummary : une seule erreur → ✗ 1 error(s)", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: [] });
  assert.equal(r.text, '✗ 1 error(s)');
});

test("formatValidationSummary : 0 erreur + warnings → reste « ✓ valid » + compte avert, niveau warn (intent : un warning ne bloque PAS le push, sémantique validate.js)", () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: ['x', 'y'] });
  assert.equal(r.text, '✓ valid · 2 warning(s)');
  assert.equal(r.level, 'warn');
});

test("formatValidationSummary : erreurs ET warnings → l'erreur prime (intent : ne pas noyer le bloquant sous l'avertissement)", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: ['x'] });
  assert.equal(r.level, 'err');
});

import { formatSelectionContext } from '../js/statusbar.js';

// Layout minimal : 2 pages, 3 placements au total (2 + 1), un composant masqué.
const ST = {
  title: 'Demo',
  pages: [
    { name: 'Accueil', place: [{ ref: 'ring1', anchor: 'CENTER', dx: 0, dy: -20 }, { ref: 'lbl1', anchor: 'TOP_MID', dx: 0, dy: 40 }] },
    { name: 'Détails', place: [{ ref: 'img1', anchor: 'CENTER', dx: 5, dy: 5 }] },
  ],
  components: {
    ring1: { type: 'ring' },
    lbl1: { type: 'label' },
    img1: { type: 'image', visible: false },
  },
};

test('formatSelectionContext : null → « Nothing selected »', () => {
  assert.equal(formatSelectionContext(ST, null), 'Nothing selected');
});

test('formatSelectionContext : doc → N page(s) · M component(s) (M = somme des placements, pas la map ; intent : compter le visuel, pas les physiques)', () => {
  assert.equal(formatSelectionContext(ST, { kind: 'doc' }), '2 page(s) · 3 component(s)');
});

test("formatSelectionContext : page → nom + index base 1 + nb placements de CETTE page", () => {
  const s = formatSelectionContext(ST, { kind: 'page', page: 0 });
  assert.match(s, /Accueil/);
  assert.match(s, /1\/2/);
  assert.match(s, /2 component\(s\)/);
});

test("formatSelectionContext : comp → libellé de type + ref + page + visible (intent : identifier l'élément édité d'un coup d'œil)", () => {
  const s = formatSelectionContext(ST, { kind: 'comp', page: 0, index: 0 });
  assert.match(s, /Anneau/);     // COMPONENTS.ring.label
  assert.match(s, /ring1/);
  assert.match(s, /Accueil/);
  assert.match(s, /visible/);
});

test("formatSelectionContext : comp masqué → « hidden » (rendu EN en contexte test)", () => {
  const s = formatSelectionContext(ST, { kind: 'comp', page: 1, index: 0 });
  assert.match(s, /Image/);      // COMPONENTS.image.label
  assert.match(s, /hidden/);
});

test("formatSelectionContext : comp à ref orpheline → repli « ? » sans throw (intent : robustesse, ne pas casser la barre)", () => {
  const orphan = { pages: [{ name: 'P', place: [{ ref: 'nope' }] }], components: {} };
  const s = formatSelectionContext(orphan, { kind: 'comp', page: 0, index: 0 });
  assert.match(s, /\?/);
  assert.match(s, /nope/);
});

test("formatSelectionContext : sélection périmée (index hors place) → chaîne vide, pas de throw", () => {
  assert.equal(formatSelectionContext(ST, { kind: 'comp', page: 0, index: 9 }), '');
});
