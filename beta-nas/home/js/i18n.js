/* Bêta home — langue de l'interface (français par défaut, anglais en option : Paramètres › Cet écran, ou l'assistant).
   L'interface est écrite en français ; en anglais, les textes affichés sont remplacés à la volée d'après js/i18n-en.js,
   y compris les dates. Les phrases non encore traduites restent en français. */
(function () {
  let lang = 'fr'; try { lang = localStorage.getItem('betaos.lang') || 'fr'; } catch (e) { }
  window.BETA_LANG = lang;
  window.betaSetLang = l => { try { localStorage.setItem('betaos.lang', l); } catch (e) { } location.reload(); };
  if (lang !== 'en' || !window.BETA_EN) return;
  document.documentElement.lang = 'en';
  const D = window.BETA_EN;
  // quelques phrases variables
  const PAT = [
    [/^(\d+) appareil\(s\)(.*)$/, (m, n, r) => n + ' device(s)' + r], [/^(\d+) appareils?$/, (m, n) => n + (n === '1' ? ' device' : ' devices')], [/^(\d+) pièces?$/, (m, n) => n + (n === '1' ? ' room' : ' rooms')],
    [/^il y a (\d+) min$/, (m, n) => n + ' min ago'], [/^il y a (\d+) h$/, (m, n) => n + ' h ago'], [/^à l’instant$/, () => 'just now'], [/^Contrôlez et gérez votre (.+)$/, (m, x) => 'Control and manage your ' + (D[x] || x)],
[/^(\d+) détecteur\(s\)$/, (m, n) => n + ' sensor(s)'], [/^(\d+)\/(\d+) affichées$/, (m, a, b) => a + '/' + b + ' shown'], [/^(\d+) marques? trouvées? chez vous$/, (m, n) => n + ' brand(s) found in your home']
  ];
  const tr = s => {
    const t = s.trim(); if (!t || t.length > 300) return null;
    if (D[t] != null) return s.replace(t, D[t]);
    for (const [re, fn] of PAT) { const m = t.match(re); if (m) { const r = fn(...m); if (r !== t) return s.replace(t, r); } }
    return null;
  };
  const ATTR = ['placeholder', 'title', 'aria-label'];
  function walk(n) {
    if (n.nodeType === 3) { const r = tr(n.nodeValue); if (r != null && r !== n.nodeValue) n.nodeValue = r; return; }
    if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.isContentEditable || n.tagName === 'TEXTAREA') return;
    ATTR.forEach(a => { const v = n.getAttribute && n.getAttribute(a); if (v) { const r = tr(v); if (r != null && r !== v) n.setAttribute(a, r); } });
    if (n.tagName === 'INPUT' && /^(button|submit)$/.test(n.type) && n.value) { const r = tr(n.value); if (r) n.value = r; }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  const obs = new MutationObserver(list => list.forEach(m => { if (m.type === 'characterData') walk(m.target); else m.addedNodes.forEach(walk); }));
  const start = () => { walk(document.body); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); const t = tr(document.title); if (t) document.title = t; };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // dates et heures en anglais
  const fix = f => function (loc, o) { return f.call(this, loc === 'fr-FR' || loc === 'fr' || loc === undefined ? 'en-GB' : loc, o); };
  Date.prototype.toLocaleDateString = fix(Date.prototype.toLocaleDateString);
  Date.prototype.toLocaleTimeString = fix(Date.prototype.toLocaleTimeString);
  Date.prototype.toLocaleString = fix(Date.prototype.toLocaleString);
})();
