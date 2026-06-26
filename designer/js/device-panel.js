// Panneau « Device » : édite les composants physiques (sorties globales : led_ring, sound), HORS pages.
// Ils vivent dans `components` sans placement ; le firmware les pilote globalement. Calqué sur
// sources.js (cards, commit sur 'change', garde-focus). Réutilise les classes CSS src-*.
// led_ring : select de mode, période grisée hors modes animés, valeur d'aperçu (mock, non persistée),
// mini-aperçu des 13 LEDs + bouton ▶ Aperçu (animation à la demande — canvas calme par défaut).
import { COMPONENTS, LED_MODES } from './registry.js';
import { setComponentProp, renameComponent } from './mutations.js';
import { getMock, setMock } from './mocks.js';
import { physicalComponentIds } from './physical.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';
import { showToast } from './toast.js';

function fieldInput(kind, value, onChange) {
  if (kind === 'ledmode') {
    const sel = document.createElement('select');
    for (const [val, txt] of LED_MODES) {
      const o = document.createElement('option'); o.value = val; o.textContent = txt;
      if (val === (value ?? LED_MODES[0][0])) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  const el = document.createElement('input');
  if (kind === 'color') {
    el.type = 'color'; el.value = value || '#FFFFFF';
    el.addEventListener('change', () => onChange(el.value.toUpperCase()));
  } else if (kind === 'num') {
    el.type = 'number'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  } else {
    el.type = 'text'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value));
  }
  return el;
}

function labelled(text, input) {
  const l = document.createElement('label'); l.className = 'src-field';
  const s = document.createElement('span'); s.textContent = text;
  l.appendChild(s); l.appendChild(input);
  return l;
}

export function createDevicePanel(root, model) {
  let previewRaf = null;
  let renamingId = null;   // id de la carte physique en renommage inline, ou null

  const stopPreview = () => { if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; } };

  function render() {
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    // Un bouton focalisé (▶ Aperçu) ne doit PAS bloquer le rebuild.
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    stopPreview();                         // une animation en cours pointerait un nœud bientôt détaché
    root.replaceChildren();
    const comps = model.state.components || {};

    for (const id of physicalComponentIds(model.state)) {
      const c = comps[id];
      const def = COMPONENTS[c.type];
      const liveComp = () => model.state.components[id] || c;   // état vivant : reflète une édition même si le garde-focus bloque un rebuild
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      if (renamingId === id) {
        // Renommage inline de l'id (sert au routage /update). Calqué sur tree.js, MAIS tout passe
        // par le blur : à ce moment le focus a quitté l'input → le garde-focus de render() ne bloque plus.
        const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = id;
        const orig = id;
        let cancelled = false;
        const finish = () => {
          if (renamingId !== id) return;
          const nid = inp.value.trim();
          if (cancelled || !nid || nid === orig) { renamingId = null; render(); return; }        // vide/identique/Échap → annule
          if (model.state.components?.[nid]) { showToast(`L'id « ${nid} » est déjà pris`); renamingId = null; render(); return; }
          renamingId = null;
          model.commit(s => renameComponent(s, orig, nid));   // → subscribe → render()
        };
        inp.addEventListener('input', () => {
          const v = inp.value.trim();
          inp.classList.toggle('invalid', !!v && v !== orig && !!model.state.components?.[v]);
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; inp.blur(); }
        });
        inp.addEventListener('blur', finish);
        head.appendChild(inp);
        queueMicrotask(() => { inp.focus(); inp.select(); });
      } else {
        const title = document.createElement('span'); title.className = 'src-title';
        title.textContent = `${id} · ${def.label}`;
        title.title = "Double-cliquer pour renommer l'id";
        title.addEventListener('dblclick', () => { renamingId = id; render(); });
        head.appendChild(title);
      }
      card.appendChild(head);
      if (c.type === 'sound') {
        const note = document.createElement('div'); note.className = 'src-note';
        note.textContent = 'Déclenché via /update : {tone, ms} ou {name: ok|alert|error}';
        card.appendChild(note);
      }

      const rows = [];                       // pour le grisage enableWhen
      for (const [key, label, kind, enableWhen] of (def.compFields || [])) {
        const row = labelled(label, fieldInput(kind, c[key], v => model.commit(s => setComponentProp(s, id, key, v))));
        rows.push({ row, enableWhen });
        card.appendChild(row);
      }
      const syncEnabled = () => {
        const cc = liveComp();
        for (const { row, enableWhen } of rows) {
          if (!enableWhen) continue;
          const ok = enableWhen(cc);
          row.classList.toggle('disabled', !ok);
          const f = row.querySelector('input, select'); if (f) f.disabled = !ok;
        }
      };
      // Repeint le mini-aperçu (frame statique) SANS rebuild → reste à jour même quand le garde-focus
      // bloque render() (un champ a le focus, ex. le select de mode). No-op pendant l'animation ▶ (previewRaf actif).
      const updateMini = () => {
        if (previewRaf) return;
        const miniEl = card.querySelector('.led-ring-mini');
        if (miniEl) paintRing(miniEl, ledFrame(liveComp(), getMock(id, c.type)));
      };
      syncEnabled();
      card.addEventListener('change', () => { syncEnabled(); updateMini(); });   // mode/couleur/luminosité/valeur → période + mini réactifs

      // --- led_ring : valeur d'aperçu (mock) + mini-aperçu animable ---
      if (def.mockFields?.length) {
        const m = getMock(id, c.type);
        for (const [key, label] of def.mockFields) {
          card.appendChild(labelled(label, fieldInput('num', m[key], v => {
            setMock(id, { [key]: v === '' ? 0 : v });   // le mini se met à jour via le listener 'change' de la carte
          })));
        }
      }
      if (c.type === 'led_ring') {
        const mini = document.createElement('div'); mini.className = 'led-ring-mini';
        paintRing(mini, ledFrame(liveComp(), getMock(id, 'led_ring')));
        card.appendChild(mini);

        const play = document.createElement('button'); play.className = 'src-add'; play.textContent = '▶ Aperçu';   // réutilise le style src-add (bouton plein)
        play.addEventListener('click', () => {
          if (previewRaf) { stopPreview(); play.textContent = '▶ Aperçu'; paintRing(mini, ledFrame(liveComp(), getMock(id, 'led_ring'))); return; }
          play.textContent = '⏸ Aperçu';
          const loop = () => { paintRing(mini, ledFrameAt(liveComp(), getMock(id, 'led_ring'), performance.now())); previewRaf = requestAnimationFrame(loop); };
          loop();
        });
        card.appendChild(play);
      }

      root.appendChild(card);
    }

  }

  model.subscribe(render);
  render();
  return { render };
}
