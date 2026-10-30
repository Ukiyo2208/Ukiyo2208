// Vérifie la syntaxe de tous les scripts (écran, serveur, pont) : « npm run check »
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.git|livrable|data)$/.test(e.name)) walk(p); } else if (/\.(c|m)?js$/.test(e.name)) files.push(p); });
['js', 'server', 'bridge', 'tests', 'tools'].forEach(d => { if (fs.existsSync(path.join(root, d))) walk(path.join(root, d)); });
files.push(path.join(root, 'sw.js'));
const bad = files.filter(f => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0).map(f => path.relative(root, f));
if (bad.length) { console.error('Erreur de syntaxe : ' + bad.join(', ')); process.exit(1); }
console.log('Syntaxe OK (' + files.length + ' fichiers)');
