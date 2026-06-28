// Barre d'état (Phase 6, spec §4) : contexte de sélection (gauche) + verdict de validation cliquable (droite).
// Fonctions PURES (testées node) ; la construction DOM (createStatusbar) est en bas (vérifiée navigateur).
import { COMPONENTS } from './registry.js';
import { t } from './i18n.js';

// Verdict de validation condensé pour la barre d'état. `valid` ne dépend QUE des errors (validate.js) : un
// warning ne bloque pas le push → on reste « ✓ valide » avec le compte d'avertissements (niveau warn).
// L'erreur prime sur l'avertissement (ne pas masquer le bloquant).
export function formatValidationSummary({ errors = [], warnings = [] }) {
  if (errors.length) return { text: t('status.errors', { n: errors.length }), level: 'err' };
  if (warnings.length) return { text: t('status.valid_warn', { n: warnings.length }), level: 'warn' };
  return { text: t('status.valid'), level: 'ok' };
}

const placements = p => (Array.isArray(p?.place) ? p.place.length : 0);

// Contexte de sélection pour la gauche de la barre (lu sur le store selection + le modèle). Pur. Décompte
// « composants » = placements visuels (somme des place[]), cohérent avec l'arbre (les physiques led_ring/sound
// ne sont pas placés → exclus). Repli '?' sur ref orpheline ; '' sur sélection périmée (l'intégration purge,
// mais on ne throw jamais — la barre doit rester affichable).
export function formatSelectionContext(state, sel) {
  if (!sel) return t('status.nothing');
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  if (sel.kind === 'doc') {
    const total = pages.reduce((n, p) => n + placements(p), 0);
    return t('status.doc', { pages: pages.length, comps: total });
  }
  const page = pages[sel.page];
  if (!page) return '';
  if (sel.kind === 'page') {
    return t('status.page', { name: page.name ?? '', cur: sel.page + 1, total: pages.length, comps: placements(page) });
  }
  // comp
  const pl = page.place?.[sel.index];
  if (!pl) return '';
  const c = state.components?.[pl.ref];
  const typeLabel = c && COMPONENTS[c.type] ? t(COMPONENTS[c.type].label) : '?';
  const vis = c && c.visible === false ? t('status.hidden') : t('status.visible');
  const dx = pl.dx ?? 0, dy = pl.dy ?? 0;
  return t('status.comp', { type: typeLabel, ref: pl.ref, name: page.name ?? '', anchor: pl.anchor ?? 'CENTER', dx, dy, vis });
}

// --- DOM (vérifié navigateur ; pas de test node, cf. convention projet) ---
// Barre d'état : gauche = contexte de sélection (s'abonne à selection + model) ; droite = verdict de
// validation cliquable (s'abonne à model → validate) qui ouvre la console Problèmes (onValidClick).
export function createStatusbar(root, model, { selection, validate, onValidClick }) {
  const context = document.createElement('span');
  context.className = 'sb-context';
  const valid = document.createElement('button');
  valid.type = 'button';
  valid.className = 'sb-valid';
  valid.title = t('status.problems_tip');
  valid.onclick = () => onValidClick?.();
  const spacer = document.createElement('span');
  spacer.className = 'sb-spacer';
  // Ordre : contexte | spacer | validation.
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
