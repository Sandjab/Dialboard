import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, interpolate, isLatin1, latin1Violations, missingKeys } from '../js/i18n.js';

test("lookup: pack prioritaire sur EN (intent : la langue active gagne)", () => {
  assert.equal(lookup({ 'a': 'FR' }, { 'a': 'EN' }, 'a'), 'FR');
});

test("lookup: clé absente du pack → fallback EN (intent : pack incomplet ne casse pas l'UI)", () => {
  assert.equal(lookup({}, { 'a': 'EN' }, 'a'), 'EN');
});

test("lookup: clé absente partout → clé brute (intent : jamais d'écran vide)", () => {
  assert.equal(lookup({}, {}, 'x.y'), 'x.y');
});

test("lookup: valeur vide explicite préservée, pas de fallback (intent : unité par défaut vide légitime)", () => {
  assert.equal(lookup({ 'default.comp.unit': '' }, { 'default.comp.unit': '°C' }, 'default.comp.unit'), '');
});

test('interpolate: remplace les placeholders nommés', () => {
  assert.equal(interpolate('Page « {name} »', { name: 'Accueil' }), 'Page « Accueil »');
  assert.equal(interpolate('{n} sur {n}', { n: 3 }), '3 sur 3');
});

test("interpolate: placeholder sans valeur laissé tel quel (intent : pas de \"undefined\")", () => {
  assert.equal(interpolate('a {x} b', {}), 'a {x} b');
});

test("interpolate: params non-objet ou valeur undefined → placeholder intact (intent : pas de plantage ni \"undefined\")", () => {
  assert.equal(interpolate('a {x} b', 'foo'), 'a {x} b');          // params primitif : pas de TypeError sur `in`
  assert.equal(interpolate('a {x} b', 5), 'a {x} b');
  assert.equal(interpolate('a {x} b', { x: undefined }), 'a {x} b');   // undefined → laissé tel quel, pas la chaîne "undefined"
});

test('isLatin1: accents OK, hors-Latin-1 rejeté (intent : parité fontes device, cf. WS-2)', () => {
  assert.equal(isLatin1('Météo · °C'), true);
  assert.equal(isLatin1('Texte'), true);
  assert.equal(isLatin1('😀'), false);
  assert.equal(isLatin1('日本語'), false);
});

test('latin1Violations: seules les clés default.* sont contraintes (intent : chrome libre, contenu device borné)', () => {
  const pack = { 'default.comp.text': '😀', 'toast.ok': '✓ hors-Latin-1 ok', 'default.comp.label': 'Étiquette' };
  assert.deepEqual(latin1Violations(pack), ['default.comp.text']);   // toast.* (chrome) ignoré ; default.comp.label (Latin-1) ok
});

test('missingKeys: clés EN absentes du pack (intent : mesure de complétude)', () => {
  assert.deepEqual(missingKeys({ a: '', b: '', c: '' }, { a: '' }), ['b', 'c']);
});
