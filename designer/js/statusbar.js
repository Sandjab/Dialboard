// Barre d'état (Phase 6, spec §4) : contexte de sélection (gauche) + verdict de validation cliquable (droite).
// Fonctions PURES (testées node) ; la construction DOM (createStatusbar) est en bas (vérifiée navigateur).
import { COMPONENTS } from './registry.js';

// Verdict de validation condensé pour la barre d'état. `valid` ne dépend QUE des errors (validate.js) : un
// warning ne bloque pas le push → on reste « ✓ valide » avec le compte d'avertissements (niveau warn).
// L'erreur prime sur l'avertissement (ne pas masquer le bloquant).
export function formatValidationSummary({ errors = [], warnings = [] }) {
  if (errors.length) return { text: `✗ ${errors.length} erreur${errors.length > 1 ? 's' : ''}`, level: 'err' };
  if (warnings.length) return { text: `✓ valide · ${warnings.length} avert.`, level: 'warn' };
  return { text: '✓ valide', level: 'ok' };
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const placements = p => (Array.isArray(p?.place) ? p.place.length : 0);

// Contexte de sélection pour la gauche de la barre (lu sur le store selection + le modèle). Pur. Décompte
// « composants » = placements visuels (somme des place[]), cohérent avec l'arbre (les physiques led_ring/sound
// ne sont pas placés → exclus). Repli '?' sur ref orpheline ; '' sur sélection périmée (l'intégration purge,
// mais on ne throw jamais — la barre doit rester affichable).
export function formatSelectionContext(state, sel) {
  if (!sel) return 'Rien de sélectionné';
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  if (sel.kind === 'doc') {
    const total = pages.reduce((n, p) => n + placements(p), 0);
    return `${plural(pages.length, 'page')} · ${plural(total, 'composant')}`;
  }
  const page = pages[sel.page];
  if (!page) return '';
  if (sel.kind === 'page') {
    return `Page « ${page.name ?? ''} » (${sel.page + 1}/${pages.length}) · ${plural(placements(page), 'composant')}`;
  }
  // comp
  const pl = page.place?.[sel.index];
  if (!pl) return '';
  const c = state.components?.[pl.ref];
  const typeLabel = (c && COMPONENTS[c.type]?.label) || '?';
  const vis = c && c.visible === false ? 'masqué' : 'visible';
  const dx = pl.dx ?? 0, dy = pl.dy ?? 0;
  return `${typeLabel} · ${pl.ref} · page « ${page.name ?? ''} » · ${pl.anchor ?? 'CENTER'} (${dx}, ${dy}) · ${vis}`;
}

// --- DOM (vérifié navigateur ; pas de test node, cf. convention projet) ---
// Barre d'état : gauche = contexte de sélection (s'abonne à selection + model) ; droite = verdict de
// validation cliquable (s'abonne à model → validate) qui ouvre la console Problèmes (onValidClick). Le
// <select id="zoom"> vit dans le markup à droite (display-only, câblé par app.js — pas géré ici).
export function createStatusbar(root, model, { selection, validate, onValidClick }) {
  const context = document.createElement('span');
  context.className = 'sb-context';
  const valid = document.createElement('button');
  valid.type = 'button';
  valid.className = 'sb-valid';
  valid.title = 'Voir les problèmes';
  valid.onclick = () => onValidClick?.();
  const spacer = document.createElement('span');
  spacer.className = 'sb-spacer';
  // Ordre : contexte | spacer | validation | (zoom déjà présent dans le markup HTML à droite).
  root.prepend(context, spacer, valid);

  const renderContext = () => { context.textContent = formatSelectionContext(model.state, selection.get()); };
  const renderValid = () => {
    const r = formatValidationSummary(validate(model.state));
    valid.textContent = r.text;
    valid.className = 'sb-valid sb-' + r.level;
  };
  // Le contexte dépend de la sélection ET du modèle (un rename/déplacement change le libellé sans changer
  // la sélection). La validation ne dépend que du modèle.
  selection.subscribe(renderContext);
  model.subscribe(() => { renderContext(); renderValid(); });
  renderContext(); renderValid();
}
