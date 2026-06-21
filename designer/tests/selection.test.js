import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSelection } from '../js/selection.js';

test('sameSelection : deux null sont égaux', () => {
  assert.equal(sameSelection(null, null), true);
});

test('sameSelection : null vs objet → différent', () => {
  assert.equal(sameSelection(null, { kind: 'doc' }), false);
  assert.equal(sameSelection({ kind: 'doc' }, null), false);
});

test('sameSelection : deux doc → égaux', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'doc' }), true);
});

test('sameSelection : kinds différents → différents', () => {
  assert.equal(sameSelection({ kind: 'doc' }, { kind: 'page', page: 0 }), false);
});

test('sameSelection : pages par index', () => {
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 1 }), true);
  assert.equal(sameSelection({ kind: 'page', page: 1 }, { kind: 'page', page: 2 }), false);
});

test('sameSelection : composants par page + index', () => {
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 2 }), true);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 0, index: 3 }), false);
  assert.equal(sameSelection({ kind: 'comp', page: 0, index: 2 }, { kind: 'comp', page: 1, index: 2 }), false);
});
