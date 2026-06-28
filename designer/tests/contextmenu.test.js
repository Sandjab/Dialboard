import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextMenuItems } from '../js/contextmenu.js';

test('contextMenuItems : physique → un seul item « Renommer » (intent : permanent, ni suppr/déplacement/z-order)', () => {
  const items = contextMenuItems({ kind: 'physical', ref: 'led' }, { pages: [], components: { led: { type: 'led_ring' } } });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'rename');
});

test('contextMenuItems : doc/null → menu vide (régression existante)', () => {
  assert.deepEqual(contextMenuItems({ kind: 'doc' }, {}), []);
  assert.deepEqual(contextMenuItems(null, {}), []);
});
