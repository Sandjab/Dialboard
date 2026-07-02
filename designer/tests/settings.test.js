import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings } from '../js/settings.js';

test('defaultSettings: valeurs de référence', () => {
  assert.deepEqual(defaultSettings(), {
    lang: 'en',
    theme: 'amber',
    ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 10,
    logActivity: true, logJs: false, logNet: false, deviceContext: false, deviceWifi: false,
  });
});

test('settings: thème valide conservé', () => {
  for (const t of ['amber', 'green', 'blue', 'violet', 'red', 'yellow']) {
    assert.equal(normalizeSettings({ theme: t }).theme, t);
  }
});

test('settings: thème inconnu → ambre (intent : pas d’accent indéfini)', () => {
  assert.equal(normalizeSettings({ theme: 'turquoise' }).theme, 'amber');
  assert.equal(normalizeSettings({ theme: 42 }).theme, 'amber');
  assert.equal(normalizeSettings({}).theme, 'amber');
});

test('settings: défauts des journaux — activité ON, JS/réseau OFF (intent : activité visible d’emblée, debug optionnel)', () => {
  const d = defaultSettings();
  assert.equal(d.logActivity, true);
  assert.equal(d.logJs, false);
  assert.equal(d.logNet, false);
});

test('settings: réglage de journal absent → défaut (intent : compat des anciens settings persistés)', () => {
  const n = normalizeSettings({ ghostOpacity: 0.5 });   // ancien blob sans clés de journaux
  assert.equal(n.logActivity, true);
  assert.equal(n.logJs, false);
  assert.equal(n.logNet, false);
});

test('settings: valeur non booléenne ignorée au profit du défaut (intent : pas de case dans un état tiers)', () => {
  const n = normalizeSettings({ logActivity: 'oui', logJs: 1, logNet: null });
  assert.equal(n.logActivity, true);    // 'oui' rejeté → défaut true
  assert.equal(n.logJs, false);         // 1 rejeté → défaut false
  assert.equal(n.logNet, false);        // null rejeté → défaut false
});

test('settings: booléens de journaux valides passés tels quels', () => {
  const n = normalizeSettings({ logActivity: false, logJs: true, logNet: true });
  assert.equal(n.logActivity, false);
  assert.equal(n.logJs, true);
  assert.equal(n.logNet, true);
});

test('normalizeSettings: entrée vide/nulle → défauts', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings('garbage'), defaultSettings());
});

test('normalizeSettings: clamp opacité hors bornes', () => {
  assert.equal(normalizeSettings({ ghostOpacity: 2 }).ghostOpacity, 1);
  assert.equal(normalizeSettings({ ghostOpacity: -1 }).ghostOpacity, 0);
  assert.equal(normalizeSettings({ ghostOpacity: 'x' }).ghostOpacity, 0.38);
});

test('normalizeSettings: gridStep contraint à {5,10,20}', () => {
  assert.equal(normalizeSettings({ gridStep: 5 }).gridStep, 5);    // valide
  assert.equal(normalizeSettings({ gridStep: 20 }).gridStep, 20);  // valide
  assert.equal(normalizeSettings({ gridStep: 8 }).gridStep, 10);   // 8 n'est plus valide → défaut
});

test('normalizeSettings: champ partiel mergé sur les défauts', () => {
  const r = normalizeSettings({ gridShow: true });
  assert.equal(r.gridShow, true);
  assert.equal(r.gridSnap, false);
  assert.equal(r.gridStep, 10);
});

test('settings: deviceContext défaut OFF (intent : onglet debug caché tant qu\'on n\'en a pas besoin)', () => {
  assert.equal(defaultSettings().deviceContext, false);
  assert.equal(normalizeSettings({}).deviceContext, false);
});

test('settings: deviceContext booléen respecté ; non-booléen → défaut (intent : pas d\'état tiers)', () => {
  assert.equal(normalizeSettings({ deviceContext: true }).deviceContext, true);
  assert.equal(normalizeSettings({ deviceContext: 'x' }).deviceContext, false);
});
