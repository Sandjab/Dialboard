// Garde-fou « double-clic » réutilisable, partagé par Settings (« Nouveau »), la toolbar (push/pull) et le
// ✕ de l'arbre. 1er clic ARME le bouton (teinte .confirm + indice « Confirmer ? »), 2e clic dans `ms` exécute
// `action`. Pas de dialog natif — cohérent avec le ton léger du designer (toasts, pas de modale).
//
// L'indice « Confirmer ? » se loge là où c'est lisible sans déformer le bouton : le tooltip (`data-tip` des
// boutons icônes toolbar, sinon l'attribut `title`) pour un bouton ICÔNE, le `textContent` pour un bouton TEXTE.
//
// `guard()` optionnel : appelé au 1er clic ; s'il renvoie false, on n'arme PAS (préconditions non remplies —
// ex. URL device absente). À lui de signaler pourquoi (toast). Évite de faire confirmer une action infaisable.
import { t } from './i18n.js';

export function withConfirm(el, action, { label, ms = 3000, guard } = {}) {
  const confirmLabel = label ?? t('confirm.prompt');
  const slot = el.dataset.tip !== undefined ? 'tip' : (el.title ? 'title' : 'text');
  const read = () => slot === 'tip' ? el.dataset.tip : slot === 'title' ? el.title : el.textContent;
  const write = v => { if (slot === 'tip') el.dataset.tip = v; else if (slot === 'title') el.title = v; else el.textContent = v; };
  let armed = false, orig = null, timer = null;
  const disarm = () => { if (!armed) return; armed = false; el.classList.remove('confirm'); write(orig); if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('click', e => {
    if (armed) { disarm(); action(e); return; }       // 2e clic : exécute
    if (guard && !guard()) return;                     // préconditions KO → on n'arme pas
    armed = true; orig = read(); el.classList.add('confirm'); write(confirmLabel);   // 1er clic : arme
    timer = setTimeout(disarm, ms);
  });
}
