import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterIcons, categoriesOf } from '../js/icon-filter.js';

const SET = [
  { name: 'wifi', cat: 'Network', tags: ['wireless', 'internet'] },
  { name: 'home', cat: 'Home Automation', tags: ['house'] },
  { name: 'home-assistant', cat: 'Brand', tags: ['home'] },
];

test('recherche par nom (sous-chaîne)', () => {
  assert.deepEqual(filterIcons(SET, 'home', null).map(i => i.name), ['home', 'home-assistant']);
});
test('recherche par tag', () => {
  assert.deepEqual(filterIcons(SET, 'internet', null).map(i => i.name), ['wifi']);
});
test('filtre par catégorie', () => {
  assert.deepEqual(filterIcons(SET, '', 'Network').map(i => i.name), ['wifi']);
});
test('recherche + catégorie combinées', () => {
  assert.deepEqual(filterIcons(SET, 'house', 'Home Automation').map(i => i.name), ['home']);
});
test('catégories triées uniques', () => {
  assert.deepEqual(categoriesOf(SET), ['Brand', 'Home Automation', 'Network']);
});
