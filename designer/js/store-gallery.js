// Galerie Store montée dans le tiroir. Fetch index.json distant (parseIndex), rend chips de domaine +
// recherche + cartes (miniature live, install arm-confirm, download blob). Échec réseau → mountFallback()
// (les 5 templates embarqués via templates.js). Câblage DOM, vérifié navigateur (pas de test node).
import { buildThumbnail } from './template-preview.js';
import { parseIndex, filterEntries, domainsOf } from './store-index.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

// Base du catalogue. Figée sur le CDN réel en Plan 2 (le repo store n'existe pas encore) ; la QA Plan 1
// l'override via ?store=<base> pour pointer une fixture locale.
const DEFAULT_STORE_BASE = 'https://cdn.jsdelivr.net/gh/Sandjab/dialboard-store@main';

export function storeBase() {
  const q = new URLSearchParams(location.search).get('store');
  return (q || DEFAULT_STORE_BASE).replace(/\/+$/, '');
}

// host = #templates-gallery (grille de cartes) ; toolbar = #store-toolbar (recherche + chips).
export async function mountStore(host, model, { onInstall, mountFallback, toolbar } = {}) {
  let entries;
  try {
    const res = await fetch(`${storeBase()}/index.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = parseIndex(await res.json());
  } catch (e) {
    console.warn('[store] index distant indisponible → fallback built-ins', e);
    if (toolbar) toolbar.hidden = true;               // pas de filtre/recherche hors-ligne
    mountFallback && mountFallback();                 // les 5 templates embarqués (templates.js)
    return;
  }

  const search = toolbar && toolbar.querySelector('#store-search');
  const chips = toolbar && toolbar.querySelector('#store-domains');
  let domain = null;

  const rerender = () => renderCards(host, model, filterEntries(entries, { domain, query: search ? search.value : '' }), onInstall);

  if (chips) {
    chips.textContent = '';
    const mkChip = (d, label) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'store-chip'; b.textContent = label;
      b.addEventListener('click', () => {
        domain = d;
        for (const c of chips.children) c.classList.toggle('on', c === b);
        rerender();
      });
      return b;
    };
    chips.appendChild(mkChip(null, t('store.filter.all')));
    for (const d of domainsOf(entries)) chips.appendChild(mkChip(d, t(`store.domain.${d}`)));
    chips.firstChild.classList.add('on');             // « Tous » actif au départ
  }
  if (search) search.addEventListener('input', rerender);
  rerender();
}

function renderCards(host, model, list, onInstall) {
  host.textContent = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'store-empty'; empty.textContent = t('store.none');
    host.appendChild(empty);
    return;
  }
  for (const entry of list) {
    const card = document.createElement('div');
    card.className = 'tpl-card store-card';
    card.appendChild(buildThumbnail(entry.layout));   // assets absents ⇒ emplacements image en placeholder

    const meta = document.createElement('div');
    meta.className = 'tpl-meta';
    const h = document.createElement('div'); h.className = 'tpl-name'; h.textContent = entry.name;
    const by = document.createElement('div'); by.className = 'tpl-author'; by.textContent = entry.author ? t('store.by', { author: entry.author }) : '';
    const p = document.createElement('div'); p.className = 'tpl-desc'; p.textContent = entry.description;
    const badge = document.createElement('span'); badge.className = 'tpl-badge'; badge.textContent = t(`store.domain.${entry.domain}`);
    meta.append(h, by, p, badge);
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'tpl-actions';
    const install = document.createElement('button');
    install.type = 'button'; install.className = 'store-install'; install.textContent = t('store.install');
    wireInstall(install, model, entry, onInstall);
    const dl = document.createElement('button');
    dl.type = 'button'; dl.className = 'store-dl'; dl.textContent = t('store.download');
    dl.addEventListener('click', () => downloadEntry(entry));
    actions.append(install, dl);
    card.appendChild(actions);

    host.appendChild(card);
  }
}

// Install : arm-confirm si le canvas a été travaillé (repris de templates.js — pas de modale, 2 clics,
// disarm 3 s), puis fetch le .dboard COMPLET (avec assets) et délègue à onInstall(text, entry).
function wireInstall(btn, model, entry, onInstall) {
  let armed = false, timer = null;
  const disarm = () => { armed = false; btn.classList.remove('confirm'); btn.textContent = t('store.install'); if (timer) clearTimeout(timer); timer = null; };
  const go = async () => {
    btn.disabled = true; btn.textContent = t('store.installing');
    try {
      const res = await fetch(`${storeBase()}/${entry.file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onInstall && onInstall(await res.text(), entry);
    } catch (e) {
      console.warn('[store] install KO', e);
      showToast(t('store.download_failed', { msg: e.message }), { kind: 'err' });
    } finally {
      btn.disabled = false; disarm();
    }
  };
  btn.addEventListener('click', () => {
    if (!model.canUndo()) return go();                // rien à protéger → install direct
    if (armed) { disarm(); return go(); }             // 2e clic → install
    armed = true; btn.classList.add('confirm'); btn.textContent = t('store.replace'); timer = setTimeout(disarm, 3000);
  });
}

// Download : fetch → blob → objectURL. Marche même cross-origin (le CDN fournit le CORS), contrairement
// à un simple <a download> cross-origin. Révocation différée (cf. PR #31 : payload base64 volumineux).
async function downloadEntry(entry) {
  try {
    const res = await fetch(`${storeBase()}/${entry.file}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = (entry.id.split('/').pop() || 'dashboard') + '.dboard';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (e) {
    showToast(t('store.download_failed', { msg: e.message }), { kind: 'err' });
  }
}
