// Chaque template livré DOIT valider (schéma + limites firmware) : un template cassé = mauvaise
// première impression et rejet possible au push device → bloqué en CI, jamais découvert par l'user.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator } from '../js/validate.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/layout.schema.json', import.meta.url)));
const validate = createValidator(schema);
const readTpl = (p) => JSON.parse(readFileSync(new URL(`../templates/${p}`, import.meta.url)));
const manifest = readTpl('index.json');

test('manifeste : liste non vide d\'entrées {id, file}', () => {
  assert.ok(Array.isArray(manifest) && manifest.length >= 1);
  for (const e of manifest) {
    assert.match(e.id, /^[a-z0-9-]+$/);
    assert.ok(typeof e.file === 'string' && e.file.endsWith('.json'));
  }
});

for (const entry of manifest) {
  test(`template « ${entry.id} » : layout valide (schéma + limites firmware)`, () => {
    const r = validate(readTpl(entry.file));
    assert.deepEqual(r.errors, [], `erreurs: ${r.errors.join(' | ')}`);
    assert.equal(r.valid, true);
  });
}
