// Cœur pur du store de journaux (createLogStore) : isolation par journal, anneau borné, notifications,
// clear ciblé, copie défensive. La capture de console.* (effet de bord) n'est pas testée ici (cf. convention).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogStore } from '../js/logs.js';

const fixedNow = () => new Date(0);

test('logs : chaque journal est isolé — une ligne d’activité ne fuit pas dans js/net (intent : 3 onglets distincts)', () => {
  const s = createLogStore({ now: fixedNow });
  s.logActivity('a');
  s.logJs('warn', 'w');
  s.logNet({ method: 'GET', path: '/status', status: 200, ms: 10, ok: true });
  assert.equal(s.get('activity').length, 1);
  assert.equal(s.get('js').length, 1);
  assert.equal(s.get('net').length, 1);
  assert.equal(s.get('activity')[0].message, 'a');
});

test('logs : anneau borné — au-delà de max, la plus ancienne sort (intent : pas de fuite mémoire en session longue)', () => {
  const s = createLogStore({ max: 3, now: fixedNow });
  for (let i = 0; i < 5; i++) s.logActivity('m' + i);
  const rows = s.get('activity');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.message), ['m2', 'm3', 'm4']);   // m0/m1 évincées
});

test('logs : net normalise ok en booléen et conserve les champs (intent : coloration ok/err fiable)', () => {
  const s = createLogStore({ now: fixedNow });
  s.logNet({ method: 'POST', path: '/update', status: 500, ms: 7, ok: 0 });
  const e = s.get('net')[0];
  assert.equal(e.ok, false);          // 0 → false, pas 0 (sinon la classe CSS serait fausse)
  assert.equal(e.status, 500);
  assert.equal(e.method, 'POST');
});

test('logs : subscribe notifié à chaque ajout ET au clear ; clear ne vide que le journal ciblé', () => {
  const s = createLogStore({ now: fixedNow });
  let n = 0; s.subscribe(() => n++);
  s.logActivity('a');      // +1
  s.logJs('log', 'b');     // +1
  assert.equal(n, 2);
  s.clear('activity');     // +1, vide activity seulement
  assert.equal(n, 3);
  assert.equal(s.get('activity').length, 0);
  assert.equal(s.get('js').length, 1);
});

test('logs : get renvoie une copie — muter le retour n’altère pas l’anneau (intent : le rendu console ne corrompt pas l’état)', () => {
  const s = createLogStore({ now: fixedNow });
  s.logActivity('a');
  s.get('activity').push({ message: 'pirate' });
  assert.equal(s.get('activity').length, 1);
});
