// Gallery de modèles montée dans le tiroir « Modèles ». Fetch le manifeste templates/index.json,
// rend une carte par modèle (miniature live + nom/description/badge i18n). Cliquer une carte :
// si le canvas a déjà été travaillé (model.canUndo()) → arm-confirm (1er clic « Remplacer ? », 2e
// exécute, disarm après 3 s) ; sinon charge direct. Charge = fetch du fichier → onPick(text, entry).
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
import { buildThumbnail } from './template-preview.js';
import { t } from './i18n.js';

const WIRED = new Set(['weather', 'crypto', 'server', 'home-assistant']);  // badge « à brancher »

export async function mountTemplatesGallery(host, model, { onPick } = {}) {
  let manifest;
  try {
    const res = await fetch('templates/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    console.warn('[templates] manifeste indisponible', e);
    host.textContent = t('templates.badge.wire');   // dégradé silencieux : gallery vide plutôt que crash
    return;
  }

  for (const entry of (Array.isArray(manifest) ? manifest : [])) {
    let layout;
    try {
      const r = await fetch(`templates/${entry.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      layout = await r.json();
    } catch (e) { console.warn(`[templates] ${entry.file} illisible`, e); continue; }

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-card';
    card.appendChild(buildThumbnail(layout));

    const meta = document.createElement('div');
    meta.className = 'tpl-meta';
    const h = document.createElement('div'); h.className = 'tpl-name'; h.textContent = t(`templates.${entry.id}.name`);
    const p = document.createElement('div'); p.className = 'tpl-desc'; p.textContent = t(`templates.${entry.id}.description`);
    const b = document.createElement('span'); b.className = 'tpl-badge ' + (WIRED.has(entry.id) ? 'wire' : 'ready');
    b.textContent = WIRED.has(entry.id) ? t('templates.badge.wire') : t('templates.badge.ready');
    meta.append(h, p, b);
    card.appendChild(meta);

    wireCard(card, model, entry, layout, onPick);
    host.appendChild(card);
  }
}

// Arm-confirm sur canvas travaillé (ethos designer : pas de modale). Session vierge → 1 clic.
function wireCard(card, model, entry, layout, onPick) {
  let armed = false, timer = null;
  const badge = card.querySelector('.tpl-badge');
  const disarm = () => { armed = false; card.classList.remove('confirm'); if (timer) clearTimeout(timer); timer = null; };
  const load = () => onPick && onPick(JSON.stringify(layout), entry);
  card.addEventListener('click', () => {
    if (!model.canUndo()) return load();                 // rien à protéger → charge direct
    if (armed) { disarm(); return load(); }              // 2e clic → charge
    armed = true; card.classList.add('confirm');         // 1er clic → arme
    badge.textContent = t('templates.replace');
    timer = setTimeout(() => { disarm(); badge.textContent = WIRED.has(entry.id) ? t('templates.badge.wire') : t('templates.badge.ready'); }, 3000);
  });
}
