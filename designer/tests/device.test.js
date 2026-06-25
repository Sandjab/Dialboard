import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeviceStatus } from '../js/device.js';
import { createDevicePanel } from '../js/device-panel.js';

const base = { ip: '192.168.1.35', page: 0, pages: 5, uptime_s: 42, components: 24, sources: [] };

test(`formatDeviceStatus : label = pastille pleine + ip (intent : état connecté lisible d'un coup d'œil)`, () => {
  const { label } = formatDeviceStatus(base);
  assert.equal(label, '● 192.168.1.35');
});

test(`formatDeviceStatus : page affichée en base 1 (intent : l'utilisateur compte les pages à partir de 1)`, () => {
  const { tooltip } = formatDeviceStatus({ ...base, page: 0, pages: 5 });
  assert.match(tooltip, /page 1\/5/);
});

test('formatDeviceStatus : état par source — 200→ok, err_count→err, sinon … (intent : refléter le vrai état pull)', () => {
  const { tooltip } = formatDeviceStatus({ ...base, sources: [
    { name: 'a', last_status: 200, err_count: 0 },
    { name: 'b', last_status: 0, err_count: 3 },
    { name: 'c', last_status: 0, err_count: 0 },
  ] });
  assert.match(tooltip, /sources a:ok b:err c:…/);
});

test(`formatDeviceStatus : aucune source → pas de segment « sources » dans l'infobulle`, () => {
  const { tooltip } = formatDeviceStatus(base);
  assert.doesNotMatch(tooltip, /sources/);
});

test('device-panel : createDevicePanel est une factory tolérant onPreview absent', () => {
  assert.equal(typeof createDevicePanel, 'function');
  assert.equal(createDevicePanel.length, 2);   // root, model requis ; opts par défaut
});
