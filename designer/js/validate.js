// Validation du layout : forme (ajv contre le schema) + invariants sémantiques (refs).
// Le schema définit le FORMAT ; la résolution des placement.ref est une contrainte
// sémantique non exprimable en JSON Schema, ajoutée ici (miroir du firmware).
// Les messages ajv sont humanisés (humanize.js) pour le panneau d'erreurs.
import Ajv from '../vendor/ajv.min.js';
import { humanizeAjvError } from './humanize.js';
import { t } from './i18n.js';

export function createValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateShape = ajv.compile(schema);
  return function validate(layout) {
    const errors = [];
    if (!validateShape(layout)) {
      for (const e of validateShape.errors) {
        // Bruit oneOf : chaque type de composant compare /type à sa constante ; on supprime ces
        // mismatchs de discriminant et on garde le message de synthèse oneOf (+ la vraie erreur
        // de propriété, additionalProperties/required, qui reste).
        if (e.keyword === 'const' && e.instancePath.endsWith('/type')) continue;
        errors.push(humanizeAjvError(e));
      }
    }
    const ids = new Set(Object.keys(layout?.components || {}));
    // Array.isArray (pas `|| []`) : un layout importé au pages/place non-array est déjà signalé par
    // ajv ci-dessus ; ici on ne doit pas throw (sinon le panneau d'erreurs ne s'affiche jamais).
    const pages = Array.isArray(layout?.pages) ? layout.pages : [];
    // Limites firmware (config.h) : un layout au-delà serait tronqué/rejeté au push.
    const LIM = { components: 32, pages: 8, placements: 12 };  // MAX_COMPONENTS / MAX_PAGES / MAX_PLACEMENTS_PER_PAGE
    if (ids.size > LIM.components) errors.push(t('validate.too_many_components', { n: ids.size, max: LIM.components }));
    if (pages.length > LIM.pages)  errors.push(t('validate.too_many_pages', { n: pages.length, max: LIM.pages }));
    pages.forEach((p, pi) => {
      const place = Array.isArray(p?.place) ? p.place : [];
      if (place.length > LIM.placements) errors.push(t('validate.too_many_placements', { pi: pi + 1, n: place.length, max: LIM.placements }));
      place.forEach(pl => {
        if (pl && pl.ref !== undefined && !ids.has(pl.ref)) errors.push(t('validate.unknown_ref', { pi: pi + 1, ref: pl.ref }));
      });
    });
    // Limites image_anim (config.h : AIMG_MAX_FRAMES=32, AIMG_MAX_BYTES=1572864).
    Object.entries(layout?.components || {}).forEach(([id, c]) => {
      if (!c || c.type !== 'image_anim') return;
      if (c.frames > 32) errors.push(t('validate.too_many_frames', { id, n: c.frames }));
      const bytes = (c.w || 0) * (c.h || 0) * 3 * (c.frames || 0);
      if (bytes > 1572864) errors.push(t('validate.pack_too_large', { id, bytes }));
    });
    // Avertissements (non bloquants) : un bind sans variable de source correspondante reste valide
    // (la variable peut être alimentée par POST /context), mais on le signale.
    const warnings = [];
    const srcVars = new Set();
    (Array.isArray(layout?.sources) ? layout.sources : []).forEach(s => {
      if (s && s.vars && typeof s.vars === 'object') Object.keys(s.vars).forEach(v => srcVars.add(v));
    });
    for (const [id, c] of Object.entries(layout?.components || {})) {
      if (c && typeof c.bind === 'string' && c.bind && !srcVars.has(c.bind))
        warnings.push(t('validate.unbound_bind', { id, bind: c.bind }));
    }
    // valid ne dépend QUE des errors ; les warnings ne bloquent pas le push.
    return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  };
}
