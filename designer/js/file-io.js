// Export / import du layout.json en fichier local — filet indépendant du device (pas de CORS).
// Export : sérialise le modèle → téléchargement. Import : lit un fichier → charge dans le modèle ;
// la validité de forme est signalée par le panneau JSON. onLoad permet de réinitialiser la vue
// (page active, sélection) après un import. Vérifié au navigateur.
import { showToast } from './toast.js';
import { logs } from './logs.js';
import { t } from './i18n.js';

export function bindFileIO(model, { exportBtn, importBtn, importInput, onLoad } = {}) {
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([model.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.json';
    a.click();
    URL.revokeObjectURL(url);
    logs.logActivity(t('activity.layout_exported'));
  });

  importBtn.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      model.loadJSON(text);            // throw si JSON illisible ; la forme est validée par le panneau
      onLoad && onLoad();
      logs.logActivity(t('activity.layout_imported'));
    } catch (e) {
      showToast(t('toast.import_failed', { msg: e.message }), { kind: 'err' });
    } finally {
      importInput.value = '';          // réautorise la réimportation du même fichier
    }
  });
}
