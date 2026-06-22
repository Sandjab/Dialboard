// Console bas repliable (Phase 6, spec §5) : deux onglets [Problèmes | Source]. Cachée (corps replié) par
// défaut ; le bandeau (onglets + ▲▼) reste comme poignée. S'abonne au modèle : re-rend la liste de problèmes
// (validate) et la vue Source (model.toJSON()). Câblage DOM, vérifié navigateur (pas de test node).
export function createConsole(root, model, { validate }) {
  let tab = 'problems';     // onglet actif
  let isOpen = false;       // corps déplié ? (≠ la méthode publique open(t) renvoyée plus bas)

  // --- Bandeau : onglets + bascule de pliage ---
  const head = document.createElement('div');
  head.className = 'console-head';
  const tabProblems = document.createElement('button');
  tabProblems.type = 'button'; tabProblems.className = 'console-tab'; tabProblems.textContent = 'Problèmes';
  const tabSource = document.createElement('button');
  tabSource.type = 'button'; tabSource.className = 'console-tab'; tabSource.textContent = 'Source';
  const spacer = document.createElement('span'); spacer.className = 'console-spacer';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'console-toggle'; toggle.title = 'Replier / déplier la console';
  head.append(tabProblems, tabSource, spacer, toggle);

  // --- Corps : panneau Problèmes (liste) + panneau Source (pre lecture seule + Copier) ---
  const body = document.createElement('div');
  body.className = 'console-body';
  const problems = document.createElement('div');
  problems.className = 'console-problems';
  const source = document.createElement('div');
  source.className = 'console-source';
  const pre = document.createElement('pre'); pre.className = 'console-json';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 'console-copy'; copyBtn.textContent = 'Copier';
  source.append(copyBtn, pre);
  body.append(problems, source);
  root.append(head, body);

  const syncView = () => {
    root.classList.toggle('open', isOpen);
    body.hidden = !isOpen;
    tabProblems.classList.toggle('active', tab === 'problems');
    tabSource.classList.toggle('active', tab === 'source');
    problems.hidden = tab !== 'problems';
    source.hidden = tab !== 'source';
    toggle.textContent = isOpen ? '▾' : '▴';
  };

  const renderProblems = () => {
    const { errors = [], warnings = [] } = validate(model.state);
    problems.replaceChildren();
    if (!errors.length && !warnings.length) {
      const ok = document.createElement('div'); ok.className = 'console-empty'; ok.textContent = 'Aucun problème.';
      problems.append(ok);
      return;
    }
    for (const e of errors) {
      const li = document.createElement('div'); li.className = 'console-err'; li.textContent = '✗ ' + e; problems.append(li);
    }
    for (const w of warnings) {
      const li = document.createElement('div'); li.className = 'console-warn'; li.textContent = '⚠ ' + w; problems.append(li);
    }
  };
  const renderSource = () => { pre.textContent = model.toJSON(); };

  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(model.toJSON()); copyBtn.textContent = 'Copié ✓'; }
    catch (e) { copyBtn.textContent = 'Échec copie'; }
    setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1500);
  };

  const selectTab = (t) => { tab = t; isOpen = true; syncView(); };
  tabProblems.onclick = () => selectTab('problems');
  tabSource.onclick = () => selectTab('source');
  toggle.onclick = () => { isOpen = !isOpen; syncView(); };

  model.subscribe(() => { renderProblems(); renderSource(); });
  renderProblems(); renderSource(); syncView();

  return {
    // Ouvre la console sur un onglet (appelé par le clic validation de la barre d'état → 'problems').
    open(t = 'problems') { selectTab(t); },
  };
}
