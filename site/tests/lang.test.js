import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentLang, pickLanguage, siblingHref } from '../lang.js';

test('currentLang : *.fr.html = fr, sinon en', () => {
  assert.equal(currentLang('/Dialboard/index.fr.html'), 'fr');
  assert.equal(currentLang('/Dialboard/index.html'), 'en');
  assert.equal(currentLang('/Dialboard/'), 'en');               // répertoire = index EN
  assert.equal(currentLang('/Dialboard/docs/index.fr.html'), 'fr');
});

test('pickLanguage : choix mémorisé prioritaire', () => {
  assert.equal(pickLanguage('fr', 'en-US'), 'fr');
  assert.equal(pickLanguage('en', 'fr-FR'), 'en');
});

test('pickLanguage : sans mémoire, suit le navigateur (fr seulement si fr*)', () => {
  assert.equal(pickLanguage(null, 'fr-FR'), 'fr');
  assert.equal(pickLanguage(null, 'fr'), 'fr');
  assert.equal(pickLanguage(null, 'en-US'), 'en');
  assert.equal(pickLanguage(null, ''), 'en');
  assert.equal(pickLanguage(undefined, undefined), 'en');
});

test('siblingHref : dérive le fichier jumeau dans les deux sens', () => {
  assert.equal(siblingHref('/Dialboard/index.html', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/index.fr.html', 'en'), '/Dialboard/index.html');
  assert.equal(siblingHref('/Dialboard/index.fr.html', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/index.html', 'en'), '/Dialboard/index.html');
});

test('siblingHref : chemin-répertoire traité comme index.html', () => {
  assert.equal(siblingHref('/Dialboard/', 'fr'), '/Dialboard/index.fr.html');
  assert.equal(siblingHref('/Dialboard/', 'en'), '/Dialboard/index.html');
});

test('siblingHref : marche pour les docs (P2)', () => {
  assert.equal(siblingHref('/Dialboard/docs/index.html', 'fr'), '/Dialboard/docs/index.fr.html');
  assert.equal(siblingHref('/Dialboard/docs/index.fr.html', 'en'), '/Dialboard/docs/index.html');
});
