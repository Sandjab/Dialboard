// Vue JSON avancée : reflète le modèle dans le textarea, et applique le texte au modèle.
export function bindJsonView(model, { textarea, applyBtn, validEl, errorsEl, warningsEl }, validate) {
  const runValidation = () => {
    const { valid, errors, warnings = [] } = validate(model.state);
    validEl.textContent = valid ? (warnings.length ? `✓ valide · ${warnings.length} avert.` : '✓ valide') : '✗ invalide';
    validEl.className = 'valid ' + (valid ? 'ok' : 'err');
    errorsEl.textContent = errors.join('\n');
    if (warningsEl) warningsEl.textContent = warnings.map(w => '⚠ ' + w).join('\n');
  };
  const refresh = () => {
    if (document.activeElement !== textarea) textarea.value = model.toJSON();
    runValidation();
  };
  applyBtn.onclick = () => {
    try {
      model.loadJSON(textarea.value);
      // loadJSON déclenche refresh() → runValidation() : le statut reflète déjà la validité réelle.
    } catch (e) {
      validEl.textContent = 'JSON illisible : ' + e.message;
      validEl.className = 'valid err';
    }
  };
  model.subscribe(refresh);
  refresh();
}
