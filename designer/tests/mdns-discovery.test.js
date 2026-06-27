import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeviceUrl, isDialboardService, parseService } from '../electron/discovery.mjs';

test('toDeviceUrl : omet :80, conserve les autres ports (intent : URL device propre)', () => {
  assert.equal(toDeviceUrl('192.168.1.5', 80), 'http://192.168.1.5');
  assert.equal(toDeviceUrl('192.168.1.5', 8099), 'http://192.168.1.5:8099');
  assert.equal(toDeviceUrl('192.168.1.5', undefined), 'http://192.168.1.5');   // port falsy → omis
});

test('isDialboardService : matche un device dialboard, rejette le bruit _http._tcp (intent : ne pas pointer une imprimante)', () => {
  assert.equal(isDialboardService({ name: 'dialboard', host: 'dialboard.local' }), true);
  assert.equal(isDialboardService({ name: 'dialboard-2', host: 'dialboard-2.local' }), true);
  assert.equal(isDialboardService({ name: 'HP LaserJet', host: 'printer.local' }), false);
  assert.equal(isDialboardService({}), false);                 // ni name ni host
  assert.equal(isDialboardService(null), false);               // svc absent
  assert.equal(isDialboardService({ name: 'Dialboard' }), true); // insensible casse, host absent
});

test('parseService : extrait la 1re IPv4 + url ; null si aucune IPv4 (intent : on a besoin d\'une IP joignable)', () => {
  assert.deepEqual(
    parseService({ name: 'dialboard', port: 80, addresses: ['fe80::1', '192.168.1.5'] }),
    { name: 'dialboard', ip: '192.168.1.5', port: 80, url: 'http://192.168.1.5' }
  );
  assert.equal(parseService({ name: 'dialboard', port: 80, addresses: ['fe80::1'] }), null);
});
