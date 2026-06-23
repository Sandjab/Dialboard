import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddPage, arrowState, MAX_PAGES } from '../js/carousel.js';

test('MAX_PAGES = 8 (miroir config.h)', () => {
  assert.equal(MAX_PAGES, 8);
});

test('canAddPage : vrai sous la limite, faux à la limite', () => {
  assert.equal(canAddPage({ pages: [] }), true);
  assert.equal(canAddPage({ pages: Array(7).fill({}) }), true);
  assert.equal(canAddPage({ pages: Array(8).fill({}) }), false);
  assert.equal(canAddPage({ pages: Array(9).fill({}) }), false);
  assert.equal(canAddPage({}), true);            // pas de pages → 0 < 8
});

test('arrowState : flèches grisées selon le débordement', () => {
  assert.deepEqual(arrowState({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }),
    { left: false, right: false });
  assert.deepEqual(arrowState({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 }),
    { left: false, right: true });
  assert.deepEqual(arrowState({ scrollLeft: 100, scrollWidth: 800, clientWidth: 300 }),
    { left: true, right: true });
  assert.deepEqual(arrowState({ scrollLeft: 500, scrollWidth: 800, clientWidth: 300 }),
    { left: true, right: false });
});
