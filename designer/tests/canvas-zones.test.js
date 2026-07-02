import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY } from '../js/canvas-zones.js';
import { COMPONENTS } from '../js/registry.js';

// Chaque type non physique doit être classé dans une famille de palette : sinon il retombe
// silencieusement dans « shapes » (c'est le bug « Roller dans Primitives » qu'on corrige ici).
// Fail-loud à l'ajout d'un type non classé.
test('FAMILY classe tout composant non physique de la palette', () => {
  const groups = new Set(['data', 'rich', 'effectors', 'shapes']);
  for (const [type, def] of Object.entries(COMPONENTS)) {
    if (def.physical) continue;
    assert.ok(FAMILY[type], `type « ${type} » sans famille dans canvas-zones.FAMILY`);
    assert.ok(groups.has(FAMILY[type]), `famille inconnue « ${FAMILY[type]} » pour « ${type} »`);
  }
});

// Intent : les effecteurs (saisie tactile) forment un seul groupe « effectors » — dont roller, qui
// débordait dans « Primitives ». Ce test casse si un effecteur repart dans une autre famille.
test('FAMILY : les effecteurs sont groupés (dont roller)', () => {
  for (const type of ['switch', 'button', 'slider', 'arc', 'roller'])
    assert.equal(FAMILY[type], 'effectors', `${type} devrait être classé effecteur`);
});
