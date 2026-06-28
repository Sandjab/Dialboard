// Humanise une erreur ajv (draft-07) brute en message lisible (i18n) pour le panneau d'erreurs.
// ajv fournit { instancePath, keyword, params, message }. On mappe les keywords fréquents du schéma
// layout vers une phrase claire et on rend le chemin lisible. Les patterns du schéma (couleur, ASCII)
// sont reconnus par leur source. Tout keyword non mappé retombe sur le message ajv brut (jamais muet).
// Les libellés sont résolus par t() (clés humanize.*) ; chaque message porte le chemin via {where}.
import { t } from './i18n.js';

const COLOR_PATTERN = '^#[0-9A-Fa-f]{6}$';
const ASCII_PATTERN = '^[\\x00-\\x7F]*$';
const ID_PATTERN = '^[A-Za-z0-9_]+$';
const DISPLAY_PATTERN = '^[\\x20-\\x7E\\xA0-\\xFF]*$';

const JTYPES = ['integer', 'number', 'string', 'boolean', 'object', 'array'];
const typeName = ty => JTYPES.includes(ty) ? t('humanize.jtype.' + ty) : ty;

// "/pages/0/place/2/dx" -> "page 1 › élément 3 › dx" ; "/components/cpu" -> "composant › cpu".
export function humanizePath(instancePath) {
  if (!instancePath) return t('humanize.path.root');
  const parts = instancePath.split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === 'pages' && /^\d+$/.test(parts[i + 1])) { out.push(t('humanize.path.page', { n: Number(parts[i + 1]) + 1 })); i++; }
    else if (seg === 'place' && /^\d+$/.test(parts[i + 1])) { out.push(t('humanize.path.element', { n: Number(parts[i + 1]) + 1 })); i++; }
    else if (seg === 'components') out.push(t('humanize.path.component'));
    else out.push(seg);
  }
  return out.join(' › ');
}

export function humanizeAjvError(e) {
  const where = humanizePath(e.instancePath);
  switch (e.keyword) {
    case 'pattern':
      if (e.params?.pattern === COLOR_PATTERN) return t('humanize.pattern.color', { where });
      if (e.params?.pattern === ASCII_PATTERN) return t('humanize.pattern.ascii', { where });
      if (e.params?.pattern === ID_PATTERN) return t('humanize.pattern.id', { where });
      if (e.params?.pattern === DISPLAY_PATTERN) return t('humanize.pattern.display', { where });
      return t('humanize.pattern.fallback', { where });
    case 'enum': {
      const vals = (e.params?.allowedValues || []).join(', ');
      return t('humanize.enum', { where, hint: vals ? t('humanize.enum.hint', { vals }) : '' });
    }
    case 'additionalProperties':
      return t('humanize.additional', { where, prop: e.params?.additionalProperty });
    case 'required':
      return t('humanize.required', { where, prop: e.params?.missingProperty });
    case 'type':
      return t('humanize.type', { where, type: typeName(e.params?.type) });
    case 'minProperties':
      return t('humanize.min_properties', { where });
    case 'minimum':
      return t('humanize.minimum', { where, limit: e.params?.limit });
    case 'maximum':
      return t('humanize.maximum', { where, limit: e.params?.limit });
    case 'oneOf':
      return t('humanize.one_of', { where });
    default:
      return `${where} ${e.message || ''}`.trim();
  }
}
