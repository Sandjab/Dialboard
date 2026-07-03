// Logique pure du catalogue Store (parse/filtre/recherche). Aucun DOM ni fetch → testé node.
// La galerie DOM (store-gallery.js) consomme ces helpers ; l'index provient de index.json (généré CI, Plan 2).

// Domaines canoniques (enum figé, cf. spec §8). Ordre = ordre d'affichage des chips.
export const DOMAINS = ['time', 'weather', 'finance', 'system', 'home', 'transit', 'health', 'fun', 'other'];

// JSON brut de index.json → tableau d'entrées normalisées. Tolérant : une entrée sans id/file/layout est
// écartée (pas de throw) ; les champs optionnels reçoivent un défaut sûr ; domaine inconnu → 'other'.
export function parseIndex(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && typeof e === 'object'
      && typeof e.id === 'string' && e.id
      && typeof e.file === 'string' && e.file
      && e.layout && typeof e.layout === 'object')
    .map(e => ({
      id: e.id,
      file: e.file,
      name: (typeof e.name === 'string' && e.name) ? e.name : e.id,
      author: typeof e.author === 'string' ? e.author : '',
      description: typeof e.description === 'string' ? e.description : '',
      domain: DOMAINS.includes(e.domain) ? e.domain : 'other',
      tags: Array.isArray(e.tags) ? e.tags.filter(t => typeof t === 'string') : [],
      requires: typeof e.requires === 'string' ? e.requires : '',
      layout: e.layout,
    }));
}

// Domaines réellement présents dans le catalogue, dans l'ordre canonique de DOMAINS (chips de filtre).
export function domainsOf(entries) {
  const present = new Set(entries.map(e => e.domain));
  return DOMAINS.filter(d => present.has(d));
}

// Filtre par domaine (null/'' = tous) puis par requête (nom/description/tags, insensible à la casse).
export function filterEntries(entries, { domain = null, query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return entries.filter(e => {
    if (domain && e.domain !== domain) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q)
      || e.description.toLowerCase().includes(q)
      || e.tags.some(tag => tag.toLowerCase().includes(q));
  });
}
