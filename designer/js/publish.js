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
export function validateMeta(fields = {}) {
  const missing = REQUIRED.filter(k => !fields[k] || !String(fields[k]).trim());
  if (fields.domain && !DOMAINS.includes(fields.domain) && !missing.includes('domain')) missing.push('domain');
  return { valid: missing.length === 0, missing };
}

// Formulaire → bloc meta propre (tags CSV → array sans vides, champs trimés).
export function buildMeta(fields) {
  return {
    name: fields.name.trim(),
    author: fields.author.trim(),
    description: fields.description.trim(),
    domain: fields.domain,
    tags: String(fields.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    requires: String(fields.requires || '').trim(),
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
