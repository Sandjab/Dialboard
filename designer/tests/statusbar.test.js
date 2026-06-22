import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValidationSummary } from '../js/statusbar.js';

test("formatValidationSummary : 0 erreur 0 avert → ✓ valide, niveau ok (intent : feu vert, push possible)", () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: [] });
  assert.equal(r.text, '✓ valide');
  assert.equal(r.level, 'ok');
});

test("formatValidationSummary : erreurs → ✗ N erreurs au pluriel, niveau err (intent : push bloqué, compte visible)", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a', 'b'], warnings: [] });
  assert.equal(r.text, '✗ 2 erreurs');
  assert.equal(r.level, 'err');
});

test("formatValidationSummary : une seule erreur → singulier « erreur »", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: [] });
  assert.equal(r.text, '✗ 1 erreur');
});

test("formatValidationSummary : 0 erreur + warnings → reste « ✓ valide » + compte avert, niveau warn (intent : un warning ne bloque PAS le push, sémantique validate.js)", () => {
  const r = formatValidationSummary({ valid: true, errors: [], warnings: ['x', 'y'] });
  assert.equal(r.text, '✓ valide · 2 avert.');
  assert.equal(r.level, 'warn');
});

test("formatValidationSummary : erreurs ET warnings → l'erreur prime (intent : ne pas noyer le bloquant sous l'avertissement)", () => {
  const r = formatValidationSummary({ valid: false, errors: ['a'], warnings: ['x'] });
  assert.equal(r.level, 'err');
});
