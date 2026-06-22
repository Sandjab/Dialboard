import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator } from '../js/validate.js';
import { DEFAULT_LAYOUT } from '../js/default-layout.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/layout.schema.json', import.meta.url)));
const validate = createValidator(schema);

test('layout par défaut est valide', () => {
  const r = validate(DEFAULT_LAYOUT);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('type de composant inconnu → invalide', () => {
  const bad = structuredClone(DEFAULT_LAYOUT);
  bad.components.titre.type = 'wat';
  assert.equal(validate(bad).valid, false);
});

test('couleur hex invalide → invalide', () => {
  const bad = structuredClone(DEFAULT_LAYOUT);
  bad.background = 'red';
  assert.equal(validate(bad).valid, false);
});

test("ref de placement non résolue → invalide (sémantique, hors JSON Schema)", () => {
  const bad = structuredClone(DEFAULT_LAYOUT);
  bad.pages[0].place[0].ref = 'ghost';
  const r = validate(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('ghost')));        // message humanisé : « page 1 : référence inconnue « ghost » »
});

test('erreurs de forme ET sémantique coexistent (pas de court-circuit)', () => {
  const bad = structuredClone(DEFAULT_LAYOUT);
  bad.background = 'red';               // erreur de forme
  bad.pages[0].place[0].ref = 'ghost';  // erreur sémantique
  const r = validate(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('background')));   // « background : doit être une couleur #RRGGBB »
  assert.ok(r.errors.some(e => e.includes('ghost')));
});

test("ref absente → erreur de forme seule, pas de 'ref inconnue undefined'", () => {
  const bad = structuredClone(DEFAULT_LAYOUT);
  delete bad.pages[0].place[0].ref;
  const r = validate(bad);
  assert.equal(r.valid, false); // la forme échoue (ref requis par le schema)
  assert.ok(!r.errors.some(e => e.includes('undefined')));
});

test('layout importé au pages non-array → invalide SANS throw (import robuste)', () => {
  // ajv signale la forme ; le check sémantique des refs ne doit pas planter sur un pages non-array.
  const r = validate({ components: { x: { type: 'label', text: 'Hi' } }, pages: {} });
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});

test('limite firmware : trop de composants (>32) → invalide', () => {
  const comps = {};
  for (let i = 0; i < 33; i++) comps['c' + i] = { type: 'label', text: 'x' };
  const r = validate({ components: comps, pages: [{ name: 'p', place: [] }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('composants')));
});

test('limite firmware : trop de pages (>8) → invalide', () => {
  const pages = [];
  for (let i = 0; i < 9; i++) pages.push({ name: 'p' + i, place: [] });
  const r = validate({ components: { x: { type: 'label', text: 'x' } }, pages });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('pages')));
});

test('limite firmware : trop de placements sur une page (>12) → invalide', () => {
  const place = [];
  for (let i = 0; i < 13; i++) place.push({ ref: 'x', anchor: 'CENTER' });
  const r = validate({ components: { x: { type: 'label', text: 'x' } }, pages: [{ name: 'p', place }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('placements')));
});

test('bind sans variable de source → avertissement non bloquant (reste valide)', () => {
  const r = validate({ components: { t: { type: 'readout', bind: 'temp', unit: 'C' } }, pages: [{ name: 'p', place: [{ ref: 't', anchor: 'CENTER' }] }] });
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some(w => w.includes('temp')));
});

test('bind avec variable de source déclarée → pas d\'avertissement', () => {
  const r = validate({
    components: { t: { type: 'readout', bind: 'temp', unit: 'C' } },
    sources: [{ url: 'http://x', vars: { temp: '/main/temp' } }],
    pages: [{ name: 'p', place: [{ ref: 't', anchor: 'CENTER' }] }]
  });
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
});

test('layout avec formes (rect/circle/line) est valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.r1 = { type: 'rect', fill: '#FF0000', border_width: 2, border_color: '#FFFFFF' };
  l.components.c1 = { type: 'circle' };
  l.components.l1 = { type: 'line', color: '#FFFFFF', orientation: 'vertical', dash: 'dashed', rounded: true };
  l.pages[0].place.push(
    { ref: 'r1', anchor: 'CENTER', dx: 0, dy: 0, width: 120, height: 60, radius: 8 },
    { ref: 'c1', anchor: 'CENTER', dx: 0, dy: 0, size: 60 },
    { ref: 'l1', anchor: 'CENTER', dx: 0, dy: 0, width: 100, thickness: 2 },
  );
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('propriété inconnue sur une forme → invalide (additionalProperties:false)', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.r1 = { type: 'rect', wat: 1 };
  l.pages[0].place.push({ ref: 'r1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});
