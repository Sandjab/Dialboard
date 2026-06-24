// Panneau « Device » : édite les composants physiques (sorties globales : led_ring, sound), HORS pages.
// Ils vivent dans `components` sans placement ; le firmware les pilote globalement. Calqué sur
// sources.js (cards, commit sur 'change', garde-focus). Réutilise les classes CSS src-*.
// led_ring : select de mode, période grisée hors modes animés, valeur d'aperçu (mock, non persistée),
// mini-aperçu des 13 LEDs + bouton ▶ Aperçu (animation à la demande — canvas calme par défaut).
import { COMPONENTS, LED_MODES } from './registry.js';
import { setComponentProp } from './mutations.js';
import { getMock, setMock } from './mocks.js';
import { physicalTypes, physicalComponentIds, addPhysicalComponent, removeComponent, canAddType } from './physical.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';

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

export function createDevicePanel(root, model, { onPreview } = {}) {
  let previewRaf = null;
  const stopPreview = () => { if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; } };

  function render() {
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    // Un bouton focalisé (Ajouter/Supprimer) ne doit PAS bloquer : Chrome focalise le bouton au clic,
    // sinon l'ajout/suppression de led_ring/sound ne se reflète pas immédiatement.
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    stopPreview();                         // une animation en cours pointerait un nœud bientôt détaché
    root.replaceChildren();
    const comps = model.state.components || {};

    for (const id of physicalComponentIds(model.state)) {
      const c = comps[id];
      const def = COMPONENTS[c.type];
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = `${id} · ${def.label}`;
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = 'Supprimer';
      del.addEventListener('click', () => model.commit(s => removeComponent(s, id)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      const rows = [];                       // pour le grisage enableWhen
      for (const [key, label, kind, enableWhen] of (def.compFields || [])) {
        const row = labelled(label, fieldInput(kind, c[key], v => model.commit(s => setComponentProp(s, id, key, v))));
        rows.push({ row, enableWhen });
        card.appendChild(row);
      }
      const syncEnabled = () => {
        const cc = model.state.components[id]; if (!cc) return;
        for (const { row, enableWhen } of rows) {
          if (!enableWhen) continue;
          const ok = enableWhen(cc);
          row.classList.toggle('disabled', !ok);
          const f = row.querySelector('input, select'); if (f) f.disabled = !ok;
        }
      };
      syncEnabled();
      card.addEventListener('change', syncEnabled);   // changer le mode réévalue la période

      // --- led_ring : valeur d'aperçu (mock) + mini-aperçu animable ---
      if (def.mockFields?.length) {
        const m = getMock(id, c.type);
        for (const [key, label] of def.mockFields) {
          card.appendChild(labelled(label, fieldInput('num', m[key], v => {
            setMock(id, { [key]: v === '' ? 0 : v });
            render();          // re-peint le mini-aperçu (frame statique)
            onPreview?.();     // re-peint le liseré du canvas
          })));
        }
      }
      if (c.type === 'led_ring') {
        const liveComp = () => model.state.components[id] || c;   // état vivant : reflète un changement de mode même si le garde-focus bloque un rebuild
        const mini = document.createElement('div'); mini.className = 'led-ring-mini';
        paintRing(mini, ledFrame(c, getMock(id, 'led_ring')));
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

    for (const type of physicalTypes()) {
      const add = document.createElement('button'); add.className = 'src-add';
      add.textContent = '+ ' + COMPONENTS[type].label;
      add.disabled = !canAddType(model.state, type);
      add.addEventListener('click', () => model.commit(s => addPhysicalComponent(s, type)));
      root.appendChild(add);
    }
  }

  model.subscribe(render);
  render();
  return { render };
}
