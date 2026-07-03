// Export / import du bundle .dboard (layout + images) en fichier local — pendant WEB du workflow
// Electron (window.desktop.*). Miroir de file-io.js, mais : (1) extension .dboard, (2) collecte les
// assets et AVERTIT sur les octets manquants du cache avant l'export (bundle partiel signalé, jamais
// bloqué). Réutilise encodeBundle/collectAssets/loadBundle/missingKeys de bundle.js. Vérifié au navigateur.
import { encodeBundle, collectAssets, loadBundle, missingKeys } from './bundle.js';
import { showToast } from './toast.js';
import { logs } from './logs.js';
import { t } from './i18n.js';

export function bindBundleIO(model, { exportBtn, importBtn, importInput, onLoad } = {}) {
  exportBtn.addEventListener('click', () => {
    const assets = collectAssets(model);
    const miss = missingKeys(model.state, assets);
    const n = miss.bg.length + miss.image.length + miss.aimg.length;
    if (n) showToast(t('toast.bundle_missing_assets', { n }), { kind: 'warn' });   // fail-loud, non bloquant
    const blob = new Blob([encodeBundle(model.toJSON(), assets)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.dboard';
    a.click();
    URL.revokeObjectURL(url);
    logs.logActivity(t('activity.bundle_exported'));
  });

  importBtn.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      loadBundle(model, text);            // throw si bundle invalide (bundle.invalid)
      onLoad && onLoad();
      logs.logActivity(t('activity.bundle_imported'));
    } catch (e) {
      showToast(t('toast.import_failed', { msg: e.message }), { kind: 'err' });
    } finally {
      importInput.value = '';             // réautorise la réimportation du même fichier
    }
  });
}
