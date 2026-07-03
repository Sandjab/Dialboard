import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex, domainsOf, filterEntries, DOMAINS } from '../js/store-index.js';

const raw = [
  { id: 'a/clock',  file: 'clock.dboard',   name: 'Horloge', author: 'a', description: 'digitale', domain: 'time',    tags: ['clock'],  layout: { pages: [] } },
  { id: 'b/crypto', file: 'crypto.dboard',  name: 'Ticker',  author: 'b', description: 'BTC/ETH',  domain: 'finance', tags: ['crypto'], layout: { pages: [] } },
  { id: 'c/weird',  file: 'weird.dboard',   name: 'Weird',   author: 'c', description: 'x',         domain: 'zzz',     tags: [],         layout: { pages: [] } },
];

test('parseIndex : normalise et écarte les entrées malformées (intent : une entrée pourrie ne casse pas le catalogue)', () => {
  const bad = [null, {}, { id: 'x' }, { id: 'x', file: 'x.dboard' } /* pas de layout */];
  const out = parseIndex([...raw, ...bad]);
  assert.equal(out.length, 3);                       // les 4 malformées écartées
  assert.equal(out[2].domain, 'other');              // domaine inconnu 'zzz' → 'other'
});

test('parseIndex : défauts sûrs pour les champs optionnels (intent : la galerie ne rend jamais undefined)', () => {
  const out = parseIndex([{ id: 'i/d', file: 'f.dboard', layout: {} }]);
  assert.deepEqual(out, [{ id: 'i/d', file: 'f.dboard', name: 'i/d', author: '', description: '', domain: 'other', tags: [], requires: '', layout: {} }]);
});

test('parseIndex : entrée non-tableau → [] (intent : index corrompu = catalogue vide, pas de throw)', () => {
  assert.deepEqual(parseIndex(null), []);
  assert.deepEqual(parseIndex({ nope: 1 }), []);
});

test('domainsOf : domaines présents dans l\'ordre canonique (intent : chips stables et ordonnées)', () => {
  const out = domainsOf(parseIndex(raw));
  assert.deepEqual(out, ['time', 'finance', 'other']);   // ordre de DOMAINS, pas d'apparition
  assert.ok(DOMAINS.indexOf('time') < DOMAINS.indexOf('finance'));
});

test('filterEntries : filtre par domaine (intent : cliquer une chip restreint au domaine)', () => {
  const out = filterEntries(parseIndex(raw), { domain: 'finance' });
  assert.deepEqual(out.map(e => e.id), ['b/crypto']);
});

test('filterEntries : recherche nom/description/tags insensible à la casse (intent : trouver par mot-clé)', () => {
  const p = parseIndex(raw);
  assert.deepEqual(filterEntries(p, { query: 'HORLOGE' }).map(e => e.id), ['a/clock']);   // nom
  assert.deepEqual(filterEntries(p, { query: 'btc' }).map(e => e.id),     ['b/crypto']);  // description
  assert.deepEqual(filterEntries(p, { query: 'clock' }).map(e => e.id),   ['a/clock']);   // tag
});

test('filterEntries : sans filtre → tout (intent : état initial montre le catalogue complet)', () => {
  assert.equal(filterEntries(parseIndex(raw), {}).length, 3);
});
