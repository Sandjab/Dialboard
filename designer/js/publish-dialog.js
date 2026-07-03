// Overlay « Publier » : formulaire meta → .dboard v2 (encodeBundle avec meta) → download + soumission
// GitHub. Modelé sur #shot-overlay (open/close via .hidden). Câblage DOM, vérifié navigateur (pas de test node).
import { encodeBundle, collectAssets, missingKeys } from './bundle.js';
import { slugify, validateMeta, buildMeta, publishUrl, fitsPrefill } from './publish.js';
import { DOMAINS } from './store-index.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

const STORE_REPO_URL = 'https://github.com/Sandjab/dialboard-store';   // dépôt (≠ base CDN de la galerie)

export function mountPublishDialog(model, options) {
  const { openBtn, overlay } = options || {};   // défensif : options null/absent ne throw pas (cf. convention projet)
  if (!model || typeof model !== 'object' || !openBtn || !overlay) return;
  const $ = id => overlay.querySelector('#' + id);
  const fieldsEls = { name: $('pub-name'), author: $('pub-author'), description: $('pub-description'),
    domain: $('pub-domain'), tags: $('pub-tags'), requires: $('pub-requires') };
  const submit = $('pub-submit');

  // Peuple le <select> domaine : placeholder vide (force un choix) + un <option> par domaine (labels store.domain.*).
  const ph = document.createElement('option');
  ph.value = ''; ph.disabled = true; ph.selected = true; ph.textContent = t('publish.domain_placeholder');
  fieldsEls.domain.appendChild(ph);
  for (const d of DOMAINS) {
    const o = document.createElement('option');
    o.value = d; o.textContent = t(`store.domain.${d}`);
    fieldsEls.domain.appendChild(o);
  }

  const read = () => Object.fromEntries(Object.entries(fieldsEls).map(([k, el]) => [k, el.value]));
  const refresh = () => { submit.disabled = !validateMeta(read()).valid; };
  for (const el of Object.values(fieldsEls)) el.addEventListener('input', refresh);
  refresh();

  const open = () => { overlay.hidden = false; };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('pub-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });   // clic sur le fond ferme

  submit.addEventListener('click', () => {
    const fields = read();
    if (!validateMeta(fields).valid) return;                 // garde-fou (le bouton devrait être désactivé)
    const meta = buildMeta(fields);
    const assets = collectAssets(model);
    const miss = missingKeys(model.state, assets);
    const n = miss.bg.length + miss.image.length + miss.aimg.length;
    if (n) showToast(t('publish.missing_assets', { n }), { kind: 'warn' });   // fail-loud, non bloquant

    const slug = slugify(meta.name);
    const dboardText = encodeBundle(model.toJSON(), assets, meta);            // v2
    downloadDboard(slug, dboardText);                                         // l'auteur a toujours le fichier

    if (fitsPrefill(dboardText)) {
      window.open(publishUrl(STORE_REPO_URL, meta.author, slug, dboardText), '_blank', 'noopener');
      showToast(t('publish.opened_github'), { kind: 'ok', ms: 5000 });
    } else {
      window.open(`${STORE_REPO_URL}/blob/main/CONTRIBUTING.md`, '_blank', 'noopener');
      showToast(t('publish.download_only'), { kind: 'warn', ms: 6000 });
    }
    close();
  });
}

// Download blob (miroir de bundle-io.js : révocation différée, payload base64 potentiellement gros).
function downloadDboard(slug, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${slug}.dboard`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
