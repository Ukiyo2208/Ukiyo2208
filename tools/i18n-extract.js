// Bêta home — extrait toutes les phrases françaises affichées par l'interface (js/*.js) dans i18n/phrases-fr.json.
// Usage : node tools/i18n-extract.js   → sert de liste à traduire (i18n/en.js contient la traduction anglaise).
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'js'), out = new Map();
const FR = /[éèêàâçùûôîïœ’]|\b(le|la|les|des|du|une|un|et|ou|pour|avec|sans|dans|sur|votre|vos|cet|cette|ce|pas|plus|tout|tous)\b/i;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  // chaînes entre apostrophes droites, sans balises ni code
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){2,200})'/g)) {
    let s = m[1].replace(/\\'/g, "'");
    s.split(/<[^>]+>/).map(x => x.trim()).filter(Boolean).forEach(t => {
      if (t.length < 2 || !/[A-Za-zÀ-ÿ]{2}/.test(t) || /^[\w.-]+$/.test(t) && !FR.test(t) || /[{}();=]|=>|\$\{|^\.|^#|^\/|^https?:|^data-|^--/.test(t) || !FR.test(t) && !/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t)) return;
      if (!out.has(t)) out.set(t, f);
    });
  }
}
const list = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([t, f]) => ({ t, f }));
fs.writeFileSync(path.join(__dirname, '..', 'i18n', 'phrases-fr.json'), JSON.stringify(list, null, 1));
console.log(list.length + ' phrases extraites → i18n/phrases-fr.json');
