import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings } from '../js/settings.js';

test('defaultSettings: valeurs de référence', () => {
  assert.deepEqual(defaultSettings(), { ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 10 });
});

test('normalizeSettings: entrée vide/nulle → défauts', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings('garbage'), defaultSettings());
});

test('normalizeSettings: clamp opacité hors bornes', () => {
  assert.equal(normalizeSettings({ ghostOpacity: 2 }).ghostOpacity, 1);
  assert.equal(normalizeSettings({ ghostOpacity: -1 }).ghostOpacity, 0);
  assert.equal(normalizeSettings({ ghostOpacity: 'x' }).ghostOpacity, 0.38);
});

test('normalizeSettings: gridStep contraint à {5,10,20}', () => {
  assert.equal(normalizeSettings({ gridStep: 5 }).gridStep, 5);    // valide
  assert.equal(normalizeSettings({ gridStep: 20 }).gridStep, 20);  // valide
  assert.equal(normalizeSettings({ gridStep: 8 }).gridStep, 10);   // 8 n'est plus valide → défaut
});

test('normalizeSettings: champ partiel mergé sur les défauts', () => {
  const r = normalizeSettings({ gridShow: true });
  assert.equal(r.gridShow, true);
  assert.equal(r.gridSnap, false);
  assert.equal(r.gridStep, 10);
});
