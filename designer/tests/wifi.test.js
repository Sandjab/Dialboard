import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWifiList } from '../js/wifi.js';

test('formatWifiList : marque le SSID connecté (intent : voir d\'un coup d\'œil le réseau actif)', () => {
  const r = formatWifiList({ nets: ['home', 'cafe'], connected: 'cafe' });
  assert.deepEqual(r, [{ ssid: 'home', connected: false }, { ssid: 'cafe', connected: true }]);
});

test('formatWifiList : réponse malformée tolérée (intent : Array.isArray, cf. device dump)', () => {
  assert.deepEqual(formatWifiList({ nets: null }), []);
  assert.deepEqual(formatWifiList({}), []);
  assert.deepEqual(formatWifiList(null), []);
});

test('formatWifiList : aucun mot de passe ne fuit dans la sortie (intent : write-only)', () => {
  const r = formatWifiList({ nets: ['home'], connected: '', pass: 'leak' });
  assert.equal(JSON.stringify(r).includes('leak'), false);
});
