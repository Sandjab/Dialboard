import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueId, addComponent, addPlacement, removePlacement,
  setComponentProp, setPlacementProp, setThresholds,
  addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken,
  setPageBackground, effectivePageBg,
  setPageBackgroundImage, effectivePageBgImage,
  placeComponentCopy,
  duplicateComponent,
  removePlacementAndOrphan
} from '../js/mutations.js';

const fresh = () => ({ components: {}, pages: [{ name: 'P1', place: [] }] });

test('uniqueId incrémente par type', () => {
  const s = fresh();
  assert.equal(uniqueId(s, 'label'), 'label1');
  s.components.label1 = { type: 'label' };
  assert.equal(uniqueId(s, 'label'), 'label2');
});

test('uniquePageName : aucune collision « Page N » → Page 1', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Accueil' }] }), 'Page 1');
});

test('uniquePageName : incrémente au-delà des « Page N » existants', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 2' }] }), 'Page 3');
});

test('uniquePageName : réutilise un trou (Page 2 libre)', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 3' }] }), 'Page 2');
});

test('uniquePageName : évite un nom auto saisi à la main au renommage', () => {
  // renommage manuel libre, mais la création suivante ne doit pas entrer en collision
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 1' }] }), 'Page 2');
});

test('uniquePageName : state sans pages → Page 1', () => {
  assert.equal(uniquePageName({}), 'Page 1');
});

test('pageNameTaken : nom porté par une autre page → true', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'B', 0), true);
});

test('pageNameTaken : la page elle-même (exceptIndex) ne compte pas → false', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'B', 1), false);
});

test('pageNameTaken : nom libre → false', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'C', 0), false);
});

test('pageNameTaken : comparaison exacte (casse, comme le strcmp firmware)', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'Vue CPU' }, { name: 'X' }] }, 'vue cpu', 1), false);
});

test('setPageBackground : définit l’override de la page', () => {
  const s = fresh();
  setPageBackground(s, 0, '#102030');
  assert.equal(s.pages[0].background, '#102030');
});

test('setPageBackground : vide/null supprime l’override (héritage)', () => {
  const s = fresh(); s.pages[0].background = '#102030';
  setPageBackground(s, 0, null);
  assert.equal('background' in s.pages[0], false);
});

test('setPageBackground : index invalide → no-op (pas de throw)', () => {
  const s = fresh();
  assert.doesNotThrow(() => setPageBackground(s, 9, '#FFFFFF'));
});

test('effectivePageBg : override de la page prioritaire', () => {
  const s = { background: '#0B0B0F', pages: [{ name: 'P1', place: [], background: '#102030' }] };
  assert.equal(effectivePageBg(s, 0), '#102030');
});

test('effectivePageBg : sans override → fond global', () => {
  const s = { background: '#0B0B0F', pages: [{ name: 'P1', place: [] }] };
  assert.equal(effectivePageBg(s, 0), '#0B0B0F');
});

test('effectivePageBg : sans override ni global → #000000', () => {
  assert.equal(effectivePageBg({ pages: [{ name: 'P1', place: [] }] }, 0), '#000000');
});

test('setPageBackgroundImage : pose la clé', () => {
  const s = fresh();
  setPageBackgroundImage(s, 0, 'abc123');
  assert.equal(s.pages[0].background_image, 'abc123');
});

test('setPageBackgroundImage : vide/null supprime la clé', () => {
  const s = fresh(); s.pages[0].background_image = 'abc123';
  setPageBackgroundImage(s, 0, null);
  assert.equal('background_image' in s.pages[0], false);
});

test('setPageBackgroundImage : index invalide → no-op (pas de throw)', () => {
  const s = fresh();
  assert.doesNotThrow(() => setPageBackgroundImage(s, 9, 'abc123'));
});

test('effectivePageBgImage : clé de la page', () => {
  const s = { pages: [{ name: 'P1', place: [], background_image: 'abc123' }] };
  assert.equal(effectivePageBgImage(s, 0), 'abc123');
});

test('effectivePageBgImage : sans clé → null (pas de fond image global)', () => {
  const s = { pages: [{ name: 'P1', place: [] }] };
  assert.equal(effectivePageBgImage(s, 0), null);
});

test('addComponent ajoute à la map components', () => {
  const s = fresh();
  addComponent(s, 'x', { type: 'label', text: 'Hi' });
  assert.deepEqual(s.components.x, { type: 'label', text: 'Hi' });
});

test('addPlacement pousse sur la page', () => {
  const s = fresh();
  addPlacement(s, 0, { ref: 'x', anchor: 'CENTER' });
  assert.equal(s.pages[0].place.length, 1);
  assert.equal(s.pages[0].place[0].ref, 'x');
});

test('removePlacement retire par index', () => {
  const s = fresh();
  s.pages[0].place = [{ ref: 'a' }, { ref: 'b' }];
  removePlacement(s, 0, 0);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['b']);
});

test('setComponentProp pose une valeur, vide la supprime', () => {
  const s = fresh();
  s.components.x = { type: 'label' };
  setComponentProp(s, 'x', 'text', 'Hi');
  assert.equal(s.components.x.text, 'Hi');
  setComponentProp(s, 'x', 'text', '');
  assert.equal('text' in s.components.x, false);
});

test('setPlacementProp pose une valeur, vide la supprime', () => {
  const s = fresh();
  s.pages[0].place = [{ ref: 'x', dx: 5 }];
  setPlacementProp(s, 0, 0, 'dy', 12);
  assert.equal(s.pages[0].place[0].dy, 12);
  setPlacementProp(s, 0, 0, 'dx', '');
  assert.equal('dx' in s.pages[0].place[0], false);
});

test('setThresholds pose un tableau non vide, vide le supprime', () => {
  const s = fresh();
  s.components.x = { type: 'ring' };
  setThresholds(s, 'x', [[20, '#FF0000']]);
  assert.deepEqual(s.components.x.thresholds, [[20, '#FF0000']]);
  setThresholds(s, 'x', []);
  assert.equal('thresholds' in s.components.x, false);
});

test('setComponentProp ignore un id inconnu', () => {
  const s = fresh();
  setComponentProp(s, 'missing', 'text', 'Hi'); // ne doit pas throw
  assert.deepEqual(s.components, {});
});

test('setPlacementProp ignore un index hors borne', () => {
  const s = fresh();
  setPlacementProp(s, 0, 99, 'dy', 10); // place index hors borne : ne doit pas throw
  setPlacementProp(s, 99, 0, 'dy', 10); // page index hors borne : ne doit pas throw (parité add/removePlacement)
  assert.equal(s.pages[0].place.length, 0);
});

test('addPage ajoute une page vide nommée en fin de liste', () => {
  const s = fresh();
  addPage(s, 'P2');
  assert.equal(s.pages.length, 2);
  assert.deepEqual(s.pages[1], { name: 'P2', place: [] });
});

test('removePage retire la page par index', () => {
  const s = fresh();
  addPage(s, 'P2');
  removePage(s, 0);
  assert.deepEqual(s.pages.map(p => p.name), ['P2']);
});

test('renamePage change le nom de la page', () => {
  const s = fresh();
  renamePage(s, 0, 'Accueil');
  assert.equal(s.pages[0].name, 'Accueil');
});

test('reorderPages déplace from → to', () => {
  const s = fresh();
  addPage(s, 'P2'); addPage(s, 'P3');          // [P1, P2, P3]
  reorderPages(s, 0, 2);                        // [P2, P3, P1]
  assert.deepEqual(s.pages.map(p => p.name), ['P2', 'P3', 'P1']);
});

test('reorderPages ignore les index hors bornes (no-op)', () => {
  const s = fresh();
  addPage(s, 'P2');                             // [P1, P2]
  reorderPages(s, 0, 5);
  assert.deepEqual(s.pages.map(p => p.name), ['P1', 'P2']);
});

import {
  uniqueSourceName, addSource, removeSource,
  setSourceProp, setSourceHeaders, setSourceVars
} from '../js/mutations.js';

test('addSource ajoute une source nommee avec interval par defaut', () => {
  const s = { components: {}, pages: [] };
  addSource(s, 'weather');
  assert.deepEqual(s.sources, [{ name: 'weather', interval_s: 60 }]);
});

test('uniqueSourceName evite les collisions', () => {
  const s = { sources: [{ name: 'source1' }, { name: 'source2' }] };
  assert.equal(uniqueSourceName(s), 'source3');
  assert.equal(uniqueSourceName({}), 'source1');
});

test('setSourceProp pose une valeur, vide => supprime la cle', () => {
  const s = { sources: [{ name: 'a', interval_s: 60 }] };
  setSourceProp(s, 0, 'url', 'http://x');
  assert.equal(s.sources[0].url, 'http://x');
  setSourceProp(s, 0, 'url', '');
  assert.equal('url' in s.sources[0], false);
});

test('setSourceHeaders/setSourceVars remplacent ou suppriment', () => {
  const s = { sources: [{ name: 'a' }] };
  setSourceHeaders(s, 0, { 'X-Key': '$k' });
  assert.deepEqual(s.sources[0].headers, { 'X-Key': '$k' });
  setSourceHeaders(s, 0, {});
  assert.equal('headers' in s.sources[0], false);
  setSourceVars(s, 0, { temp: '/t' });
  assert.deepEqual(s.sources[0].vars, { temp: '/t' });
  setSourceVars(s, 0, {});
  assert.equal('vars' in s.sources[0], false);
});

test('removeSource retire par index', () => {
  const s = { sources: [{ name: 'a' }, { name: 'b' }] };
  removeSource(s, 0);
  assert.deepEqual(s.sources, [{ name: 'b' }]);
});

test('setSourceProp / setSourceHeaders no-op sur index invalide', () => {
  const s = { sources: [] };
  setSourceProp(s, 3, 'url', 'http://x');   // ne doit pas throw
  setSourceHeaders(s, 3, { a: 'b' });
  assert.deepEqual(s.sources, []);
});

test('placeComponentCopy : id neuf, copie indépendante, offset, ref re-pointé', () => {
  const s = fresh();
  s.components.bar1 = { type: 'bar', color: '#38BDF8', label: 'CPU' };
  const placement = { ref: 'bar1', anchor: 'CENTER', dx: 10, dy: 20 };
  const idx = placeComponentCopy(s, 0, s.components.bar1, placement);

  assert.equal(idx, 0);                              // index = dernier placement de la page
  const copy = s.pages[0].place[0];
  assert.equal(copy.ref, 'bar2');                    // uniqueId(bar), bar1 pris
  assert.equal(copy.dx, 18);                         // 10 + 8
  assert.equal(copy.dy, 28);                         // 20 + 8
  s.components.bar2.color = '#FF0000';
  assert.equal(s.components.bar1.color, '#38BDF8');  // original intact (copie indépendante)
});

test('placeComponentCopy : placement sans dx/dy → offset depuis 0', () => {
  const s = fresh();
  s.components.label1 = { type: 'label', text: 'Hi' };
  const idx = placeComponentCopy(s, 0, s.components.label1, { ref: 'label1', anchor: 'CENTER' });
  assert.equal(idx, 0);
  assert.equal(s.pages[0].place[0].dx, 8);
  assert.equal(s.pages[0].place[0].dy, 8);
});

test('placeComponentCopy : page absente → -1', () => {
  const s = fresh();
  assert.equal(placeComponentCopy(s, 9, { type: 'label' }, { ref: 'x' }), -1);
});

test('placeComponentCopy : compDef absent → -1', () => {
  const s = fresh();
  assert.equal(placeComponentCopy(s, 0, null, { ref: 'x' }), -1);
});

test('placeComponentCopy : placement absent → -1', () => {
  const s = fresh();
  assert.equal(placeComponentCopy(s, 0, { type: 'label' }, null), -1);
});

test('duplicateComponent : copie indépendante depuis un placement existant', () => {
  const s = fresh();
  s.components.label1 = { type: 'label', text: 'Bonjour' };
  s.pages[0].place.push({ ref: 'label1', anchor: 'CENTER', dx: 0, dy: 0 });
  const idx = duplicateComponent(s, 0, 0);

  assert.equal(idx, 1);                               // ajouté après l'original
  assert.equal(s.pages[0].place[1].ref, 'label2');
  assert.equal(s.components.label2.text, 'Bonjour');  // contenu copié
  s.components.label2.text = 'Modifié';
  assert.equal(s.components.label1.text, 'Bonjour');  // original intact
});

test('duplicateComponent : placeIndex invalide → -1, aucun ajout', () => {
  const s = fresh();
  assert.equal(duplicateComponent(s, 0, 5), -1);
  assert.equal(s.pages[0].place.length, 0);
});

test('removePlacementAndOrphan : 1:1 → retire le placement ET le composant', () => {
  const s = fresh();
  s.components.bar1 = { type: 'bar' };
  s.pages[0].place.push({ ref: 'bar1', anchor: 'CENTER' });
  removePlacementAndOrphan(s, 0, 0);
  assert.equal(s.pages[0].place.length, 0);
  assert.equal(s.components.bar1, undefined);
});

test('removePlacementAndOrphan : composant encore référencé ailleurs → conservé', () => {
  const s = { components: { bar1: { type: 'bar' } },
              pages: [{ name: 'P1', place: [{ ref: 'bar1' }] },
                      { name: 'P2', place: [{ ref: 'bar1' }] }] };
  removePlacementAndOrphan(s, 0, 0);                  // retire l'occurrence page 1
  assert.equal(s.pages[0].place.length, 0);
  assert.ok(s.components.bar1);                       // page 2 l'utilise encore → conservé
});

test('removePlacementAndOrphan : composant physique jamais supprimé', () => {
  const s = fresh();
  s.components.led_ring1 = { type: 'led_ring' };
  s.pages[0].place.push({ ref: 'led_ring1' });        // cas théorique (un physique placé)
  removePlacementAndOrphan(s, 0, 0);
  assert.equal(s.pages[0].place.length, 0);
  assert.ok(s.components.led_ring1);                  // physique → conservé
});
