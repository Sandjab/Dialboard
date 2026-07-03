import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, validateMeta, buildMeta, publishUrl, fitsPrefill, PREFILL_MAX } from '../js/publish.js';

test('slugify : minuscule, accents retirés, espaces→tirets, borné (intent : nom de fichier sûr)', () => {
  assert.equal(slugify('  Ma Météo à Paris !  '), 'ma-meteo-a-paris');
  assert.equal(slugify(''), 'dashboard');                 // vide → défaut
  assert.equal(slugify('----'), 'dashboard');             // que du séparateur → défaut
  assert.ok(slugify('x'.repeat(80)).length <= 40);        // borné
});

test('validateMeta : requis name/author/description/domain (intent : la CI store les exige)', () => {
  assert.equal(validateMeta({ name: 'a', author: 'b', description: 'c', domain: 'time' }).valid, true);
  assert.deepEqual(validateMeta({ name: '', author: 'b', description: 'c', domain: 'time' }).missing, ['name']);
  assert.ok(validateMeta({ name: 'a', author: 'b', description: 'c', domain: 'zzz' }).missing.includes('domain')); // hors enum
  assert.equal(validateMeta({}).valid, false);
});

test('buildMeta : tags CSV→array nettoyé, champs trimés (intent : meta propre)', () => {
  const m = buildMeta({ name: ' N ', author: ' me ', description: ' d ', domain: 'time', tags: 'a, b ,,c', requires: ' r ' });
  assert.deepEqual(m, { name: 'N', author: 'me', description: 'd', domain: 'time', tags: ['a', 'b', 'c'], requires: 'r' });
});

test('publishUrl : éditeur new-file GitHub pré-rempli chemin+contenu (intent : soumission quasi 1-clic)', () => {
  const u = publishUrl('https://github.com/Sandjab/dialboard-store', 'Me', 'my-clock', '{"version":2}');
  assert.ok(u.startsWith('https://github.com/Sandjab/dialboard-store/new/main?'));
  assert.ok(u.includes('filename=' + encodeURIComponent('entries/me/my-clock.dboard')));
  assert.ok(u.includes('value=' + encodeURIComponent('{"version":2}')));
});

test('fitsPrefill : petit → true, gros → false (intent : basculer prefill/repli selon la longueur d\'URL)', () => {
  assert.equal(fitsPrefill('{"a":1}'), true);
  assert.equal(fitsPrefill('x'.repeat(PREFILL_MAX + 1)), false);
});
