// Pont REST avec le device. CORS résolu côté firmware (header + OPTIONS).
import { logs } from './logs.js';
function clean(base) { return base.replace(/\/+$/, ''); }

// fetch instrumenté : journalise méthode/chemin/code HTTP/durée vers le journal réseau (device seul).
// Un rejet réseau (TypeError) est loggé status 0 puis relancé — le transport reste inchangé pour l'appelant.
async function devFetch(base, path, init) {
  const method = (init && init.method) || 'GET';
  const t0 = performance.now();
  try {
    const r = await fetch(clean(base) + path, init);
    logs.logNet({ method, path, status: r.status, ms: Math.round(performance.now() - t0), ok: r.ok });
    return r;
  } catch (e) {
    logs.logNet({ method, path, status: 0, ms: Math.round(performance.now() - t0), ok: false });
    throw e;
  }
}

export async function loadLayout(base) {
  const r = await devFetch(base, '/layout');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Renvoie une blob URL (image/bmp) ; l'appelant doit la revoquer (URL.revokeObjectURL) apres usage.
export async function captureScreenshot(base) {
  const r = await devFetch(base, '/screenshot');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return URL.createObjectURL(await r.blob());
}

// GET /status : santé du device (ip, page, pages, uptime, composants, état des sources pull).
export async function getStatus(base) {
  const r = await devFetch(base, '/status');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// GET /context : dump du blackboard { nom: valeur, … }. vars = CSV optionnel → filtre ?vars=a,b,c.
export async function getContext(base, vars) {
  const q = vars ? '?vars=' + encodeURIComponent(vars) : '';
  const r = await devFetch(base, '/context' + q);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// POST /page : navigue la page affichée SUR LE DEVICE. body = {dir:'next'|'prev'} | {index:N} | {name:'…'}.
export async function setDevicePage(base, body) {
  const r = await devFetch(base, '/page', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();   // {page, name}
}

// POST /update : pousse des valeurs (live preview). payload = {id: valeur, …} (cf. format par type).
export async function pushValues(base, payload) {
  const r = await devFetch(base, '/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return body;   // {ok, updated, unknown}
}

export async function pushLayout(base, layoutText) {
  const r = await devFetch(base, '/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: layoutText
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + r.status);
  return body;
}

// POST /bgimage?key=<hex> : upload d'un fond RGB565 (multipart, streame cote device en LittleFS).
export async function uploadBgImage(base, key, bytes) {
  const fd = new FormData();
  fd.append('img', new Blob([bytes], { type: 'application/octet-stream' }), key + '.565');
  const r = await devFetch(base, '/bgimage?key=' + encodeURIComponent(key), { method: 'POST', body: fd });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// GET /bgimage?key=<hex> : recupere les octets RGB565 (Uint8Array), ou null si 404.
export async function fetchBgImage(base, key) {
  const r = await devFetch(base, '/bgimage?key=' + encodeURIComponent(key));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// POST /image?key=<hex> : upload d'une image placee RGB565A8 (multipart, streame en LittleFS).
export async function uploadImage(base, key, bytes) {
  const fd = new FormData();
  fd.append('img', new Blob([bytes], { type: 'application/octet-stream' }), key + '.565a');
  const r = await devFetch(base, '/image?key=' + encodeURIComponent(key), { method: 'POST', body: fd });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// GET /image?key=<hex> : recupere les octets RGB565A8 (Uint8Array), ou null si 404.
export async function fetchImage(base, key) {
  const r = await devFetch(base, '/image?key=' + encodeURIComponent(key));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// POST /aimg?key=<hex> : upload d'un pack image animee RGB565A8 (multipart, streame en LittleFS).
export async function uploadAimg(base, key, bytes) {
  const fd = new FormData();
  fd.append('img', new Blob([bytes], { type: 'application/octet-stream' }), key + '.565p');
  const r = await devFetch(base, '/aimg?key=' + encodeURIComponent(key), { method: 'POST', body: fd });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

// GET /aimg?key=<hex> : recupere les octets du pack (Uint8Array), ou null si 404.
export async function fetchAimg(base, key) {
  const r = await devFetch(base, '/aimg?key=' + encodeURIComponent(key));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// Présentation de GET /status pour la pastille device (séparée du transport → testable node).
// { label } : court, pour la toolbar (pastille pleine ● + ip). { tooltip } : détail (page 1-based,
// uptime, composants, état de chaque source pull). En Phase 5 le tooltip alimente le `title` de la
// pastille ; en Phase 6 il alimentera la barre d'état. Reprend la mise en forme de l'ancien renderStatus.
export function formatDeviceStatus(s) {
  const srcs = (s.sources || []).map(x =>
    `${x.name || '?'}:${x.last_status === 200 ? 'ok' : (x.err_count ? 'err' : '…')}`).join(' ');
  const label = `● ${s.ip}`;
  const tooltip = `page ${(+s.page) + 1}/${s.pages} · up ${s.uptime_s}s · ${s.components} comp.`
    + (srcs ? ` · sources ${srcs}` : '');
  return { label, tooltip };
}

// Présentation de {vars, sources, sinks, uptime_s} (pull de GET /context + GET /status) pour l'onglet
// Device — séparée du transport → testable node. L'âge se calcule contre l'uptime DEVICE (updated_at/
// fired_at sont des millis() device, pas navigateur). Tolère vars/sources/sinks non conformes (Array.isArray).
export function formatDeviceDump(dump) {
  const d = (dump && typeof dump === 'object') ? dump : {};
  const nowMs = (Number(d.uptime_s) || 0) * 1000;
  const age = (ts) => (Number.isFinite(ts) && ts > 0) ? Math.max(0, Math.round((nowMs - ts) / 1000)) : null;
  const vars = (d.vars && typeof d.vars === 'object' && !Array.isArray(d.vars))
    ? Object.keys(d.vars).sort().map(name => ({ name, value: d.vars[name] }))
    : [];
  const tele = (arr, tsKey) => (Array.isArray(arr) ? arr : []).map(o => {
    const obj = (o && typeof o === 'object') ? o : {};   // élément null/non-objet toléré (réponse firmware partielle)
    return { name: obj.name, status: obj.last_status, errors: obj.err_count || 0, age: age(obj[tsKey]) };
  });
  return { vars, sources: tele(d.sources, 'updated_at'), sinks: tele(d.sinks, 'fired_at') };
}
