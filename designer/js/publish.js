// Helpers purs du dialogue « Publier » (slug, validation, URL GitHub, seuil). Aucun DOM → testé node.
// Le domaine partage l'enum DOMAINS avec la galerie (store-index.js), source commune.
import { DOMAINS } from './store-index.js';

const REQUIRED = ['name', 'author', 'description', 'domain'];

// Nom → slug de fichier sûr : minuscule, accents retirés, non-alphanum → tirets, borné 40, défaut si vide.
export function slugify(name) {
  const s = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'dashboard';
}

// fields → { valid, missing:[...] }. Requis non vides + domaine dans l'enum.
// Défensif (fonction exportée, cf. convention projet) : un arg non-objet est traité comme {}, jamais throw.
export function validateMeta(fields) {
  const f = (fields && typeof fields === 'object') ? fields : {};
  const missing = REQUIRED.filter(k => !f[k] || !String(f[k]).trim());
  if (f.domain && !DOMAINS.includes(f.domain) && !missing.includes('domain')) missing.push('domain');
  return { valid: missing.length === 0, missing };
}

// Formulaire → bloc meta propre (tags CSV → array sans vides, champs trimés).
// Défensif : arg non-objet → {} ; chaque champ passé par String(… || '') avant .trim() (pas de throw).
export function buildMeta(fields) {
  const f = (fields && typeof fields === 'object') ? fields : {};
  return {
    name: String(f.name || '').trim(),
    author: String(f.author || '').trim(),
    description: String(f.description || '').trim(),
    domain: f.domain,
    tags: String(f.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    requires: String(f.requires || '').trim(),
  };
}

// URL de l'éditeur « new file » GitHub pré-rempli (chemin sous entries/<auteur-slug>/ + contenu).
export function publishUrl(repoUrl, author, slug, dboardText) {
  const path = `entries/${slugify(author)}/${slug}.dboard`;
  return `${repoUrl}/new/main?filename=${encodeURIComponent(path)}&value=${encodeURIComponent(dboardText)}`;
}

// Le contenu URL-encodé tient-il sous le seuil ? (prefill viable vs repli téléchargement)
export const PREFILL_MAX = 6000;
export function fitsPrefill(dboardText, max = PREFILL_MAX) {
  return encodeURIComponent(dboardText).length <= max;
}
