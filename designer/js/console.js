// Console bas repliable (Phase 6, spec §5) : onglets [Problèmes | Source] + journaux optionnels
// [Activité | Log JS | Log réseau]. Cachée (corps replié) par défaut ; le bandeau (onglets + ▲▼) reste
// comme poignée. S'abonne au modèle (problèmes/source) ET au store de logs (3 journaux). Les onglets de
// journaux sont MASQUÉS quand leur case (settings) est décochée ; si l'onglet actif disparaît → Problèmes.
// Câblage DOM, vérifié navigateur (pas de test node). refreshTabs() est appelé par app.js quand un réglage
// de journal change.
export function createConsole(root, model, { validate, logs, getSettings }) {
  let tab = 'problems';     // onglet actif : problems | source | activity | js | net
  let isOpen = false;       // corps déplié ? (≠ la méthode publique open(t) renvoyée plus bas)

  // --- Bandeau : onglets + bascule de pliage ---
  const head = document.createElement('div');
  head.className = 'console-head';
  const mkTab = (key, text) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'console-tab'; b.textContent = text;
    b.onclick = () => selectTab(key);
    return b;
  };
  const tabBtns = {
    problems: mkTab('problems', 'Problèmes'),
    source: mkTab('source', 'Source'),
    activity: mkTab('activity', 'Activité'),
    js: mkTab('js', 'Log JS'),
    net: mkTab('net', 'Log réseau'),
  };
  const spacer = document.createElement('span'); spacer.className = 'console-spacer';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'console-toggle'; toggle.title = 'Replier / déplier la console';
  head.append(tabBtns.problems, tabBtns.source, tabBtns.activity, tabBtns.js, tabBtns.net, spacer, toggle);

  // --- Corps : Problèmes (liste) + Source (pre + Copier) + 3 panneaux de journaux (liste + Vider) ---
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

  const makeLogPanel = (kind) => {
    const wrap = document.createElement('div'); wrap.className = 'console-logwrap';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button'; clearBtn.className = 'console-copy'; clearBtn.textContent = 'Vider';
    clearBtn.onclick = () => logs.clear(kind);
    const listEl = document.createElement('div'); listEl.className = 'console-log';
    wrap.append(clearBtn, listEl);
    return { wrap, listEl };
  };
  const logPanels = { activity: makeLogPanel('activity'), js: makeLogPanel('js'), net: makeLogPanel('net') };
  body.append(problems, source, logPanels.activity.wrap, logPanels.js.wrap, logPanels.net.wrap);
  root.append(head, body);

  const panelByTab = {
    problems, source,
    activity: logPanels.activity.wrap, js: logPanels.js.wrap, net: logPanels.net.wrap,
  };
  const LOG_TABS = { activity: 'logActivity', js: 'logJs', net: 'logNet' };
  // Quels onglets de journaux sont visibles, selon les settings (case décochée → onglet masqué).
  const logVisible = () => {
    const s = (getSettings && getSettings()) || {};
    return { activity: !!s.logActivity, js: !!s.logJs, net: !!s.logNet };
  };

  const syncView = () => {
    root.classList.toggle('open', isOpen);
    body.hidden = !isOpen;
    const vis = logVisible();
    tabBtns.activity.hidden = !vis.activity;
    tabBtns.js.hidden = !vis.js;
    tabBtns.net.hidden = !vis.net;
    for (const k of Object.keys(tabBtns)) tabBtns[k].classList.toggle('active', tab === k);
    for (const k of Object.keys(panelByTab)) panelByTab[k].hidden = tab !== k;
    toggle.textContent = isOpen ? '▾' : '▴';
  };

  // Appelé par app.js quand un réglage de journal change : si l'onglet actif vient d'être masqué,
  // on retombe sur « Problèmes » (sinon un panneau caché resterait « actif » sans onglet cliquable).
  const refreshTabs = () => {
    const vis = logVisible();
    if (tab in LOG_TABS && !vis[tab]) tab = 'problems';
    syncView();
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

  const fmtTime = (d) => { try { return d.toTimeString().slice(0, 8); } catch (e) { return ''; } };
  const renderLog = (kind) => {
    const panel = logPanels[kind]; if (!panel) return;
    const rows = logs.get(kind);
    panel.listEl.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'console-empty'; empty.textContent = 'Aucune entrée.';
      panel.listEl.append(empty); return;
    }
    for (const r of rows) {
      const line = document.createElement('div'); line.className = 'console-logline';
      const ts = document.createElement('span'); ts.className = 'console-logtime'; ts.textContent = fmtTime(r.t);
      const msg = document.createElement('span');
      if (kind === 'js') {
        msg.className = 'console-log-' + r.level;   // log | info | warn | error
        msg.textContent = '[' + r.level + '] ' + r.message;
      } else if (kind === 'net') {
        msg.className = r.ok ? 'console-log-ok' : 'console-log-err';
        msg.textContent = `${r.method} ${r.path} ${r.status === 0 ? 'ERR' : r.status} ${r.ms}ms`;
      } else {
        msg.textContent = r.message;
      }
      line.append(ts, msg); panel.listEl.append(line);
    }
  };

  let copyTimer = null;
  copyBtn.onclick = async () => {
    if (copyTimer) clearTimeout(copyTimer);   // clics rapides : annule le reset en attente (pas de « Copier » prématuré)
    try { await navigator.clipboard.writeText(model.toJSON()); copyBtn.textContent = 'Copié ✓'; }
    catch (e) { copyBtn.textContent = 'Échec copie'; }
    copyTimer = setTimeout(() => { copyBtn.textContent = 'Copier'; copyTimer = null; }, 1500);
  };

  const selectTab = (t) => { tab = t; isOpen = true; if (t in LOG_TABS) renderLog(t); syncView(); };
  toggle.onclick = () => { isOpen = !isOpen; syncView(); };

  model.subscribe(() => { renderProblems(); renderSource(); });
  logs.subscribe(() => { if (tab in LOG_TABS) renderLog(tab); });   // nouvelle ligne pendant qu'on regarde un journal
  renderProblems(); renderSource(); syncView();

  return {
    // Ouvre la console sur un onglet (appelé par le clic validation de la barre d'état → 'problems').
    open(t = 'problems') { selectTab(t); },
    refreshTabs,
  };
}
