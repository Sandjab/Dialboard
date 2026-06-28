// Moteur i18n du designer. Helpers PURS (testés node) + état singleton (t/initI18n/applyStaticI18n/
// availableLanguages, câblage vérifié navigateur, cf. convention projet). EN intégré (import statique =
// fallback garanti) ; les autres langues sont des packs .json fetchés via le manifeste i18n/index.json.
// Changement de langue ⇒ location.reload() (le moteur se réinitialise au boot suivant).
import EN from '../i18n/en.js';

// --- Helpers purs ---
export function lookup(current, en, key) {
  // Cascade : langue active → EN → clé brute. `??` (pas `||`) : une clé ABSENTE (undefined) retombe
  // sur le fallback, mais une valeur vide EXPLICITE ('' — ex. une unité par défaut vide) est respectée
  // et NON remplacée. Le filet `?? key` garantit qu'une clé jamais définie n'affiche pas du vide.
  return current[key] ?? en[key] ?? key;
}
export function interpolate(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
}
export function isLatin1(s) {
  // Plafond d'affichage = Latin-1 (= ce que les fontes du device rendent, cf. WS-2).
  return /^[\x20-\x7E\xA0-\xFF]*$/.test(s);
}
export function latin1Violations(pack) {
  // Seul le contenu injecté dans le layout (namespace default.*) est contraint ; le chrome est libre.
  return Object.keys(pack).filter(k => k.startsWith('default.') && !isLatin1(pack[k]));
}
export function missingKeys(en, pack) {
  return Object.keys(en).filter(k => !(k in pack));
}

// --- État singleton + API câblage ---
let current = EN;          // catalogue de la langue active (EN, ou un pack fetché)
let activeLang = 'en';

export function currentLang() { return activeLang; }

export function t(key, params) {
  const raw = lookup(current, EN, key);
  return params ? interpolate(raw, params) : raw;
}

// Charge la langue demandée. 'en' (ou absent) ⇒ catalogue intégré. Sinon fetch i18n/<lang>.json :
// les clés default.* non-Latin-1 sont écartées (retombent sur EN) ; échec de fetch ⇒ fallback EN.
export async function initI18n(lang) {
  if (!lang || lang === 'en') { current = EN; activeLang = 'en'; return; }
  try {
    const res = await fetch(`i18n/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pack = await res.json();
    if (typeof pack !== 'object' || Array.isArray(pack) || pack === null) throw new Error('pack non-objet');
    for (const k of latin1Violations(pack)) {
      console.warn(`[i18n] clé ${k} non-Latin-1 ignorée (fallback EN) — pack ${lang}`);
      delete pack[k];
    }
    current = pack; activeLang = lang;
  } catch (e) {
    console.warn(`[i18n] pack « ${lang} » indisponible, fallback EN`, e);
    current = EN; activeLang = 'en';
  }
}

// Applique les traductions au HTML statique marqué. data-i18n → textContent ; -title → title ;
// -placeholder → placeholder ; -tip → data-tip (l'attribut maison de tooltip) ; -alt → alt ;
// -aria-label → aria-label. Le texte FR du HTML reste un fallback de dernier recours (clé absente).
export function applyStaticI18n(root = document) {
  const map = [
    ['data-i18n', el => { el.textContent = t(el.getAttribute('data-i18n')); }],
    ['data-i18n-title', el => { el.title = t(el.getAttribute('data-i18n-title')); }],
    ['data-i18n-placeholder', el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); }],
    ['data-i18n-tip', el => { el.dataset.tip = t(el.getAttribute('data-i18n-tip')); }],
    ['data-i18n-alt', el => { el.alt = t(el.getAttribute('data-i18n-alt')); }],
    ['data-i18n-aria-label', el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'))); }],
  ];
  for (const [attr, apply] of map) {
    for (const el of root.querySelectorAll(`[${attr}]`)) apply(el);
  }
}

// Liste des langues pour le sélecteur Settings : English (intégré, toujours en tête) + le manifeste.
// Manifeste introuvable/illisible ⇒ EN seul (jamais de plantage).
export async function availableLanguages() {
  const builtin = [{ code: 'en', name: 'English' }];
  try {
    const res = await fetch('i18n/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const packs = await res.json();
    const extra = (Array.isArray(packs) ? packs : [])
      .filter(p => p && p.code && p.code !== 'en')
      .map(p => ({ code: p.code, name: p.name || p.code }));
    return [...builtin, ...extra];
  } catch (e) {
    console.warn('[i18n] manifeste indisponible, EN seul', e);
    return builtin;
  }
}
