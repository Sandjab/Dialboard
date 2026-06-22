// Barre d'état (Phase 6, spec §4) : contexte de sélection (gauche) + verdict de validation cliquable (droite).
// Fonctions PURES (testées node) ; la construction DOM (createStatusbar) est en bas (vérifiée navigateur).
import { COMPONENTS } from './registry.js';

// Verdict de validation condensé pour la barre d'état. `valid` ne dépend QUE des errors (validate.js) : un
// warning ne bloque pas le push → on reste « ✓ valide » avec le compte d'avertissements (niveau warn).
// L'erreur prime sur l'avertissement (ne pas masquer le bloquant).
export function formatValidationSummary({ valid, errors = [], warnings = [] }) {
  if (errors.length) return { text: `✗ ${errors.length} erreur${errors.length > 1 ? 's' : ''}`, level: 'err' };
  if (warnings.length) return { text: `✓ valide · ${warnings.length} avert.`, level: 'warn' };
  return { text: '✓ valide', level: 'ok' };
}
