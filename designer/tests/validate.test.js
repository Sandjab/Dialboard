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
  assert.ok(r.errors.some(e => e.includes('components')));
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

test("bind d'un effecteur → pas d'avertissement (l'effecteur produit sa variable)", () => {
  const r = validate({
    components: { sw: { type: 'switch', bind: 'lamp' } },
    pages: [{ name: 'p', place: [{ ref: 'sw', anchor: 'CENTER' }] }]
  });
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
});

test('afficheur lié à une var produite par un effecteur → pas d\'avertissement', () => {
  const r = validate({
    components: { sw: { type: 'switch', bind: 'lamp' }, rd: { type: 'readout', bind: 'lamp' } },
    pages: [{ name: 'p', place: [{ ref: 'sw', anchor: 'CENTER' }, { ref: 'rd', anchor: 'TOP_MID' }] }]
  });
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
});

test('afficheur lié à une var observée par un sink → pas d\'avertissement', () => {
  const r = validate({
    components: { rd: { type: 'readout', bind: 'lamp' } },
    sinks: [{ watch: 'lamp', url: 'http://x' }],
    pages: [{ name: 'p', place: [{ ref: 'rd', anchor: 'CENTER' }] }]
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

test('layout avec icon (base + states) est valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', symbol: 'wifi', color: '#FFFFFF', font: 28,
    states: [{ at: 1, symbol: 'close', color: '#FF0000' }, { at: 50, color: '#FFAA00' }] };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER', dx: 0, dy: 0 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('icon : symbole hors enum -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', symbol: 'rocket' };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('icon : state sans `at` -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', states: [{ symbol: 'wifi' }] };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('icon : clé inconnue dans un state -> invalide (additionalProperties:false)', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.i1 = { type: 'icon', states: [{ at: 1, wat: 2 }] };
  l.pages[0].place.push({ ref: 'i1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('layout avec state (cases glyphe+image + default) est valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.s1 = { type: 'state', bind: 'weather', match: 'exact', font: 64,
    default: { symbol: 'weather-cloudy', color: '#9AA0AA' },
    cases: [
      { key: 'Clear', symbol: 'weather-sunny', color: '#FFC02E' },
      { key: 'Rain', symbol: 'weather-pouring' },
      { key: 3, src: 'abc123', w: 120, h: 120 }] };
  l.pages[0].place.push({ ref: 's1', anchor: 'CENTER', dx: 0, dy: 0 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('state : match hors enum -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.s1 = { type: 'state', match: 'fuzzy', default: { symbol: 'bell' } };
  l.pages[0].place.push({ ref: 's1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('state : symbole hors enum dans un cas -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.s1 = { type: 'state', cases: [{ key: 'X', symbol: 'rocket' }] };
  l.pages[0].place.push({ ref: 's1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('state : cle inconnue dans un cas -> invalide (additionalProperties:false)', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.s1 = { type: 'state', cases: [{ key: 'X', symbol: 'bell', wat: 2 }] };
  l.pages[0].place.push({ ref: 's1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('state : cle inconnue dans default -> invalide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  l.components.s1 = { type: 'state', default: { symbol: 'bell', wat: 2 } };
  l.pages[0].place.push({ ref: 's1', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('state : total de cas > 64 -> invalide ; == 64 -> valide (borne MAX_STATE_CASES_TOTAL du pool)', () => {
  const mk = (nComp) => {
    const l = structuredClone(DEFAULT_LAYOUT);
    for (let s = 0; s < nComp; s++) {                       // composants non placés : seul le total compte
      const cases = [];
      for (let k = 0; k < 16; k++) cases.push({ key: `k${s}_${k}`, symbol: 'bell' });
      l.components[`st${s}`] = { type: 'state', cases };
    }
    return validate(l);
  };
  assert.equal(mk(4).valid, true);    // 4×16 = 64, pas > 64 -> accepté (comme le firmware)
  assert.equal(mk(5).valid, false);   // 5×16 = 80 > 64 -> rejet (miroir du hard-reject firmware)
});

test('state : composant > 16 cas -> avertissement de troncature, reste valide', () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  const cases = [];
  for (let k = 0; k < 20; k++) cases.push({ key: `k${k}`, symbol: 'bell' });
  l.components.st1 = { type: 'state', cases };
  const r = validate(l);
  assert.equal(r.valid, true);                                        // 20 tronqué à 16 <= 64 : ne bloque pas
  assert.ok(r.warnings.some(w => /st1/.test(w)), 'avertissement de troncature attendu');
});
