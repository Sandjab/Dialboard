import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import EN from '../i18n/en.js';
import { missingKeys } from '../js/i18n.js';

// Parité stricte EN=FR : le projet maintient les deux catalogues à clés identiques
// (le pack FR retombe silencieusement sur EN si une clé manque — ce test rend l'écart visible).
const FR = JSON.parse(readFileSync(new URL('../i18n/fr.json', import.meta.url)));

test('i18n : aucune clé EN absente de FR', () => {
  assert.deepEqual(missingKeys(EN, FR), []);
});

test('i18n : aucune clé FR absente de EN', () => {
  assert.deepEqual(missingKeys(FR, EN), []);
});
