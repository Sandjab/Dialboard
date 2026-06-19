import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMock, setMock } from '../js/mocks.js';

test('getMock initialise depuis les défauts du type', () => {
  assert.equal(getMock('cpu', 'readout').value, 42);
  assert.equal(getMock('jauge', 'ring').value, 72);
  assert.equal(getMock('jauge', 'ring').reset_in_s, 18000);
});

test('getMock renvoie un objet propre au type sans défaut', () => {
  assert.deepEqual(getMock('titre', 'label'), {});
});

test('setMock fusionne et persiste par id', () => {
  setMock('cpuEdit', { value: 88 });            // id dédié : pas de couplage d'ordre avec les autres tests
  assert.equal(getMock('cpuEdit', 'readout').value, 88);
});

test('les ids sont indépendants', () => {
  setMock('a', { value: 1 });
  setMock('b', { value: 2 });
  assert.equal(getMock('a', 'bar').value, 1);
  assert.equal(getMock('b', 'bar').value, 2);
});
