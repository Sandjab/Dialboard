import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout, getStatus, pushLayout } from '../js/device.js';
import { startMockDevice } from '../electron/mock-device.mjs';

// Intent : prouver que le contrat REST designer↔device tient bout-à-bout (vrai HTTP round-trip),
// pas seulement que device.js compile. Le mock joue le firmware.

test('transport : getStatus rend le statut du device (le contrat /status tient bout-à-bout)', async () => {
  const dev = await startMockDevice();
  try {
    const s = await getStatus(dev.url);
    assert.equal(typeof s.ip, 'string');
    assert.equal(s.pages, 1);
  } finally { await dev.close(); }
});

test('transport : loadLayout parse et rend le layout servi (le designer reçoit le layout réel)', async () => {
  const dev = await startMockDevice();
  try {
    const lay = await loadLayout(dev.url);
    assert.equal(lay.title, 'Dialboard');
    assert.ok(Array.isArray(lay.pages));
  } finally { await dev.close(); }
});

test('transport : pushLayout réussit sur un layout valide (un push accepté ne lève pas)', async () => {
  const dev = await startMockDevice();
  try {
    const res = await pushLayout(dev.url, JSON.stringify({ pages: [{ name: 'x', place: [] }] }));
    assert.equal(res.ok, true);
  } finally { await dev.close(); }
});

test('transport : pushLayout LÈVE quand le device rejette (ne jamais avaler un rejet → l\'utilisateur voit l\'échec)', async () => {
  const dev = await startMockDevice();
  try {
    await assert.rejects(() => pushLayout(dev.url, JSON.stringify({})), /pages/);
  } finally { await dev.close(); }
});
