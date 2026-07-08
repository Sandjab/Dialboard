// Catalogue de scènes animées — MIROIR de src/scenes.cpp (parité designer↔firmware).
// Toute modification ici doit être répliquée là-bas (et inversement) ; les tests (scenes.test.js
// + tests natifs) et l'enum schéma `sceneName` verrouillent la parité des NOMS et des points de contrôle.
// Anims : static | rotate | translate_loop | drift | pulse | swing | flash. Rôle : principal | accent.

const TAU = 2 * Math.PI;

// L(symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase)
const L = (symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase = 0) =>
  ({ symbol, cx, cy, scaleRel, role, accent, anim, period, amp, phase });

export const SCENES = {
  sunny:   { color: '#F5A623', layers: [ L('weather-sunny', 50, 50, 0.90, 'principal', 0, 'rotate', 7000, 0) ] },
  rain:    { color: '#3B82F6', layers: [
    L('weather-cloudy', 50, 38, 0.72, 'accent', '#8892A0', 'static', 1000, 0),
    L('water', 34, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 0),
    L('water', 50, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 360),
    L('water', 66, 66, 0.30, 'principal', 0, 'translate_loop', 1100, 22, 720) ] },
  snow:    { color: '#93B4D8', layers: [
    L('weather-cloudy', 50, 38, 0.72, 'accent', '#8892A0', 'static', 1000, 0),
    L('snowflake', 34, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 0),
    L('snowflake', 50, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 740),
    L('snowflake', 66, 66, 0.26, 'principal', 0, 'translate_loop', 2200, 20, 1480) ] },
  storm:   { color: '#8892A0', layers: [
    L('weather-cloudy', 50, 38, 0.74, 'principal', 0, 'static', 1000, 0),
    L('lightning-bolt', 52, 70, 0.42, 'accent', '#F5C518', 'flash', 1800, 0) ] },
  wind:    { color: '#8892A0', layers: [ L('weather-windy', 50, 50, 0.82, 'principal', 0, 'drift', 3800, 7) ] },
  spinner: { color: '#6C7BF2', layers: [ L('refresh', 50, 50, 0.80, 'principal', 0, 'rotate', 1100, 0) ] },
  alert:   { color: '#EF4444', layers: [ L('alert', 50, 50, 0.86, 'principal', 0, 'pulse', 1400, 0.18) ] },
  bell:    { color: '#F5A623', layers: [ L('bell-ring', 50, 46, 0.84, 'principal', 0, 'swing', 900, 16) ] },
  pulse:   { color: '#22A06B', layers: [ L('broadcast', 50, 50, 0.86, 'principal', 0, 'pulse', 1100, 0.16) ] },
};

// Ordre canonique (== ordre de SCENE_CATALOG côté firmware ; verrouille la parité des index).
export const SCENE_NAMES = ['sunny', 'rain', 'snow', 'storm', 'wind', 'spinner', 'alert', 'bell', 'pulse'];

export function sceneDefaultColor(name) { return SCENES[name]?.color || '#FFFFFF'; }
export function sceneLayerColor(layer, principal) { return layer.role === 'accent' ? layer.accent : principal; }

// Frame PURE (miroir scene_frame_at) : rend un tableau de { cx, cy, angleDdeg, scale, opa } par couche.
// name inconnu -> []. Pure, sans DOM.
export function sceneFrameAt(name, tMs) {
  const s = SCENES[name];
  if (!s) return [];
  return s.layers.map(L => {
    const f = { cx: L.cx, cy: L.cy, angleDdeg: 0, scale: 1, opa: 255 };
    const per = L.period || 1000;
    const ph = ((tMs + L.phase) % per) / per;                 // 0..1
    switch (L.anim) {
      case 'rotate': f.angleDdeg = Math.trunc(ph * 3600); break;
      case 'translate_loop':
        f.cy = L.cy - L.amp + 2 * L.amp * ph;
        f.opa = Math.round(255 * (ph < 0.15 ? ph / 0.15 : ph > 0.85 ? (1 - ph) / 0.15 : 1));
        break;
      case 'drift': f.cx = L.cx + L.amp * Math.sin(TAU * ph); break;
      case 'pulse': { const k = 0.5 * (1 - Math.cos(TAU * ph)); f.scale = 1 + L.amp * k; f.opa = Math.round(255 * (0.6 + 0.4 * k)); break; }
      case 'swing': f.angleDdeg = Math.trunc(L.amp * 10 * Math.sin(TAU * ph)); break;
      case 'flash': f.opa = (ph < 0.10 || (ph > 0.16 && ph < 0.24)) ? 255 : 45; break;
      // static -> neutre
    }
    return f;
  });
}
