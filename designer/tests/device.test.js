import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeviceStatus } from '../js/device.js';
import { formatDeviceDump } from '../js/device.js';

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

test('formatDeviceDump : vars objet → lignes triées par nom (intent : lecture stable du blackboard)', () => {
  const r = formatDeviceDump({ vars: { vol: 5, bell: 'on' }, uptime_s: 0 });
  assert.deepEqual(r.vars, [{ name: 'bell', value: 'on' }, { name: 'vol', value: 5 }]);
});

test('formatDeviceDump : vars non-objet → tableau vide (intent : import/réponse malformé toléré, cf. Array.isArray sources/sinks)', () => {
  assert.deepEqual(formatDeviceDump({ vars: [1, 2] }).vars, []);
  assert.deepEqual(formatDeviceDump({ vars: null }).vars, []);
  assert.deepEqual(formatDeviceDump({}).vars, []);
});

test('formatDeviceDump : âge source calculé contre uptime device (intent : updated_at est un millis device, pas navigateur)', () => {
  const r = formatDeviceDump({ uptime_s: 100, sources: [{ name: 's', last_status: 200, err_count: 0, updated_at: 95000 }] });
  assert.deepEqual(r.sources, [{ name: 's', status: 200, errors: 0, age: 5 }]);   // (100000 - 95000)/1000
});

test('formatDeviceDump : âge borné à 0 si timestamp > uptime (intent : troncature uptime_s ne donne jamais un âge négatif)', () => {
  const r = formatDeviceDump({ uptime_s: 10, sinks: [{ name: 'k', last_status: 0, err_count: 1, fired_at: 12000 }] });
  assert.equal(r.sinks[0].age, 0);
});

test('formatDeviceDump : timestamp absent → âge null (intent : distinguer « jamais » de « il y a 0 s »)', () => {
  const r = formatDeviceDump({ uptime_s: 100, sources: [{ name: 's', last_status: 200, err_count: 0 }] });
  assert.equal(r.sources[0].age, null);
});

test('formatDeviceDump : sinks lit fired_at ; err_count manquant → 0 (intent : télémétrie sink)', () => {
  const r = formatDeviceDump({ uptime_s: 50, sinks: [{ name: 'k', last_status: 204, fired_at: 40000 }] });
  assert.deepEqual(r.sinks, [{ name: 'k', status: 204, errors: 0, age: 10 }]);
});

test('formatDeviceDump : sources/sinks non-tableau → vides (intent : firmware ancien / réponse partielle)', () => {
  const r = formatDeviceDump({ sources: undefined, sinks: 'x' });
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.sinks, []);
});
