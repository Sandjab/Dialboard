// site/lang.js — bascule bilingue « un fichier par langue » (EN défaut, FR = *.fr.html).
// Aucune traduction stockée ici : le texte vit dans chaque fichier HTML.
// Helpers purs (testés node) + initToggle (câblage navigateur, browser-verified).
// La redirection au premier rendu est faite par un court script inline en <head>
// (anti-FOUC) ; ce module ne gère QUE l'état + le clic de la bascule.

const KEY = 'dboard.lang';

// Langue de la page courante d'après son chemin ; un chemin-répertoire ('…/') = index EN.
export function currentLang(pathname) {
  return /\.fr\.html$/.test(pathname) ? 'fr' : 'en';
}

// Langue à servir : choix mémorisé prioritaire, sinon navigateur (fr seulement si « fr… »), défaut en.
export function pickLanguage(saved, navLang) {
  if (saved === 'fr' || saved === 'en') return saved;
  return String(navLang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// Chemin du fichier jumeau pour la langue cible ; gère le chemin-répertoire comme index.html.
export function siblingHref(pathname, lang) {
  const p = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const en = p.replace(/\.fr\.html$/, '.html');       // normalise vers la base EN
  return lang === 'fr' ? en.replace(/\.html$/, '.fr.html') : en;
}

// Câblage navigateur : reflète la langue active sur la bascule + clic = mémorise & navigue.
export function initToggle(win = window) {
  const here = currentLang(win.location.pathname);
  win.document.documentElement.lang = here;
  const wire = () => {
    win.document.querySelectorAll('[data-lang]').forEach((btn) => {
      const l = btn.getAttribute('data-lang');
      btn.classList.toggle('on', l === here);
      btn.setAttribute('aria-pressed', String(l === here));
      btn.addEventListener('click', () => {
        win.localStorage.setItem(KEY, l);
        const target = siblingHref(win.location.pathname, l);
        if (target !== win.location.pathname) win.location.assign(target);
      });
    });
  };
  if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', wire);
  else wire();
}

// Effet de bord uniquement en navigateur (import node = sans effet → helpers testables).
if (typeof window !== 'undefined' && typeof document !== 'undefined') initToggle();
