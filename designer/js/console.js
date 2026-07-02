// Console bas repliable (Phase 6, spec §5) : onglets [Problèmes | Source] + optionnels
// [Activité | Log JS | Log réseau | Device]. Cachée (corps replié) par défaut ; le bandeau (onglets + ▲▼)
// reste comme poignée. S'abonne au modèle (problèmes/source) ET au store de logs (3 journaux). Les onglets
// optionnels (journaux + Device) sont MASQUÉS quand leur case (settings) est décochée ; si l'onglet actif
// disparaît → Problèmes. Câblage DOM, vérifié navigateur (pas de test node). refreshTabs() est appelé par
// app.js quand un réglage (journal ou onglet Device) change.
import { t } from './i18n.js';
import { formatDeviceDump } from './device.js';

export function createConsole(root, model, { validate, logs, getSettings, pullDeviceContext }) {
  let tab = 'problems';     // onglet actif : problems | source | activity | js | net | deviceCtx
  let isOpen = false;       // corps déplié ? (≠ la méthode publique open(t) renvoyée plus bas)
  let syncAuto = () => {};   // remplacé en Tâche 7 (auto-refresh) — laissé mutable (let) pour la substitution

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
    problems: mkTab('problems', t('console.tab.problems')),
    source: mkTab('source', t('console.tab.source')),
    activity: mkTab('activity', t('console.tab.activity')),
    js: mkTab('js', t('console.tab.js')),
    net: mkTab('net', t('console.tab.net')),
    deviceCtx: mkTab('deviceCtx', t('console.tab.device_context')),
  };
  const spacer = document.createElement('span'); spacer.className = 'console-spacer';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'console-toggle'; toggle.title = t('console.toggle_tip');
  head.append(tabBtns.problems, tabBtns.source, tabBtns.activity, tabBtns.js, tabBtns.net, tabBtns.deviceCtx, spacer, toggle);

  // --- Corps : Problèmes (liste) + Source (pre + Copier) + 3 panneaux de journaux (liste + Vider) ---
  const body = document.createElement('div');
  body.className = 'console-body';
  const problems = document.createElement('div');
  problems.className = 'console-problems';
  const source = document.createElement('div');
  source.className = 'console-source';
  const pre = document.createElement('pre'); pre.className = 'console-json';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 'console-copy'; copyBtn.textContent = t('console.copy');
  source.append(copyBtn, pre);

  const makeLogPanel = (kind) => {
    const wrap = document.createElement('div'); wrap.className = 'console-logwrap';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button'; clearBtn.className = 'console-copy'; clearBtn.textContent = t('console.clear');
    clearBtn.onclick = () => logs.clear(kind);
    const listEl = document.createElement('div'); listEl.className = 'console-log';
    wrap.append(clearBtn, listEl);
    return { wrap, listEl };
  };
  const logPanels = { activity: makeLogPanel('activity'), js: makeLogPanel('js'), net: makeLogPanel('net') };

  // --- Panneau Device : [Pull] [☐ Auto] [Copier] + 3 sections (Vars / Sources / Sinks) ---
  const devCtx = document.createElement('div'); devCtx.className = 'console-devctx';
  const devBar = document.createElement('div'); devBar.className = 'console-devbar';
  const pullBtn = document.createElement('button'); pullBtn.type = 'button'; pullBtn.className = 'console-copy'; pullBtn.textContent = t('console.devctx.pull');
  const autoLabel = document.createElement('label'); autoLabel.className = 'console-devauto';
  const autoChk = document.createElement('input'); autoChk.type = 'checkbox';
  autoLabel.append(autoChk, document.createTextNode(' ' + t('console.devctx.auto')));
  const devCopy = document.createElement('button'); devCopy.type = 'button'; devCopy.className = 'console-copy'; devCopy.textContent = t('console.copy');
  devBar.append(pullBtn, autoLabel, devCopy);
  const devOut = document.createElement('div'); devOut.className = 'console-devout';
  devCtx.append(devBar, devOut);

  body.append(problems, source, logPanels.activity.wrap, logPanels.js.wrap, logPanels.net.wrap, devCtx);
  root.append(head, body);

  const panelByTab = {
    problems, source,
    activity: logPanels.activity.wrap, js: logPanels.js.wrap, net: logPanels.net.wrap,
    deviceCtx: devCtx,
  };
  const LOG_TABS = { activity: 'logActivity', js: 'logJs', net: 'logNet' };
  // Quels onglets optionnels sont visibles selon les settings (case décochée → onglet masqué).
  const tabVisible = () => {
    const s = (getSettings && getSettings()) || {};
    return { activity: !!s.logActivity, js: !!s.logJs, net: !!s.logNet, deviceCtx: !!s.deviceContext };
  };

  const syncView = () => {
    root.classList.toggle('open', isOpen);
    body.hidden = !isOpen;
    const vis = tabVisible();
    tabBtns.activity.hidden = !vis.activity;
    tabBtns.js.hidden = !vis.js;
    tabBtns.net.hidden = !vis.net;
    tabBtns.deviceCtx.hidden = !vis.deviceCtx;
    for (const k of Object.keys(tabBtns)) tabBtns[k].classList.toggle('active', tab === k);
    for (const k of Object.keys(panelByTab)) panelByTab[k].hidden = tab !== k;
    toggle.textContent = isOpen ? '▾' : '▴';
  };

  // Appelé par app.js quand un réglage de journal (ou de l'onglet Device) change : si l'onglet actif
  // vient d'être masqué, on retombe sur « Problèmes » (sinon un panneau caché resterait « actif »
  // sans onglet cliquable).
  const refreshTabs = () => {
    const vis = tabVisible();
    if ((tab in LOG_TABS && !vis[tab]) || (tab === 'deviceCtx' && !vis.deviceCtx)) tab = 'problems';
    syncAuto();
    syncView();
  };

  const renderProblems = () => {
    const { errors = [], warnings = [] } = validate(model.state);
    problems.replaceChildren();
    if (!errors.length && !warnings.length) {
      const ok = document.createElement('div'); ok.className = 'console-empty'; ok.textContent = t('console.no_problems');
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

  let lastDump = null;   // dernier pull { vars, sources, sinks, uptime_s } (pour Copier)

  const renderDevCtx = (dump, errMsg) => {
    devOut.replaceChildren();
    if (errMsg) {
      const e = document.createElement('div'); e.className = 'console-err'; e.textContent = '✗ ' + t('console.devctx.error') + ' — ' + errMsg;
      devOut.append(e); return;
    }
    if (!dump) {
      const empty = document.createElement('div'); empty.className = 'console-empty'; empty.textContent = t('console.devctx.empty');
      devOut.append(empty); return;
    }
    const f = formatDeviceDump(dump);
    const section = (titleKey, lines) => {
      const h = document.createElement('div'); h.className = 'console-devsec'; h.textContent = t(titleKey);
      devOut.append(h);
      if (!lines.length) { const em = document.createElement('div'); em.className = 'console-empty'; em.textContent = t('console.no_entries'); devOut.append(em); return; }
      for (const el of lines) devOut.append(el);
    };
    // Vars : nom = valeur
    section('console.devctx.vars', f.vars.map(v => {
      const line = document.createElement('div'); line.className = 'console-logline';
      const n = document.createElement('span'); n.className = 'console-logtime'; n.textContent = v.name;
      const val = document.createElement('span'); val.textContent = String(v.value);
      line.append(n, val); return line;
    }));
    // Sources / Sinks : nom · statut · errN · âge
    const teleLine = (r) => {
      const line = document.createElement('div'); line.className = 'console-logline';
      const n = document.createElement('span'); n.className = 'console-logtime'; n.textContent = r.name || '?';
      const st = document.createElement('span');
      // ok = 2xx ; err = erreur transport (err_count) OU statut non-2xx (un sink en 404/500 a err_count=0
      // côté firmware mais reste un échec à signaler — c'est ce que ce panneau sert à débugger) ; neutre = jamais tiré/màj.
      st.className = (r.status === 200 || r.status === 204) ? 'console-log-ok'
                   : (r.errors || r.status != null) ? 'console-log-err' : '';
      const agePart = r.age === null ? '—' : (r.age + 's');
      st.textContent = `${r.status == null ? '—' : r.status} · err${r.errors} · ${agePart}`;
      line.append(n, st); return line;
    };
    section('console.devctx.sources', f.sources.map(teleLine));
    section('console.devctx.sinks', f.sinks.map(teleLine));
  };

  let pullInFlight = false;
  const doPull = async () => {
    if (pullInFlight || !pullDeviceContext) return;
    pullInFlight = true;
    try { lastDump = await pullDeviceContext(); renderDevCtx(lastDump, null); }
    catch (e) { renderDevCtx(null, e && e.message ? e.message : String(e)); }
    finally { pullInFlight = false; }
  };
  pullBtn.onclick = doPull;

  let autoOn = false;          // toggle éphémère (non persisté ; off à chaque session)
  let autoTimer = null;
  const AUTO_MS = 2000;
  const autoShouldRun = () => autoOn && isOpen && tab === 'deviceCtx' && !!tabVisible().deviceCtx;
  // Réassigne le stub `let syncAuto` : (re)démarre/arrête l'unique intervalle selon TOUTES les conditions.
  // Fermer la console, changer d'onglet, décocher la case (settings) ou couper Auto → clearInterval (pas de timer orphelin).
  syncAuto = () => {
    if (autoShouldRun()) {
      if (!autoTimer) autoTimer = setInterval(() => { if (!pullInFlight) doPull(); }, AUTO_MS);
    } else if (autoTimer) {
      clearInterval(autoTimer); autoTimer = null;
    }
  };
  autoChk.onchange = () => { autoOn = autoChk.checked; if (autoOn) doPull(); syncAuto(); };

  let devCopyTimer = null;
  devCopy.onclick = async () => {
    if (devCopyTimer) clearTimeout(devCopyTimer);
    try { await navigator.clipboard.writeText(JSON.stringify(lastDump || {}, null, 2)); devCopy.textContent = t('console.copied'); }
    catch (e) { devCopy.textContent = t('console.copy_failed'); }
    devCopyTimer = setTimeout(() => { devCopy.textContent = t('console.copy'); devCopyTimer = null; }, 1500);
  };

  const fmtTime = (d) => { try { return d.toTimeString().slice(0, 8); } catch (e) { return ''; } };
  const renderLog = (kind) => {
    const panel = logPanels[kind]; if (!panel) return;
    const rows = logs.get(kind);
    panel.listEl.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'console-empty'; empty.textContent = t('console.no_entries');
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
    try { await navigator.clipboard.writeText(model.toJSON()); copyBtn.textContent = t('console.copied'); }
    catch (e) { copyBtn.textContent = t('console.copy_failed'); }
    copyTimer = setTimeout(() => { copyBtn.textContent = t('console.copy'); copyTimer = null; }, 1500);
  };

  const selectTab = (t) => { tab = t; isOpen = true; if (t in LOG_TABS) renderLog(t); syncAuto(); syncView(); };
  toggle.onclick = () => { isOpen = !isOpen; syncAuto(); syncView(); };

  model.subscribe(() => { renderProblems(); renderSource(); });
  logs.subscribe(() => { if (tab in LOG_TABS) renderLog(tab); });   // nouvelle ligne pendant qu'on regarde un journal
  renderProblems(); renderSource(); syncView();
  renderDevCtx(null, null);   // état « aucun pull » d'emblée

  return {
    // Ouvre la console sur un onglet (appelé par le clic validation de la barre d'état → 'problems').
    open(t = 'problems') { selectTab(t); },
    refreshTabs,
  };
}
