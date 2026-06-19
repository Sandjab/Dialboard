// Humanise une erreur ajv (draft-07) brute en français lisible pour le panneau d'erreurs.
// ajv fournit { instancePath, keyword, params, message }. On mappe les keywords fréquents du schéma
// layout vers une phrase claire et on rend le chemin lisible. Les patterns du schéma (couleur, ASCII)
// sont reconnus par leur source. Tout keyword non mappé retombe sur le message ajv brut (jamais muet).

const COLOR_PATTERN = '^#[0-9A-Fa-f]{6}$';
const ASCII_PATTERN = '^[\\x00-\\x7F]*$';

const FR_TYPE = { integer: 'entier', number: 'nombre', string: 'texte', boolean: 'booléen', object: 'objet', array: 'liste' };
const frType = t => FR_TYPE[t] || t;

// "/pages/0/place/2/dx" -> "page 1 › élément 3 › dx" ; "/components/cpu" -> "composant › cpu".
export function humanizePath(instancePath) {
  if (!instancePath) return 'racine';
  const parts = instancePath.split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === 'pages' && /^\d+$/.test(parts[i + 1])) { out.push(`page ${Number(parts[i + 1]) + 1}`); i++; }
    else if (seg === 'place' && /^\d+$/.test(parts[i + 1])) { out.push(`élément ${Number(parts[i + 1]) + 1}`); i++; }
    else if (seg === 'components') out.push('composant');
    else out.push(seg);
  }
  return out.join(' › ');
}

export function humanizeAjvError(e) {
  const where = humanizePath(e.instancePath);
  switch (e.keyword) {
    case 'pattern':
      if (e.params?.pattern === COLOR_PATTERN) return `${where} : doit être une couleur au format #RRGGBB`;
      if (e.params?.pattern === ASCII_PATTERN) return `${where} : doit rester en ASCII (pas d'accents ni de symboles spéciaux)`;
      return `${where} : format invalide`;
    case 'enum': {
      const vals = (e.params?.allowedValues || []).join(', ');
      return `${where} : valeur non autorisée${vals ? ` (au choix : ${vals})` : ''}`;
    }
    case 'additionalProperties':
      return `${where} : propriété inconnue « ${e.params?.additionalProperty} »`;
    case 'required':
      return `${where} : propriété obligatoire « ${e.params?.missingProperty} » manquante`;
    case 'type':
      return `${where} : doit être de type ${frType(e.params?.type)}`;
    case 'minProperties':
      return `${where} : au moins une entrée requise`;
    case 'minimum':
      return `${where} : doit être ≥ ${e.params?.limit}`;
    case 'maximum':
      return `${where} : doit être ≤ ${e.params?.limit}`;
    case 'oneOf':
      return `${where} : type de composant non reconnu ou propriétés incohérentes`;
    default:
      return `${where} ${e.message || ''}`.trim();
  }
}
