import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeAjvError, humanizePath } from '../js/humanize.js';

test('humanizePath rend le chemin lisible (1-based)', () => {
  assert.equal(humanizePath('/pages/0/place/2/dx'), 'page 1 › élément 3 › dx');
  assert.equal(humanizePath('/components/cpu'), 'composant › cpu');
  assert.equal(humanizePath(''), 'racine');
});

test('pattern couleur → message dédié', () => {
  const e = { keyword: 'pattern', instancePath: '/background', params: { pattern: '^#[0-9A-Fa-f]{6}$' }, message: 'must match pattern' };
  assert.match(humanizeAjvError(e), /couleur.*#RRGGBB/);
});

test('pattern ASCII → message dédié', () => {
  const e = { keyword: 'pattern', instancePath: '/components/titre/text', params: { pattern: '^[\\x00-\\x7F]*$' }, message: 'must match pattern' };
  assert.match(humanizeAjvError(e), /ASCII/);
});

test('additionalProperties nomme la propriété inconnue', () => {
  const e = { keyword: 'additionalProperties', instancePath: '/components/cpu', params: { additionalProperty: 'foo' }, message: 'must NOT have additional properties' };
  assert.match(humanizeAjvError(e), /propriété inconnue.*foo/);
});

test('enum liste les valeurs permises', () => {
  const e = { keyword: 'enum', instancePath: '/pages/0/place/0/anchor', params: { allowedValues: ['CENTER', 'TOP_MID'] }, message: 'must be equal to one of the allowed values' };
  const s = humanizeAjvError(e);
  assert.match(s, /non autorisée/);
  assert.match(s, /CENTER/);
});

test('required nomme la propriété manquante', () => {
  const e = { keyword: 'required', instancePath: '/components/x', params: { missingProperty: 'type' }, message: 'must have required property' };
  assert.match(humanizeAjvError(e), /obligatoire.*type/);
});

test('type traduit le type attendu', () => {
  const e = { keyword: 'type', instancePath: '/pages/0/place/0/dx', params: { type: 'integer' }, message: 'must be integer' };
  assert.match(humanizeAjvError(e), /entier/);
});

test('keyword inconnu retombe sur le message ajv brut', () => {
  const e = { keyword: 'weird', instancePath: '/x', params: {}, message: 'must be weird' };
  assert.match(humanizeAjvError(e), /must be weird/);
});
