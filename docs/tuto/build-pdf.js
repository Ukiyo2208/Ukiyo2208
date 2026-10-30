// Génère les tutoriels PDF à partir des pages HTML de ce dossier : node docs/tuto/build-pdf.js
// (nécessite Playwright et Chromium ; les captures sont dans docs/img)
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const DOCS = [['guide.html', 'Guide-Beta-home.pdf', 'Guide d’utilisation'], ['docker.html', 'Installer-Beta-home-Docker.pdf', 'Installer Bêta home sur Docker']];
(async () => {
  const b = await chromium.launch();
  for (const [src, out, title] of DOCS) {
    const p = await b.newPage();
    await p.goto('file://' + path.join(__dirname, src), { waitUntil: 'load' });
    await p.pdf({
      path: path.join(__dirname, '..', out), format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font:8px Arial,sans-serif;color:#8a96ab;padding:0 15mm;display:flex;justify-content:space-between"><span>Bêta home 7.17 · ' + title + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
    });
    console.log('docs/' + out); await p.close();
  }
  await b.close();
})();
