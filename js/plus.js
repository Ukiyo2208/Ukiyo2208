/* Bêta home 7.12 — côté écran :
   - Paramètres › Outils : sauvegarde chiffrée et restauration, mises à jour, iPhone (Siri et widgets), arrosage,
     détection Frigate, simulation de présence, tarif électricité, profils enfants
   - Routines : journal des règles (« bloquée car… ») et mode test (simuler un évènement)
   - pages Scènes (par pièce et par moment, lumière adaptative), Chauffage (zones, planning) et Listes (courses, tâches, messages)
   - Énergie : coûts en euros par jour et par appareil */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok() && !P.noPlus;   // serveur Bêta joignable et module « plus » présent (sinon : repli sur cet écran)
  const mod = id => !id || !B.modOn || B.modOn(id);   // module activé (Paramètres › Modules)
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const req = (p, b, m) => B.Server.req(p, b, m);
  const hubMap = () => S.settings.hubMap || {};
  const hubDevs = f => (B.nasDevs ? B.nasDevs() : Object.keys(hubMap()).filter(id => DATA.DEVICES[id]).map(id => Object.assign({ id, k: B.kindOf(DATA.DEVICES[id]) }, DATA.DEVICES[id]))).filter(f || (() => true));
  const dlabel = d => (d.room ? d.room + ' · ' : '') + d.name;
  const P = B.P = { cfg: null, state: null, lists: null, board: [], cams: null };
  async function load() { if (!(B.Server && B.Server.ok())) return null; try { const r = await req('/api/plus'); P.state = r.state; delete r.state; P.cfg = r; P.noPlus = false; } catch (e) { if (/route inconnue|404/.test(e.message)) { P.noPlus = true; loadLists(); } } B.emit('plus'); return P.cfg; }
  const save = async patch => { try { const r = await req('/api/plus', patch, 'PUT'); P.cfg = Object.assign(P.cfg || {}, r); B.emit('plus'); return true; } catch (e) { B.toast('Serveur Bêta : ' + e.message, 'info'); return false; } };
  setTimeout(load, 3000);
  const need = () => { if (!srv()) { B.toast('Serveur Bêta du NAS nécessaire (Connexions)', 'server'); return false; } return true; };
  const needAdmin = () => { if (!isAdmin()) { B.toast('Réservé aux administrateurs', 'lock'); return false; } return need(); };
  const sw = (act, on, label, arg) => '<label class="row tbsw"><button type="button" class="sw sm' + (on ? ' on' : '') + '" data-act="' + act + '"' + (arg ? ' data-arg="' + arg + '"' : '') + '></button><span>' + label + '</span></label>';
  const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const daysPick = (act, arg, days) => '<span class="rldays">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="pinc' + ((days || []).includes(d) ? ' on' : '') + '" data-act="' + act + '" data-arg="' + arg + '|' + d + '">' + DAYS[d] + '</button>').join('') + '</span>';
  const togDay = (list, d) => { const l = (list || []).slice(), i = l.indexOf(d); i >= 0 ? l.splice(i, 1) : l.push(d); return l; };
  const modal = (cls, html) => { const m = document.querySelector('.' + cls); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + html; m.scrollTop = sc; } else B.modal(html, 'wide ' + cls); };
  const ck = (act, arg, on, label) => '<label class="rlck"><input type="checkbox" data-change="' + act + '" data-arg="' + esc(arg) + '"' + (on ? ' checked' : '') + '>' + label + '</label>';
  const eur = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €', kwh = v => (v >= 10 ? Math.round(v) : (+v).toFixed(1)).toString().replace('.', ',') + ' kWh';

  /* ---------- évènements du NAS (relayés par brain.js) ---------- */
  B.on && B.on('nas', async ev => {
    if (ev.type === 'lists') loadLists();
    if (ev.type === 'scene') { const c = await B.Server.post('/api/engine/claim', { t: ev.t, type: 'scene' }).catch(() => ({})); if (c.ok) applyScene(scenes().find(s => s.id === ev.id), true); }
    if (ev.type === 'detect' && B.current === 'exterieur') B.toast('Caméra ' + String(ev.cam).replace(/_/g, ' ') + ' : ' + ({ person: 'personne', car: 'voiture' }[ev.label] || ev.label), 'cctv');
  });

  /* ======================= OUTILS (Paramètres) ======================= */
  const TOOLS = [['bkOpen', 'cloudUp', 'Sauvegarde', 'Fichier chiffré, restauration, copie chaque nuit'], ['upOpen', 'download', 'Mises à jour', 'Nouvelle version en un clic'], ['iphOpen', 'mic', 'iPhone : Siri et widgets', 'Raccourcis et widget de l’écran d’accueil'],
    ['enOpen', 'boltPlain', 'Tarif et coûts', 'Euros par appareil, alerte de consommation'], ['waOpen', 'sprinkler', 'Arrosage', 'Selon la pluie d’hier et de demain'], ['detOpen', 'cctv', 'Détection caméras', 'Personnes et voitures avec Frigate'],
    ['simOpen', 'bulb', 'Simulation de présence', 'Lumières pendant les vacances'], ['kidOpen', 'family', 'Profils enfants', 'Pièces autorisées, couvre-feu']];
  B.act('toolsOpen', () => B.modal('<h2>' + ico('gear') + 'Outils de la maison</h2><div class="tools">' + TOOLS.filter(t => mod({ enOpen: 'energie', waOpen: 'arrosage', detOpen: 'detection', simOpen: 'simulation' }[t[0]])).map(t => '<button class="tool" data-act="' + t[0] + '">' + ico(t[1]) + '<b>' + t[2] + '</b><small>' + t[3] + '</small></button>').join('') + '</div>', 'wide toolsmodal'));
  const sfx1 = B.RENDER.sfx;
  if (sfx1) B.RENDER.sfx = s => sfx1(s).replace('<button class="btn sm" data-act="brandsCfg">', '<button class="btn sm" data-act="toolsOpen">' + ico('grid9') + 'Outils</button><button class="btn sm" data-act="brandsCfg">');

  /* ---------- 1. sauvegarde chiffrée ---------- */
  const snapshot = () => { const c = JSON.parse(JSON.stringify(S)); delete c.journal; return c; };
  function bkBody() {
    const c = (P.cfg || {}).backup || {}, l = (P.state || {}).backups || [];
    return '<h2>' + ico('cloudUp') + 'Sauvegarde de la maison</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Tout est dans un seul fichier chiffré (AES-256) : réglages de Bêta home, marques et leurs identifiants, règles, scènes, chauffage, alarme, codes, historique. Sans le mot de passe, personne ne peut l’ouvrir — pas même vous : notez-le.</p>' +
      '<section class="svsec"><h4 class="rlh">' + ico('download') + 'Télécharger une sauvegarde</h4><div class="grid2"><label class="field">Mot de passe (6 caractères au moins)<input type="password" data-bk="pass" autocomplete="new-password"></label><label class="field">Encore une fois<input type="password" data-bk="pass2" autocomplete="new-password"></label></div>' +
      '<label class="rlck"><input type="checkbox" data-bk="hist" checked>Inclure l’historique des mesures</label> <button class="btn pri sm" data-act="bkDown">' + ico('download') + 'Télécharger</button></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('upload') + 'Restaurer</h4><p class="muted" style="font-size:12.5px;margin:0 0 6px">Sur un NAS neuf : installez Bêta home, reliez cet écran au serveur, puis choisissez le fichier. Le serveur redémarre tout seul.</p><div class="grid2"><label class="field">Fichier .betabak<input type="file" accept=".betabak,application/json" data-bk="file"></label><label class="field">Mot de passe<input type="password" data-bk="rpass"></label></div><button class="btn sm" data-act="bkRestore">' + ico('upload') + 'Restaurer cette sauvegarde</button><div class="bkres"></div></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('moon') + 'Chaque nuit, automatiquement</h4>' + sw('bkAuto', c.auto !== false, 'Sauvegarde automatique sur le NAS') +
      '<div class="grid2"><label class="field">Heure<input type="time" value="' + esc(c.at || '03:30') + '" data-change="bkSet" data-arg="at"></label><label class="field">Garder<input type="number" min="1" max="90" value="' + (c.keep || 14) + '" data-change="bkSet" data-arg="keep"></label>' +
      '<label class="field">Mot de passe des sauvegardes automatiques<input type="password" placeholder="' + (c.pass ? 'déjà défini' : 'sinon : copie non chiffrée sur le NAS seulement') + '" data-change="bkSet" data-arg="pass" autocomplete="new-password"></label><label class="field">Copie sur clé USB (dossier du conteneur)<input value="' + esc(c.dir || '') + '" placeholder="/backup" data-change="bkSet" data-arg="dir"></label></div>' +
      (c.last ? '<p class="muted" style="font-size:12.5px">Dernière : ' + new Date(c.last.at).toLocaleString('fr-FR') + ' — ' + (c.last.ok ? 'réussie' : '⚠ ' + esc(c.last.err)) + '</p>' : '') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="bkNow">' + ico('cloudUp') + 'Sauvegarder maintenant</button></div>' +
      (l.length ? '<div class="list" style="margin-top:8px">' + l.slice(0, 8).map(b => '<div class="li" style="grid-template-columns:30px 1fr auto"><span class="ic">' + ico(b.enc ? 'lock' : 'files') + '</span><span>' + esc(b.name) + ' <small class="muted">' + Math.round(b.size / 1024) + ' Ko</small></span><button class="btn sm" data-act="bkGet" data-arg="' + esc(b.name) + '">' + ico('download') + '</button></div>').join('') + '</div>' : '') + '</section>';
  }
  const bkV = k => (document.querySelector('[data-bk="' + k + '"]') || {});
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
  B.act('bkOpen', async () => { if (!needAdmin()) return; await load(); modal('bkmodal', bkBody()); });
  B.act('bkDown', async () => {
    const p = bkV('pass').value || ''; if (p.length < 6) return B.toast('Mot de passe : 6 caractères au moins', 'info'); if (p !== bkV('pass2').value) return B.toast('Les deux mots de passe sont différents', 'info');
    B.toast('Préparation de la sauvegarde…', 'cloudUp');
    try { const r = await req('/api/plus/backup', { pass: p, client: snapshot(), history: bkV('hist').checked }); download('beta-home-' + F.ymd(new Date()) + '.betabak', JSON.stringify(r)); B.toast('Sauvegarde téléchargée', 'check'); } catch (e) { B.toast(e.message, 'info'); }
  });
  B.act('bkRestore', async () => {
    const f = bkV('file').files && bkV('file').files[0], p = bkV('rpass').value || '', out = document.querySelector('.bkres'); if (!f) return B.toast('Choisissez le fichier', 'info');
    let blob; try { blob = JSON.parse(await f.text()); } catch (e) { return B.toast('Fichier illisible', 'info'); }
    try {
      const c = await req('/api/plus/restore', { blob, pass: p, check: true });
      if (!confirm('Sauvegarde du ' + new Date(c.at).toLocaleString('fr-FR') + ' (' + c.files + ' fichiers' + (c.client ? ' + réglages de Bêta home' : '') + ').\nRemplacer la configuration actuelle du NAS ?')) return;
      const r = await req('/api/plus/restore', { blob, pass: p });
      if (r.client) { try { localStorage.setItem('betaos.v5', JSON.stringify(Object.assign(r.client, { conn: S.conn }))); } catch (e) { } }
      if (out) out.innerHTML = '<p class="muted">' + ico('refresh') + ' ' + r.files + ' fichiers restaurés. Le serveur redémarre, la page va se recharger…</p>';
      setTimeout(() => location.reload(), 8000);
    } catch (e) { B.toast(e.message, 'lock'); }
  });
  const bkSave = async patch => { if (await save({ backup: patch })) { await load(); modal('bkmodal', bkBody()); } };
  B.act('bkAuto', () => bkSave({ auto: !(((P.cfg || {}).backup || {}).auto !== false) }));
  B.act('bkSet', el => { const k = el.dataset.arg, v = k === 'keep' ? Math.max(1, +el.value || 14) : el.value.trim(); if (k === 'pass' && v && v.length < 6) return B.toast('6 caractères au moins', 'info'); bkSave({ [k]: v }); });
  B.act('bkNow', async () => { try { const r = await req('/api/plus/backup/now', {}); B.toast(r.ok ? 'Sauvegarde enregistrée' : 'Échec : ' + r.err, r.ok ? 'check' : 'info'); await load(); modal('bkmodal', bkBody()); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('bkGet', async el => { try { const r = await fetch(B.Server.url() + '/api/plus/backups/' + encodeURIComponent(el.dataset.arg), { headers: B.Server.headers() }); if (!r.ok) throw new Error('HTTP ' + r.status); download(el.dataset.arg.replace(/^auto/, 'beta-home-auto'), await r.text()); } catch (e) { B.toast(e.message, 'info'); } });

  /* ---------- 2-3. journal des règles et mode test ---------- */
  const says = (x, k) => B.ruleSays ? B.ruleSays(x, k) : x.type, actSay = a => B.ruleActSay ? B.ruleActSay(a) : a.type;
  const traceLi = x => '<div class="li trli ' + (x.ok ? (x.dry ? 'sim' : 'ok') : 'no') + '"><span class="ic">' + ico(x.ok ? (x.dry ? 'sparkle' : 'check') : 'x') + '</span><div><b>' + esc(x.name || 'Règle') + (x.sim ? ' <small class="tag2 wait">test</small>' : '') + '</b><small>' + esc(x.why || '') + '</small>' +
    (x.ok ? '<small class="trw">' + (x.dry ? 'ferait : ' : 'a fait : ') + esc((x.acts || []).map(actSay).join(', puis ')) + '</small>' : '<small class="trw">bloquée : ' + esc((x.failed || []).map(c => 'pas « ' + says(c, 'if') + ' »').join(', ')) + '</small>') + '</div><small class="muted">' + new Date(x.t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</small></div>';
  B.act('trOpen', async () => { if (!need()) return; let l = []; try { l = await req('/api/engine/trace'); } catch (e) { } B.modal('<h2>' + ico('history') + 'Journal des règles</h2><p class="muted" style="font-size:13px;margin:0 0 10px">Chaque fois qu’un déclencheur arrive : la règle a agi, ou elle a été bloquée par une condition.</p><div class="list">' + (l.map(traceLi).join('') || '<p class="muted">Rien pour l’instant : les règles n’ont encore reçu aucun déclencheur.</p>') + '</div>', 'wide trmodal'); });
  let SIM = { kind: 'device', real: false };
  const BOOLK = ['light', 'rgb', 'plug', 'switch', 'door', 'motion', 'leak', 'fan', 'media', 'clim', 'heater', 'valve'];
  function simBody(res) {
    const k = SIM.kind, devs = hubDevs(), d = devs.find(x => x.id === SIM.dev) || devs[0], dk = d ? d.k : '';
    const opts = (arg, cur, list) => '<select data-change="smSet" data-arg="' + arg + '">' + list.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    const f = k === 'device' ? opts('dev', d && d.id, devs.map(x => [x.id, dlabel(x)])) + (['temp', 'hum', 'co2', 'meter'].includes(dk) ? '<input type="number" data-change="smSet" data-arg="val" value="' + esc(SIM.val == null ? 20 : SIM.val) + '">' : ['cover', 'awning', 'garage'].includes(dk) ? opts('pos', SIM.pos || 100, [[100, 's’ouvre'], [0, 'se ferme']]) : dk === 'lock' ? opts('locked', SIM.locked || 'false', [['false', 'se déverrouille'], ['true', 'se verrouille']]) : opts('on', SIM.on || 'true', [['true', BOOLK.includes(dk) && /door/.test(dk) ? 's’ouvre' : 's’allume / détecte'], ['false', 's’éteint / se ferme']]))
      : k === 'presence' ? opts('ev', SIM.ev || 'all_away', [['all_away', 'tout le monde part'], ['first_home', 'le premier rentre'], ['arrive', 'quelqu’un arrive'], ['leave', 'quelqu’un part']]) + opts('user', SIM.user || '', [['', 'n’importe qui']].concat(S.users.map(u => [u.id, u.name])))
      : k === 'time' ? '<input type="time" data-change="smSet" data-arg="at" value="' + esc(SIM.at || F.time(new Date())) + '">' + opts('day', SIM.day == null ? new Date().getDay() : SIM.day, [1, 2, 3, 4, 5, 6, 0].map(i => [i, F.JOURS[i]]))
      : k === 'sun' ? opts('ev', SIM.ev || 'sunset', [['sunset', 'coucher du soleil'], ['sunrise', 'lever du soleil']])
      : k === 'away' ? opts('on', SIM.on || 'true', [['true', 's’active'], ['false', 'se coupe']])
      : k === 'tempo' ? opts('color', SIM.color || 'rouge', [['rouge', 'demain rouge'], ['blanc', 'demain blanc'], ['bleu', 'demain bleu']])
      : k === 'vigil' ? opts('level', SIM.level || 3, [[2, 'jaune'], [3, 'orange'], [4, 'rouge']])
      : k === 'alarm' ? opts('status', SIM.status || 'triggered', [['triggered', 'se déclenche'], ['armed', 's’active'], ['disarmed', 'se coupe']])
      : k === 'detect' ? '<input data-change="smSet" data-arg="cam" placeholder="caméra (nom Frigate)" value="' + esc(SIM.cam || '') + '">' + opts('label', SIM.label || 'person', [['person', 'personne'], ['car', 'voiture'], ['dog', 'chien'], ['cat', 'chat'], ['package', 'colis']])
      : k === 'list' ? opts('list', SIM.list || 'courses', [['courses', 'courses'], ['taches', 'tâches']]) : '';
    return '<h2>' + ico('play') + 'Tester un évènement</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Faites « comme si » quelque chose arrivait, pour voir quelles règles réagiraient. Rien n’est exécuté, sauf si vous cochez « pour de vrai ».</p>' +
      '<div class="rlrow">' + opts('kind', k, [['device', 'Un appareil change'], ['presence', 'Arrivée / départ'], ['doorbell', 'On sonne'], ['time', 'Il est telle heure'], ['sun', 'Soleil'], ['away', 'Mode absent'], ['tempo', 'Tempo'], ['vigil', 'Vigilance météo'], ['alarm', 'Alarme'], ['detect', 'Caméra : détection'], ['list', 'Ajout à une liste']]) + '<span class="rlf">' + f + '</span></div>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap;margin:10px 0">' + ck('smReal', 'real', SIM.real, 'pour de vrai (exécuter les actions)') + '<button class="btn pri" data-act="smGo">' + ico('play') + 'Simuler</button></div>' +
      (res ? '<div class="list">' + (res.trace.length ? res.trace.map(traceLi).join('') : '<p class="muted">Aucune règle ne réagit à cet évènement.</p>') + '</div>' : '');
  }
  B.act('simTest', () => { if (!need()) return; modal('smmodal', simBody()); });
  B.act('smSet', el => { SIM[el.dataset.arg] = el.value; if (el.dataset.arg === 'kind' || el.dataset.arg === 'dev') ['on', 'val', 'pos', 'locked', 'ev'].forEach(k => delete SIM[k]); modal('smmodal', simBody()); });
  B.act('smReal', el => { SIM.real = el.checked; });
  B.act('smGo', async () => {
    const devs = hubDevs(), d = devs.find(x => x.id === SIM.dev) || devs[0], b = { kind: SIM.kind, real: SIM.real };
    if (SIM.kind === 'device') { if (!d) return B.toast('Aucun appareil relié en direct', 'info'); b.dev = d.id; b.state = ['temp', 'hum', 'co2', 'meter'].includes(d.k) ? { val: +(SIM.val == null ? 20 : SIM.val) } : ['cover', 'awning', 'garage'].includes(d.k) ? { pos: +(SIM.pos || 100) } : d.k === 'lock' ? { locked: SIM.locked === 'true' } : { on: (SIM.on || 'true') === 'true' }; }
    else Object.assign(b, { ev: SIM.ev || (SIM.kind === 'sun' ? 'sunset' : 'all_away'), user: SIM.user, at: SIM.at || F.time(new Date()), day: SIM.day, on: (SIM.on || 'true') === 'true', color: SIM.color || 'rouge', level: SIM.level || 3, status: SIM.status || 'triggered', cam: SIM.cam || '', label: SIM.label || 'person', list: SIM.list || 'courses' });
    if (SIM.real && !confirm('Exécuter vraiment les actions des règles concernées ?')) return;
    try { modal('smmodal', simBody(await req('/api/engine/sim', b))); } catch (e) { B.toast(e.message, 'info'); }
  });
  const bl0 = RENDER.blist;
  if (bl0) RENDER.blist = () => bl0().replace('<button class="btn" data-act="presenceCfg">', '<button class="btn" data-act="trOpen">' + ico('history') + 'Journal</button><button class="btn" data-act="simTest">' + ico('play') + 'Tester</button><button class="btn" data-act="presenceCfg">');

  /* ---------- 4. mises à jour ---------- */
  async function upBody(force) {
    let u; try { u = await req('/api/plus/update' + (force ? '?force=1' : '')); } catch (e) { return '<h2>' + ico('download') + 'Mises à jour</h2><p class="warn">' + esc(e.message) + '</p>'; }
    const short = s => s && s !== 'dev' ? s.slice(0, 7) : 'construite en local';
    return '<h2>' + ico('download') + 'Mises à jour</h2><div class="upst ' + (u.upToDate ? 'g' : u.latest ? 'y' : '') + '">' + ico(u.upToDate ? 'check' : 'download') + '<div><b>' + (u.upToDate ? 'Bêta home est à jour' : u.latest ? 'Une version plus récente existe' : 'Impossible de vérifier') + '</b><small>Version installée : ' + esc(short(u.current)) + (u.latest ? ' · dernière : ' + esc(u.latest.sha.slice(0, 7)) + ' du ' + new Date(u.latest.date).toLocaleDateString('fr-FR') + ' — « ' + esc(u.latest.msg) + ' »' : '') + (u.err ? ' · ' + esc(u.err) : '') + '</small></div></div>' +
      (u.watchtower ? '<button class="btn pri" data-act="upGo">' + ico('download') + 'Mettre à jour maintenant</button><p class="muted" style="font-size:12.5px">Watchtower télécharge la nouvelle image et redémarre Bêta home (et le pont Alexa/Maison) : une à deux minutes. Une sauvegarde est faite avant.</p>'
        : '<p class="muted" style="font-size:13px;line-height:1.55">Pour mettre à jour depuis ici, activez le service <b>watchtower</b> dans <code>docker-compose.yml</code> (et la même phrase dans <code>WATCHTOWER_TOKEN</code>). Sinon, sur le NAS : <code>docker compose pull && docker compose up -d</code>.</p>') +
      '<button class="btn sm" data-act="upCheck">' + ico('refresh') + 'Vérifier maintenant</button>';
  }
  B.act('upOpen', async () => { if (!needAdmin()) return; modal('upmodal', await upBody()); });
  B.act('upCheck', async () => modal('upmodal', await upBody(true)));
  B.act('upGo', async () => {
    if (!confirm('Mettre à jour Bêta home maintenant ? Il redémarre pendant une à deux minutes.')) return;
    try { await req('/api/plus/backup/now', {}).catch(() => { }); await req('/api/plus/update', {}); } catch (e) { return B.toast(e.message, 'info'); }
    const sha0 = (await req('/api/ping').catch(() => ({}))).sha; B.toast('Mise à jour en cours…', 'download'); let n = 0;
    const t = setInterval(async () => { n++; const p = await req('/api/ping').catch(() => null); if ((p && p.sha !== sha0) || n > 40) { clearInterval(t); location.reload(); } }, 6000);
  });

  /* ---------- 9. iPhone : Siri, Raccourcis et widget ---------- */
  function iphBody() {
    const base = P.ext || (S.conn.server.url || ''), t = P.qtok, q = (x, extra) => base + '/api/quick?do=' + x + '&fmt=text&d=' + (t || 'JETON') + (extra || '');   // le texte dicté se colle à la fin
    const rows = [['Dis Siri, état de la maison', q('status')], ['Dis Siri, ajoute aux courses', q('add', '&list=courses&text=') + ' + « Dicter le texte »'], ['Dis Siri, liste de courses', q('courses')], ['Dis Siri, message à la maison', q('msg', '&text=') + ' + « Dicter le texte »'], ['Dis Siri, active l’alarme', q('alarm', '&mode=armed_away')], ['Dis Siri, réveil en douceur', q('wake')], ['Dis Siri, ne pas déranger', q('dnd', '&hours=2')], ['Dis Siri, Wi-Fi invités', q('guest', '&on=1')], ['Dis Siri, annonce à la maison', q('announce', '&to=&text=') + ' + « Dicter le texte »']]
      .concat((S.routines || []).map(r => ['Dis Siri, ' + r.name, q('routine', '&id=' + encodeURIComponent(r.id))])).concat(scenes().map(s => ['Dis Siri, ' + s.name, q('scene', '&id=' + encodeURIComponent(s.id))]));
    return '<h2>' + ico('mic') + 'iPhone : Siri et widgets</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Chaque iPhone reçoit son propre accès (révocable dans Paramètres › Sécurité). Hors de la maison, il faut Tailscale : mettez alors l’adresse en https://….ts.net.</p>' +
      '<div class="grid2"><label class="field">Adresse du serveur vue par l’iPhone<input value="' + esc(base) + '" data-change="iphExt"></label><label class="field">Nom de l’iPhone<input value="' + esc(P.qname || ('iPhone de ' + B.user().name)) + '" data-change="iphName"></label></div>' +
      (t ? '<p class="muted" style="font-size:12.5px">' + ico('check') + ' Accès créé. Il ne sera plus affiché ensuite : copiez maintenant les adresses dont vous avez besoin.</p>' : '<button class="btn pri" data-act="iphTok">' + ico('lock') + 'Créer l’accès de cet iPhone</button>') +
      '<h4 class="rlh">' + ico('mic') + 'Raccourcis Siri</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">App Raccourcis › + › « Obtenir le contenu de l’URL » (collez l’adresse) › « Énoncer le texte ». Le nom du raccourci est la phrase à dire.</p>' +
      '<div class="list">' + rows.map(r => '<div class="li qrow"><div><b>' + esc(r[0]) + '</b><small class="ell">' + esc(r[1]) + '</small></div><button class="btn sm" data-act="iphCopy" data-arg="' + esc(r[1].replace(/ \+ «.*$/, '')) + '">' + ico('files') + 'Copier</button></div>').join('') + '</div>' +
      '<h4 class="rlh">' + ico('grid9') + 'Widget de l’écran d’accueil</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">Installez l’app gratuite <b>Scriptable</b>, créez un script, collez ce code, puis ajoutez un widget Scriptable sur l’écran d’accueil et choisissez ce script. Il affiche l’alarme, qui est là, la température, Tempo, les poubelles et les courses.</p>' +
      '<textarea class="iphcode" readonly rows="8">' + esc(widget(base, t)) + '</textarea><button class="btn sm" data-act="iphCopyW">' + ico('files') + 'Copier le code du widget</button>';
  }
  const widget = (base, t) => 'const r = await new Request("' + base + '/api/quick?do=status&d=' + (t || 'JETON') + '").loadJSON();\nconst w = new ListWidget(); w.backgroundColor = new Color("#0b1530");\nconst h = w.addText("Bêta home"); h.textColor = new Color("#2fd3ff"); h.font = Font.boldSystemFont(14); w.addSpacer(6);\nconst line = s => { const x = w.addText(s); x.textColor = Color.white(); x.font = Font.systemFont(12); };\nline("🛡 Alarme " + ({ disarmed: "désactivée", armed: "activée", arming: "activation…", entry: "code ?", triggered: "DÉCLENCHÉE" }[r.alarm] || r.alarm));\nif (r.people) line("🏠 " + r.home + "/" + r.people + " à la maison");\nif (r.temp != null) line("🌡 " + String(r.temp).replace(".", ",") + " °C");\nif (r.tempo && r.tempo.today) line("⚡ Tempo " + r.tempo.today + (r.tempo.tomorrow ? " · demain " + r.tempo.tomorrow : ""));\nif (r.trash.length) line("🗑 " + r.trash.join(", "));\nif (r.courses) line("🛒 " + r.courses + " article(s)");\nif (r.message) line("💬 " + r.message);\nw.url = "' + base + '/#accueil";\nScript.setWidget(w); if (!config.runsInWidget) await w.presentSmall(); Script.complete();';
  const copy = t => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => B.toast('Copié', 'check'), () => { prompt('Copiez :', t); });
  B.act('iphOpen', async () => { if (!need()) return; await load(); modal('iphmodal', iphBody()); });
  B.act('iphExt', el => { P.ext = el.value.trim().replace(/\/+$/, ''); modal('iphmodal', iphBody()); });
  B.act('iphName', el => { P.qname = el.value.trim(); });
  B.act('iphTok', async () => {
    try { const c = await B.Server.post('/api/auth/pair/start', {}); const r = await fetch(B.Server.url() + '/api/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c.code, name: P.qname || ('iPhone de ' + B.user().name) }) }), j = await r.json(); if (!r.ok) throw new Error(j.error); P.qtok = j.device; modal('iphmodal', iphBody()); }
    catch (e) { B.toast(e.message, 'info'); }
  });
  B.act('iphCopy', el => copy(el.dataset.arg));
  B.act('iphCopyW', () => copy(widget(P.ext || S.conn.server.url || '', P.qtok)));

  /* ======================= 5. SCÈNES ======================= */
  const scenes = () => srv() && P.cfg ? P.cfg.scenes || [] : (S.scenesLocal || []);
  const CURVE = [[0, 20, 2200], [6, 45, 2900], [9, 100, 4500], [13, 100, 5000], [17, 90, 4000], [20, 60, 2700], [22, 35, 2300], [24, 20, 2200]];
  function moment(d) { d = d || new Date(); const h = d.getHours() + d.getMinutes() / 60, i = CURVE.findIndex((p, j) => h >= p[0] && h < CURVE[j + 1][0]), a = CURVE[i], b = CURVE[i + 1], k = (h - a[0]) / (b[0] - a[0]), H = d.getHours(); return { bri: Math.round(a[1] + (b[1] - a[1]) * k), ct: Math.round((a[2] + (b[2] - a[2]) * k) / 50) * 50, name: H >= 5 && H < 10 ? 'matin' : H >= 10 && H < 18 ? 'jour' : H >= 18 && H < 22 ? 'soir' : 'nuit' }; }
  B.moment = moment;
  const MOM = { matin: 'Matin', jour: 'Journée', soir: 'Soir', nuit: 'Nuit' };
  // l'écran applique la scène : les appareils reliés en direct passent par le NAS, les autres (Home Assistant, démo) aussi via setDev
  function applyScene(sc, fromNas) {
    if (!sc) return; const m = moment();
    Object.keys(sc.states || {}).forEach(id => { if (!DATA.DEVICES[id] || (fromNas && (B.nasMap ? B.nasMap(id) : hubMap()[id]))) return; let p = sc.states[id]; const k = B.kindOf(DATA.DEVICES[id]); if (sc.adaptive && p.on && (k === 'light' || k === 'rgb')) p = Object.assign({}, p, { bri: m.bri, ct: m.ct }); B.setDev(id, p); });
    if (!fromNas) B.toast('Scène « ' + sc.name + ' »', 'sparkle');
  }
  const capture = id => { const d = DATA.DEVICES[id], s = S.dev[id] || (d && d.def) || {}, k = B.kindOf(d); return ['cover', 'awning', 'garage'].includes(k) ? { pos: +s.pos || 0 } : k === 'light' || k === 'rgb' ? Object.assign({ on: !!s.on }, s.on && s.bri != null ? { bri: s.bri } : {}, s.on && s.color ? { color: s.color } : {}) : k === 'clim' || d.type === 'heater' ? Object.assign({ on: !!s.on }, s.temp != null ? { temp: s.temp } : {}) : { on: !!s.on }; };
  const SCTL = d => !['temp', 'hum', 'co2', 'meter', 'door', 'motion', 'leak', 'camera', 'scene'].includes(B.kindOf(d)) && !['sensor', 'binary', 'camera', 'scene', 'alarm', 'lock'].includes(d.type);
  RENDER.scList = () => {
    const rooms = B.roomsList(null), list = scenes(), m = moment();
    const by = {}; list.forEach(s => { (by[s.rkey || s.room] = by[s.rkey || s.room] || []).push(s); });
    const keys = rooms.filter(r => by[r.key] || by[r.name]).map(r => ({ r, l: by[r.key] || by[r.name] })).concat(by.maison ? [{ r: { key: 'maison', label: 'Toute la maison' }, l: by.maison }] : []);
    return '<div class="scenes scroll">' + (keys.length ? keys.map(({ r, l }) => '<div class="scroom"><h4>' + esc(r.label || r.name) + (l.some(s => (s.moments || []).length) ? '<button class="btn sm" data-act="scAuto" data-arg="' + esc(r.key) + '">' + ico('sunGear') + 'Selon l’heure</button>' : '') + '</h4><div class="scgrid">' +
      l.map(s => '<div class="scbtn' + ((s.moments || []).includes(m.name) ? ' now' : '') + '"><button class="scgo" data-act="scRun" data-arg="' + s.id + '">' + ico(s.icon || 'sparkle') + '<b>' + esc(s.name) + '</b><small>' + Object.keys(s.states || {}).length + ' appareil(s)' + ((s.moments || []).length ? ' · ' + s.moments.map(x => MOM[x]).join(', ') : '') + (s.adaptive ? ' · adaptative' : '') + '</small></button><button class="sq" data-act="scEdit" data-arg="' + s.id + '" aria-label="Modifier">' + ico('edit') + '</button></div>').join('') + '</div></div>').join('')
      : '<div class="secempty">' + ico('sparkle') + '<b>Vos ambiances en un geste</b><p class="muted">« Salon soir », « Chambre lecture », « Cuisine matin » : mettez la pièce comme vous l’aimez, puis « Nouvelle scène » retient l’état de chaque appareil.</p></div>') + '</div>' +
      '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn pri" data-act="scEdit">' + ico('plus') + 'Nouvelle scène</button></div>';
  };
  RENDER.scAdapt = () => {
    const a = (P.cfg || {}).adaptive || {}, m = moment(), rooms = B.roomsList(null);
    return '<div class="scad"><div class="scnow"><span class="sccol" style="background:' + ctColor(m.ct) + '"></span><div><b>' + MOM[m.name] + ' · ' + m.bri + ' % · ' + m.ct + ' K</b><small>Réglage idéal des lumières en ce moment</small></div></div>' +
      '<div class="sccurve">' + Array.from({ length: 24 }, (_, h) => { const x = moment(new Date(2026, 0, 1, h, 30)); return '<i style="height:' + x.bri + '%;background:' + ctColor(x.ct) + '" title="' + h + ' h : ' + x.bri + ' %, ' + x.ct + ' K"></i>'; }).join('') + '</div><div class="sclab"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>' +
      (srv() ? sw('scAdOn', a.on, '<b>Lumière adaptative</b> : les lumières allumées suivent la journée (toutes les 10 min). Si vous les réglez à la main, elles sont laissées tranquilles 2 h.') + (a.on ? '<div class="alpick">' + rooms.map(r => ck('scAdRoom', r.name, (a.rooms || []).includes(r.name), esc(r.label))).join('') + '</div><small class="muted">Aucune pièce cochée = toutes.</small>' : '') : '<p class="muted" style="font-size:12.5px">Lumière adaptative : nécessite le serveur Bêta.</p>') + '</div>';
  };
  const ctColor = k => { const t = Math.max(0, Math.min(1, (k - 2200) / 2800)); return 'rgb(' + Math.round(255 - 40 * t) + ',' + Math.round(170 + 60 * t) + ',' + Math.round(90 + 165 * t) + ')'; };
  B.route('scenes', { title: 'Scènes', bg: 'assets/bg/generic.jpg', render: () => B.side('scenes') + B.header({ id: 'scenes', title: 'Scènes', sub: 'Ambiances par pièce et par moment de la journée', icon: 'sparkle', info: { t: 'infobox', keys: ['plus'], items: () => { const m = moment(); return [{ icon: 'sparkle', v: scenes().length, l: 'Scènes', cls: 'c' }, { icon: 'sunGear', v: MOM[m.name], l: 'Moment' }, { icon: 'bulb', v: m.bri + ' %', l: 'Lumière idéale', cls: 'y' }, { icon: 'sun2', v: m.ct + ' K', l: 'Couleur' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1040, 1012]) + '">' + B.whead('sparkle', 'Scènes') + T({ t: 'scList', keys: ['plus'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([1050, 235, 1522, 1012]) + '">' + B.whead('sunGear', 'Lumière de la journée') + T({ t: 'scAdapt', keys: ['plus'] }) + '</section>', after: () => load() });
  let SC = null; B.scEditing = () => SC;   // pour les options « mode » (vie.js)
  function scBody() {
    const rooms = B.roomsList(null), r = rooms.find(x => x.key === SC.rkey) || rooms.find(x => x.name === SC.room), devs = SC.rkey === 'maison' ? Object.values(DATA.DEVICES).filter(d => SCTL(d) && !(B.isHidden && B.isHidden(d.id))) : r ? r.devs.filter(SCTL) : [];
    const ICONS = ['sparkle', 'sofa', 'bed', 'utensils', 'moon', 'sun', 'film', 'music', 'bulb', 'heart', 'journal', 'tv', 'bath'];
    return '<h2>' + ico('sparkle') + (scenes().some(s => s.id === SC.id) ? 'Modifier la scène' : 'Nouvelle scène') + '</h2>' +
      '<div class="grid2"><label class="field">Nom<input data-input="scIn" data-arg="name" value="' + esc(SC.name) + '" placeholder="Salon soir"></label><label class="field">Pièce<select data-change="scRoom"><option value="maison"' + (SC.rkey === 'maison' ? ' selected' : '') + '>Toute la maison</option>' + rooms.map(x => '<option value="' + esc(x.key) + '"' + (r && x.key === r.key ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select></label></div>' +
      '<div class="scicons">' + ICONS.map(i => '<button type="button" class="sq' + (SC.icon === i ? ' on' : '') + '" data-act="scIcon" data-arg="' + i + '">' + ico(i) + '</button>').join('') + '</div>' +
      '<h4 class="rlh">' + ico('sunGear') + 'Moments <small>(pour « Selon l’heure » et Siri « scène du salon »)</small></h4><div class="alpick">' + Object.keys(MOM).map(k => ck('scMom', k, (SC.moments || []).includes(k), MOM[k])).join('') + '</div>' +
      ck('scAdapt', 'a', SC.adaptive, 'Lumière adaptative : luminosité et couleur selon l’heure au lieu des valeurs enregistrées') +
      '<h4 class="rlh">' + ico('plug') + 'Appareils <small>(état actuel enregistré ; décochez ce qui ne doit pas bouger)</small></h4><div class="list">' + (devs.map(d => { const on = d.id in SC.states, st = on ? SC.states[d.id] : capture(d.id); return '<div class="li" style="grid-template-columns:auto 1fr auto"><input type="checkbox" data-change="scDev" data-arg="' + d.id + '"' + (on ? ' checked' : '') + '><span>' + esc(d.name) + ' <small class="muted">' + esc(stTxt(st)) + '</small></span>' + (on ? '<button class="btn sm" data-act="scCap" data-arg="' + d.id + '">' + ico('refresh') + 'Reprendre l’état actuel</button>' : '') + '</div>'; }).join('') || '<p class="muted">Aucun appareil pilotable dans cette pièce.</p>') + '</div>' +
      '<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px"><span>' + (scenes().some(s => s.id === SC.id) ? '<button class="btn dan" data-act="scDel">' + ico('trash') + 'Supprimer</button>' : '') + '</span><span class="row" style="gap:8px"><button class="btn" data-act="scTry">' + ico('play') + 'Essayer</button><button class="btn pri" data-act="scSave">' + ico('check') + 'Enregistrer</button></span></div>';
  }
  const stTxt = p => 'pos' in p ? 'ouvert à ' + p.pos + ' %' : p.on ? 'allumé' + (p.bri != null ? ' ' + p.bri + ' %' : '') + (p.temp != null ? ' ' + p.temp + ' °C' : '') : 'éteint';
  B.act('scEdit', el => {
    const s = el && el.dataset && el.dataset.arg && scenes().find(x => x.id === el.dataset.arg);
    if (s) SC = JSON.parse(JSON.stringify(s));
    else { const rooms = B.roomsList(null), r = rooms.find(x => x.devs.some(d => SCTL(d) && (S.dev[d.id] || {}).on)) || rooms[0]; SC = { id: 'sc' + Date.now().toString(36), name: '', room: r ? r.name : 'maison', rkey: r ? r.key : 'maison', icon: 'sparkle', moments: [], adaptive: false, states: {} }; (r ? r.devs.filter(SCTL) : []).forEach(d => { SC.states[d.id] = capture(d.id); }); }
    modal('scmodal2', scBody());
  });
  B.act('scIn', el => { SC[el.dataset.arg] = el.value; });
  B.act('scRoom', el => { const r = B.roomsList(null).find(x => x.key === el.value); SC.rkey = el.value; SC.room = r ? r.name : 'maison'; SC.states = {}; (r ? r.devs.filter(SCTL) : []).forEach(d => { SC.states[d.id] = capture(d.id); }); modal('scmodal2', scBody()); });
  B.act('scIcon', el => { SC.icon = el.dataset.arg; modal('scmodal2', scBody()); });
  B.act('scMom', el => { SC.moments = togDay(SC.moments, el.dataset.arg); });
  B.act('scAdapt', el => { SC.adaptive = el.checked; });
  B.act('scDev', el => { if (el.checked) SC.states[el.dataset.arg] = capture(el.dataset.arg); else delete SC.states[el.dataset.arg]; modal('scmodal2', scBody()); });
  B.act('scCap', el => { SC.states[el.dataset.arg] = capture(el.dataset.arg); modal('scmodal2', scBody()); });
  B.act('scTry', () => applyScene(SC));
  async function putScenes(list) { if (srv()) { if (!isAdmin()) { B.toast('Réservé aux administrateurs', 'lock'); return false; } return save({ scenes: list }); } S.scenesLocal = list; B.save(); B.emit('plus'); return true; }
  B.act('scSave', async () => { if (!Object.keys(SC.states).length) return B.toast('Cochez au moins un appareil', 'info'); SC.name = SC.name.trim() || 'Scène'; if (await putScenes(scenes().filter(s => s.id !== SC.id).concat([SC]))) { B.closeModal(); B.toast('Scène enregistrée', 'check'); } });
  B.act('scDel', async () => { if (!confirm('Supprimer cette scène ?')) return; if (await putScenes(scenes().filter(s => s.id !== SC.id))) B.closeModal(); });
  B.act('scRun', el => applyScene(scenes().find(s => s.id === el.dataset.arg)));
  B.act('scAuto', el => { const m = moment().name, l = scenes().filter(s => (s.rkey || s.room) === el.dataset.arg || s.room === el.dataset.arg); applyScene(l.find(s => (s.moments || []).includes(m)) || l[0]); });
  B.act('scAdOn', async () => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); await save({ adaptive: { on: !((P.cfg.adaptive || {}).on) } }); });
  B.act('scAdRoom', el => save({ adaptive: { rooms: togDay((P.cfg.adaptive || {}).rooms, el.dataset.arg) } }));

  /* ======================= 6. CHAUFFAGE ======================= */
  const zones = () => ((P.cfg || {}).heat || {}).zones || [];
  const HMODE = [['auto', 'Auto', 'sunGear'], ['comfort', 'Confort', 'flame'], ['eco', 'Éco', 'eco'], ['frost', 'Hors-gel', 'snow'], ['off', 'Arrêt', 'power']];
  RENDER.heatList = () => {
    if (!srv()) return '<p class="warn">Le chauffage intelligent tourne sur le serveur Bêta du NAS : reliez-le d’abord (Connexions).</p>';
    if (!P.cfg) return '<p class="muted">Lecture…</p>';
    const st = (P.state || {}).heat || {};
    return '<div class="hzones scroll">' + (zones().map(z => { const s = st[z.id] || {}; return '<div class="hzone' + (s.off ? ' off' : '') + (s.win ? ' win' : '') + '"><div class="hzh"><b>' + esc(z.name) + '</b><button class="sq" data-act="hzEdit" data-arg="' + z.id + '" aria-label="Modifier">' + ico('edit') + '</button></div>' +
      '<div class="hzt"><span class="hzcur">' + (s.temp != null ? String(Math.round(s.temp * 10) / 10).replace('.', ',') + '°' : '—') + '</span><span class="hzarr">' + ico('chevR') + '</span><span class="hztg">' + (s.off ? 'arrêt' : s.target != null ? String(s.target).replace('.', ',') + '°' : '…') + '</span></div><small class="hzwhy">' + esc(s.why || '') + '</small>' +
      '<div class="hzm">' + HMODE.map(m => '<button class="' + ((z.mode || 'auto') === m[0] ? 'on' : '') + '" data-act="hzMode" data-arg="' + z.id + '|' + m[0] + '">' + ico(m[2]) + m[1] + '</button>').join('') + '<button class="' + (z.boost > Date.now() ? 'on' : '') + '" data-act="hzMode" data-arg="' + z.id + '|boost">' + ico('flame') + 'Boost 1 h</button></div></div>'; }).join('') ||
      '<div class="secempty">' + ico('flame') + '<b>Chauffage pièce par pièce</b><p class="muted">Une zone = des radiateurs, thermostats ou clims, un capteur de température et un planning. Bêta baisse tout seul en absence, fenêtre ouverte et les jours rouges Tempo.</p></div>') + '</div>' +
      '<div class="row" style="margin-top:10px;gap:8px"><button class="btn pri" data-act="hzEdit">' + ico('plus') + 'Nouvelle zone</button></div>';
  };
  B.route('chauffage', { title: 'Chauffage', bg: 'assets/bg/generic.jpg', render: () => B.side('chauffage') + B.header({ id: 'chauffage', title: 'Chauffage', sub: 'Planning par pièce, éco automatique', icon: 'flame', info: { t: 'infobox', keys: ['plus', 'brain'], items: () => { const st = (P.state || {}).heat || {}, v = Object.values(st), tp = ((S.brain || {}).status || {}).tempo; return [{ icon: 'flame', v: zones().length, l: 'Zones', cls: 'c' }, { icon: 'sunGear', v: v.filter(x => /confort|boost/.test(x.why || '')).length, l: 'En confort', cls: 'y' }, { icon: 'door', v: v.filter(x => x.win).length, l: 'Fenêtres ouvertes', cls: v.some(x => x.win) ? 'p' : '' }, { icon: 'boltPlain', v: tp && tp.today ? tp.today : '—', l: 'Tempo' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('flame', 'Zones de chauffage', '<button class="wmore" data-act="hzReload" aria-label="Actualiser">' + ico('refresh') + '</button>') + T({ t: 'heatList', keys: ['plus'] }) + '</section>', after: () => load() });
  setInterval(() => { if (B.current === 'chauffage' || B.current === 'scenes') load(); }, 30000);
  B.act('hzReload', load);
  B.act('hzMode', async el => { const [id, mode] = el.dataset.arg.split('|'); try { const r = await req('/api/plus/heat/mode', { id, mode }); P.cfg.heat.zones = r.zones; P.state.heat = r.state; B.emit('plus'); } catch (e) { B.toast(e.message, 'info'); } });
  let HZ = null;
  function hzBody() {
    const heaters = hubDevs(d => ['heater', 'clim'].includes(d.k) || d.type === 'heater'), sensors = hubDevs(d => ['temp', 'clim'].includes(d.k)), wins = hubDevs(d => d.k === 'door');
    const num = (k, l, step) => '<label class="field">' + l + '<input type="number" step="' + (step || 0.5) + '" value="' + esc(HZ[k]) + '" data-change="hzNum" data-arg="' + k + '"></label>';
    return '<h2>' + ico('flame') + (zones().some(z => z.id === HZ.id) ? 'Zone : ' + esc(HZ.name) : 'Nouvelle zone') + '</h2>' +
      '<div class="grid2"><label class="field">Nom<input value="' + esc(HZ.name) + '" data-change="hzTxt" data-arg="name" placeholder="Salon"></label><label class="field">Capteur de température<select data-change="hzTxt" data-arg="sensor"><option value="">—</option>' + sensors.map(d => '<option value="' + d.id + '"' + (HZ.sensor === d.id ? ' selected' : '') + '>' + esc(dlabel(d)) + '</option>').join('') + '</select></label></div>' +
      '<h4 class="rlh">' + ico('flame') + 'Radiateurs, thermostats, clims</h4><div class="alpick">' + (heaters.map(d => ck('hzPick', 'devs|' + d.id, HZ.devs.includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucun appareil de chauffage relié en direct (Marques : Netatmo, tado°, Cozytouch, Viessmann, Sensibo, Daikin…).</small>') + '</div>' +
      '<div class="grid2">' + num('comfort', 'Confort (°C)') + num('eco', 'Éco (°C)') + num('frost', 'Hors-gel (°C)') + '</div>' +
      '<h4 class="rlh">' + ico('calendar') + 'Planning de confort <small>(en dehors : éco)</small></h4>' + HZ.sched.map((p, i) => '<div class="rlrow">' + daysPick('hzDay', i, p.days) + '<input type="time" value="' + esc(p.from) + '" data-change="hzP" data-arg="' + i + '|from"><span class="muted">à</span><input type="time" value="' + esc(p.to) + '" data-change="hzP" data-arg="' + i + '|to"><button type="button" class="sq" data-act="hzPDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="hzPAdd">' + ico('plus') + 'Plage</button><button type="button" class="btn sm" data-act="hzPTpl">' + ico('sparkle') + 'Semaine type</button></div>' +
      '<h4 class="rlh">' + ico('eco') + 'Économies automatiques</h4>' + ck('hzCk', 'awayEco', HZ.awayEco !== false, 'Éco quand la maison est en mode absent') +
      '<div class="rlrow">' + ck('hzCk', 'winOff', HZ.winOff !== false, 'Couper si une fenêtre reste ouverte plus de') + '<input type="number" min="0" max="30" value="' + (HZ.winDelay || 2) + '" data-change="hzNum" data-arg="winDelay" style="width:70px"><span class="muted">min</span></div>' +
      '<div class="alpick">' + (wins.map(d => ck('hzPick', 'windows|' + d.id, HZ.windows.includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucun détecteur d’ouverture relié.</small>') + '</div>' +
      '<label class="field" style="max-width:340px">Jours rouges Tempo (6 h – 22 h)<select data-change="hzNum" data-arg="tempoRed"><option value="0"' + (!+HZ.tempoRed ? ' selected' : '') + '>ne rien changer</option><option value="-1"' + (+HZ.tempoRed === -1 ? ' selected' : '') + '>1 °C de moins</option><option value="-2"' + (+HZ.tempoRed === -2 ? ' selected' : '') + '>2 °C de moins</option><option value="-3"' + (+HZ.tempoRed === -3 ? ' selected' : '') + '>3 °C de moins</option></select></label>' +
      '<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px"><span>' + (zones().some(z => z.id === HZ.id) ? '<button class="btn dan" data-act="hzDel">' + ico('trash') + 'Supprimer</button>' : '') + '</span><button class="btn pri" data-act="hzSave">' + ico('check') + 'Enregistrer</button></div>';
  }
  const hzR = () => modal('hzmodal', hzBody());
  B.act('hzEdit', async el => { if (!needAdmin()) return; if (!P.cfg) await load(); const z = el && el.dataset && el.dataset.arg && zones().find(x => x.id === el.dataset.arg); HZ = z ? JSON.parse(JSON.stringify(z)) : { id: 'z' + Date.now().toString(36), name: '', on: true, mode: 'auto', devs: [], sensor: '', windows: [], comfort: 20, eco: 17, frost: 12, sched: [], awayEco: true, winOff: true, winDelay: 2, tempoRed: -1 }; ['devs', 'windows', 'sched'].forEach(k => { HZ[k] = HZ[k] || []; }); hzR(); });
  B.act('hzTxt', el => { HZ[el.dataset.arg] = el.value; });
  B.act('hzNum', el => { HZ[el.dataset.arg] = +el.value; });
  B.act('hzCk', el => { HZ[el.dataset.arg] = el.checked; });
  B.act('hzPick', el => { const [k, id] = el.dataset.arg.split('|'); HZ[k] = togDay(HZ[k], id); });
  B.act('hzDay', el => { const [i, d] = el.dataset.arg.split('|'); HZ.sched[+i].days = togDay(HZ.sched[+i].days, +d); hzR(); });
  B.act('hzP', el => { const [i, k] = el.dataset.arg.split('|'); HZ.sched[+i][k] = el.value; });
  B.act('hzPAdd', () => { HZ.sched.push({ days: [1, 2, 3, 4, 5], from: '17:30', to: '22:30' }); hzR(); });
  B.act('hzPDel', el => { HZ.sched.splice(+el.dataset.arg, 1); hzR(); });
  B.act('hzPTpl', () => { HZ.sched = [{ days: [1, 2, 3, 4, 5], from: '06:30', to: '08:30' }, { days: [1, 2, 3, 4, 5], from: '17:30', to: '22:30' }, { days: [6, 0], from: '08:00', to: '23:00' }]; hzR(); });
  B.act('hzSave', async () => { if (!HZ.devs.length) return B.toast('Choisissez au moins un appareil de chauffage', 'info'); HZ.name = HZ.name.trim() || 'Zone'; if (await save({ heat: { zones: zones().filter(z => z.id !== HZ.id).concat([HZ]) } })) { B.closeModal(); setTimeout(load, 800); B.toast('Zone enregistrée : le NAS s’en occupe', 'check'); } });
  B.act('hzDel', async () => { if (!confirm('Supprimer cette zone ?')) return; if (await save({ heat: { zones: zones().filter(z => z.id !== HZ.id) } })) B.closeModal(); });

  /* ======================= 7. ÉNERGIE EN EUROS ======================= */
  let EN = null;
  function enBody() {
    const t = (P.cfg || {}).tariff || {}, r = EN;
    const inp = (k, v, step) => '<input type="number" step="' + (step || 0.0001) + '" value="' + esc(v) + '" data-change="enT" data-arg="' + k + '">';
    let chart = '';
    if (r && r.days.length) {
      const d30 = r.days.slice(-30), mx = Math.max(0.01, ...d30.map(x => x.eur)), TC = { bleu: '#3b82f6', blanc: '#e5e7eb', rouge: '#ef4444' };
      chart = '<div class="enbars">' + d30.map(x => '<i style="height:' + Math.max(2, x.eur / mx * 100) + '%;background:' + (TC[x.tempo] || '#2fd3ff') + '" title="' + x.date + ' : ' + kwh(x.kwh) + ' · ' + eur(x.eur) + '"></i>').join('') + '</div><div class="sclab"><span>' + d30[0].date.slice(5).split('-').reverse().join('/') + '</span><span>aujourd’hui</span></div>';
    }
    const devs = r ? Object.keys(r.devices).map(id => Object.assign({ id }, r.devices[id])).sort((a, b) => b.eur - a.eur) : [], tot = devs.reduce((a, d) => a + d.eur, 0) || 1, sub = +t.sub || 0;
    return '<h2>' + ico('boltPlain') + 'Énergie en euros</h2>' + (!r ? '<p class="muted">Lecture…</p>' : !r.tracked ? '<p class="warn">Aucun appareil ne mesure sa consommation : reliez des prises connectées ou un compteur (Shelly, Tapo, Kasa…) dans Marques.</p>' :
      '<div class="enkpi"><div><small>Ce mois-ci</small><b>' + eur(r.month.eur + sub) + '</b><small>' + kwh(r.month.kwh) + (sub ? ' · abonnement compris' : '') + '</small></div><div><small>Mois dernier</small><b>' + eur(r.prev.eur + (r.prev.kwh ? sub : 0)) + '</b><small>' + kwh(r.prev.kwh) + '</small></div><div><small>Aujourd’hui</small><b>' + eur(r.days[r.days.length - 1].eur) + '</b><small>' + kwh(r.days[r.days.length - 1].kwh) + '</small></div></div>' + chart +
      '<h4 class="rlh">' + ico('plug') + 'Par appareil <small>(' + r.days.length + ' derniers jours)</small></h4><div class="list">' + devs.map(d => '<div class="li enrow"><div><b>' + esc(d.name) + '</b><small>' + esc(d.room) + '</small></div><span class="enbar"><i style="width:' + Math.round(d.eur / tot * 100) + '%"></i></span><span><b>' + eur(d.eur) + '</b><small>' + kwh(d.kwh) + '</small></span></div>').join('') + '</div>') +
      '<section class="svsec"><h4 class="rlh">' + ico('gear') + 'Votre tarif <small>(prix TTC du kWh, à reprendre de votre facture)</small></h4><div class="grid2"><label class="field">Option<select data-change="enT" data-arg="mode">' + [['base', 'Base'], ['hphc', 'Heures pleines / creuses'], ['tempo', 'Tempo']].map(o => '<option value="' + o[0] + '"' + (t.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label class="field">Abonnement (€ / mois)' + inp('sub', t.sub || 0, 0.01) + '</label></div>' +
      (t.mode === 'base' ? '<div class="grid2"><label class="field">Prix du kWh' + inp('base', t.base) + '</label></div>' : t.mode === 'hphc' ? '<div class="grid2"><label class="field">Heures pleines' + inp('hp', t.hp) + '</label><label class="field">Heures creuses' + inp('hc', t.hc) + '</label><label class="field">Creuses de<input type="time" value="' + esc(t.hcFrom) + '" data-change="enT" data-arg="hcFrom"></label><label class="field">à<input type="time" value="' + esc(t.hcTo) + '" data-change="enT" data-arg="hcTo"></label></div>'
        : '<div class="entp">' + ['bleu', 'blanc', 'rouge'].map(c => '<label class="field t-' + c + '">' + c + ' · creuses' + inp('tempo.' + c + '.0', (t.tempo || {})[c][0]) + '</label><label class="field t-' + c + '">' + c + ' · pleines' + inp('tempo.' + c + '.1', (t.tempo || {})[c][1]) + '</label>').join('') + '</div><small class="muted">Heures creuses Tempo : 22 h – 6 h. La couleur de chaque jour vient du suivi Tempo (Paramètres › Services).</small>') +
      sw('enAlert', t.alert !== false, 'Me prévenir d’une consommation inhabituelle (plus de 1,5 fois la normale à la même heure)') + '</section>';
  }
  B.act('enOpen', async () => { if (!need()) return; await load(); EN = null; modal('enmodal', enBody()); try { EN = await req('/api/energy?days=62'); } catch (e) { } modal('enmodal', enBody()); });
  B.act('enT', async el => {
    if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock');
    const k = el.dataset.arg, t = JSON.parse(JSON.stringify(P.cfg.tariff)); if (k.startsWith('tempo.')) { const [, c, i] = k.split('.'); t.tempo[c][+i] = +el.value; } else t[k] = ['mode', 'hcFrom', 'hcTo'].includes(k) ? el.value : +el.value;
    if (await save({ tariff: t })) { try { EN = await req('/api/energy?days=62'); } catch (e) { } modal('enmodal', enBody()); }
  });
  B.act('enAlert', async () => { if (await save({ tariff: { alert: P.cfg.tariff.alert === false } })) modal('enmodal', enBody()); });
  const en = B.ROUTES && B.ROUTES.energie;
  if (en) { const r0 = en.render; en.render = () => r0().replace('</section>', '</section><button class="encost abs" data-act="enOpen">' + ico('chart') + 'Coûts en €</button>'); }

  /* ======================= 8. ARROSAGE ======================= */
  let WD = null;
  function waBody() {
    const w = (P.cfg || {}).water || {}, st = (P.state || {}).water || {}, devs = hubDevs(d => ['valve', 'plug', 'switch', 'sprinkler'].includes(d.k) || d.type === 'valve' || /arros|vanne|goutte/i.test(d.name));
    const num = (k, l) => '<label class="field">' + l + '<input type="number" step="0.5" value="' + esc(w[k]) + '" data-change="waNum" data-arg="' + k + '"></label>';
    const last = WD || st.last;
    return '<h2>' + ico('sprinkler') + 'Arrosage selon la météo</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Aux heures choisies, le NAS regarde la pluie d’hier et celle prévue aujourd’hui à Fegersheim (Open-Meteo), puis arrose zone après zone… ou annule et vous prévient.</p>' +
      sw('waOn', w.on, '<b>Arrosage automatique</b>') +
      '<h4 class="rlh">' + ico('dropFill') + 'Vannes / prises de pompe <small>(arrosées l’une après l’autre)</small></h4><div class="alpick">' + (devs.map(d => ck('waDev', d.id, (w.devs || []).includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucune vanne ni prise reliée en direct.</small>') + '</div>' +
      '<div class="grid2"><label class="field">Heures (séparées par des virgules)<input value="' + esc((w.times || []).join(', ')) + '" data-change="waTimes" placeholder="06:30, 21:00"></label><label class="field">Durée par zone (min)<input type="number" min="1" max="120" value="' + (w.dur || 15) + '" data-change="waNum" data-arg="dur"></label></div>' +
      '<div class="rlrow"><span class="muted">Jours</span>' + daysPick('waDay', 'd', w.days) + '<small class="muted">aucun = tous</small></div>' +
      '<div class="grid2">' + num('rain', 'Annuler s’il a plu hier plus de (mm)') + num('fcst', 'Annuler si pluie prévue plus de (mm)') + num('cold', 'Annuler s’il fait moins de (°C)') + '</div>' +
      (last ? '<div class="upst ' + (last.skip ? 'y' : 'g') + '">' + ico(last.skip ? 'umbrella' : 'dropFill') + '<div><b>' + (last.skip ? 'Pas d’arrosage' : 'Arrosage') + '</b><small>' + esc(last.why || '') + (last.at ? ' · ' + new Date(last.at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '</small></div></div>' : '') +
      (st.running ? '<p class="muted">' + ico('dropFill') + ' En cours : ' + esc((DATA.DEVICES[st.dev] || {}).name || '') + ' jusqu’à ' + F.time(new Date(st.until)) + '</p>' : '') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="waCheck">' + ico('rain') + 'Que ferait-il maintenant ?</button>' + (st.running ? '<button class="btn sm dan" data-act="waStop">' + ico('stop') + 'Arrêter</button>' : '<button class="btn sm" data-act="waRun">' + ico('play') + 'Arroser maintenant</button>') + '</div>';
  }
  const waR = async () => { await load(); modal('wamodal', waBody()); };
  const waSave = async patch => { if (await save({ water: patch })) waR(); };
  B.act('waOpen', async () => { if (!needAdmin()) return; WD = null; waR(); });
  B.act('waOn', () => waSave({ on: !P.cfg.water.on }));
  B.act('waDev', el => waSave({ devs: togDay(P.cfg.water.devs, el.dataset.arg) }));
  B.act('waTimes', el => waSave({ times: el.value.split(/[,; ]+/).map(x => x.trim()).filter(x => /^\d{1,2}:\d{2}$/.test(x)).map(x => x.padStart(5, '0')) }));
  B.act('waNum', el => waSave({ [el.dataset.arg]: +el.value }));
  B.act('waDay', el => waSave({ days: togDay(P.cfg.water.days, +el.dataset.arg.split('|')[1]) }));
  B.act('waCheck', async () => { try { WD = Object.assign({ at: Date.now() }, await req('/api/plus/water/check', {})); modal('wamodal', waBody()); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('waRun', async () => { try { await req('/api/plus/water/run', { force: true, by: B.user().name }); B.toast('Arrosage lancé', 'dropFill'); setTimeout(waR, 1500); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('waStop', async () => { await req('/api/plus/water/stop', {}).catch(() => { }); setTimeout(waR, 800); });

  /* ======================= 13. SIMULATION DE PRÉSENCE ======================= */
  function simBodyP() {
    const c = (P.cfg || {}).sim || {}, st = (P.state || {}).sim || {}, devs = hubDevs(d => ['light', 'rgb', 'cover'].includes(d.k));
    return '<h2>' + ico('bulb') + 'Simulation de présence</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Pendant votre absence, le NAS rejoue vos vrais gestes de la semaine précédente (lumières, volets), décalés de quelques minutes, du coucher du soleil jusqu’à l’heure choisie. Tant qu’il n’a rien appris, il suit un petit scénario de soirée.</p>' +
      '<div class="grid2"><label class="field">Quand<select data-change="spSet" data-arg="mode">' + [['away', 'En mode absent (recommandé)'], ['on', 'Toujours (test)'], ['off', 'Jamais']].map(o => '<option value="' + o[0] + '"' + ((c.mode || 'away') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label class="field">Tout éteindre à<input type="time" value="' + esc(c.end || '23:30') + '" data-change="spSet" data-arg="end"></label><label class="field">Décalage aléatoire (min)<input type="number" min="0" max="45" value="' + (c.jitter || 10) + '" data-change="spSet" data-arg="jitter"></label></div>' +
      '<h4 class="rlh">' + ico('bulb') + 'Appareils <small>(aucun coché = toutes les lumières)</small></h4><div class="alpick">' + (devs.map(d => ck('spDev', d.id, (c.devs || []).includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucune lumière reliée en direct.</small>') + '</div>' +
      '<div class="upst ' + (st.active ? 'g' : '') + '">' + ico(st.active ? 'check' : 'moon') + '<div><b>' + (st.active ? 'Simulation en cours' : 'En attente') + '</b><small>' + (st.learned || 0) + ' gestes appris ces 14 derniers jours</small></div></div>' +
      (st.done && st.done.length ? '<div class="list">' + st.done.map(x => '<div class="li" style="grid-template-columns:30px 1fr auto"><span class="ic">' + ico(x.patch.on ? 'bulbFill' : 'bulb') + '</span><span>' + esc(x.name) + ' : ' + (x.patch.pos != null ? 'volet ' + x.patch.pos + ' %' : x.patch.on ? 'allumée' : 'éteinte') + ' <small class="muted">' + esc(x.why) + '</small></span><small class="muted">' + F.time(new Date(x.t)) + '</small></div>').join('') + '</div>' : '');
  }
  const spR = async () => { await load(); modal('spmodal', simBodyP()); };
  B.act('simOpen', async () => { if (!needAdmin()) return; spR(); });
  B.act('spSet', async el => { const k = el.dataset.arg; if (await save({ sim: { [k]: k === 'jitter' ? +el.value : el.value } })) spR(); });
  B.act('spDev', async el => { if (await save({ sim: { devs: togDay(P.cfg.sim.devs, el.dataset.arg) } })) spR(); });

  /* ======================= 14. DÉTECTION CAMÉRAS (FRIGATE) ======================= */
  const LBL = { person: 'personnes', car: 'voitures', dog: 'chiens', cat: 'chats', package: 'colis', bicycle: 'vélos', motorcycle: 'motos' };
  function detBody() {
    const c = (P.cfg || {}).detect || {}, cams = (P.cams || {}).cams || [], rec = (P.state || {}).detect || [];
    return '<h2>' + ico('cctv') + 'Détection sur les caméras</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Frigate (sur le NAS) reconnaît les personnes, voitures, animaux… Bêta ne vous prévient que pour ce que vous choisissez — plus de notifications pour un chat ou des branches qui bougent. La photo est jointe.</p>' +
      sw('dtOn', c.on, '<b>Notifications de détection</b>') +
      '<h4 class="rlh">' + ico('bellFill') + 'Me prévenir pour</h4><div class="alpick">' + Object.keys(LBL).map(k => ck('dtLbl', k, (c.labels || []).includes(k), LBL[k])).join('') + '</div>' +
      '<div class="grid2"><label class="field">Pas plus d’une alerte toutes les (min)<input type="number" min="0" max="60" value="' + (c.cool || 3) + '" data-change="dtCool"></label></div>' + ck('dtAway', 'a', c.away, 'Seulement en mode absent') +
      '<h4 class="rlh">' + ico('camera') + 'Caméras</h4>' + ((P.cams || {}).err ? '<p class="warn">' + esc(P.cams.err) + '</p>' : '') +
      '<div class="list">' + cams.map(x => { const cc = (c.cams || {})[x.id] || {}; return '<div class="li dtcam"><div><b>' + esc(x.id.replace(/_/g, ' ')) + '</b>' + (x.zones.length ? '<span class="alpick">' + x.zones.map(z => ck('dtZone', x.id + '|' + z, (cc.zones || []).includes(z), 'zone ' + esc(z))).join('') + '</span><small class="muted">Aucune zone cochée = toute l’image</small>' : '') + '</div><div class="row" style="gap:10px;flex-wrap:wrap">' + ck('dtCam', x.id + '|off', !cc.off, 'active') + ck('dtCam', x.id + '|alarm', !!cc.alarm, 'déclenche l’alarme') + '</div></div>'; }).join('') + '</div>' +
      (rec.length ? '<h4 class="rlh">' + ico('history') + 'Dernières détections</h4><div class="list">' + rec.map(e => '<div class="li" style="grid-template-columns:30px 1fr auto"><span class="ic">' + ico(e.label === 'car' ? 'car' : e.label === 'person' ? 'user' : 'paw') + '</span><span>' + esc(LBL[e.label] || e.label) + ' — ' + esc(e.cam.replace(/_/g, ' ')) + (e.zones.length ? ' <small class="muted">(' + esc(e.zones.join(', ')) + ')</small>' : '') + '</span><small class="muted">' + new Date(e.t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '</small></div>').join('') + '</div>' : '');
  }
  const dtR = async () => { await load(); modal('dtmodal', detBody()); };
  const dtSave = async patch => { if (await save({ detect: patch })) dtR(); };
  B.act('detOpen', async () => { if (!needAdmin()) return; try { P.cams = await req('/api/plus/detect/cams'); } catch (e) { P.cams = { cams: [], err: e.message }; } dtR(); });
  B.act('dtOn', () => dtSave({ on: !P.cfg.detect.on }));
  B.act('dtLbl', el => dtSave({ labels: togDay(P.cfg.detect.labels, el.dataset.arg) }));
  B.act('dtCool', el => dtSave({ cool: Math.max(0, +el.value || 0) }));
  B.act('dtAway', el => dtSave({ away: el.checked }));
  const camCfg = id => Object.assign({}, (P.cfg.detect.cams || {})[id]);
  B.act('dtZone', el => { const [id, z] = el.dataset.arg.split('|'), cams = Object.assign({}, P.cfg.detect.cams), cc = camCfg(id); cc.zones = togDay(cc.zones, z); cams[id] = cc; dtSave({ cams }); });
  B.act('dtCam', el => { const [id, k] = el.dataset.arg.split('|'), cams = Object.assign({}, P.cfg.detect.cams), cc = camCfg(id); cc[k] = k === 'off' ? !el.checked : el.checked; cams[id] = cc; dtSave({ cams }); });
  // raccourcis depuis la page Sécurité
  const ac0 = RENDER.alarmCard;
  if (ac0) RENDER.alarmCard = () => { const h = ac0(); return h.includes('data-act="presenceCfg"') ? h.replace(/<button class="btn sm" data-act="presenceCfg">/, (mod('simulation') ? '<button class="btn sm" data-act="simOpen">' + ico('bulb') + 'Simulation de présence</button>' : '') + (mod('detection') ? '<button class="btn sm" data-act="detOpen">' + ico('cctv') + 'Détection caméras</button>' : '') + '<button class="btn sm" data-act="presenceCfg">') : h; };

  /* ======================= 10. PROFILS ENFANTS ======================= */
  const KID_HIDE = ['parametres', 'reglages', 'installation', 'connexions', 'marques', 'securite', 'sante', 'journal', 'routines', 'absence', 'chauffage', 'energie', 'voiture', 'mails', 'nas'];
  const kid = () => { const u = B.user(); return u && u.child ? u : null; };
  const SENS = d => ['garage', 'lock', 'alarm'].includes(B.kindOf(d));
  function kidDeny(u) { if (!u.child) return; const rooms = (u.kid || {}).rooms || []; u.deny = Object.values(DATA.DEVICES).filter(d => SENS(d) || (rooms.length && !rooms.includes(d.room))).map(d => d.id); }
  setTimeout(() => { S.users.forEach(kidDeny); B.save(); }, 1500);
  const nl0 = B.navList;
  B.navList = NAV => { let out = (nl0 ? nl0(NAV) : NAV).slice(); const add = (id, label, icon, after) => { if (out.some(n => n[0] === id)) return; const i = out.findIndex(n => n[0] === after); out.splice(i < 0 ? out.length : i + 1, 0, [id, label, icon, icon, 'noside']); };
    add('scenes', 'Scènes', 'sparkle', 'routines'); add('chauffage', 'Chauffage', 'flame', 'energie'); add('listes', 'Listes', 'check', 'calendrier');
    if (kid()) out = out.filter(n => !KID_HIDE.includes(n[0])); return out; };
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (kid() && KID_HIDE.includes(h)) { setTimeout(() => B.go('accueil'), 0); B.toast('Page réservée aux parents', 'lock'); } });
  let KU = null;
  function kidBody() {
    const kids = S.users.filter(u => !u.admin), u = S.users.find(x => x.id === KU) || kids[0];
    if (!u) return '<h2>' + ico('family') + 'Profils enfants</h2><p class="muted">Tous les profils sont administrateurs.</p>';
    KU = u.id; const k = u.kid || {}, rooms = B.roomsList(null), devs = hubDevs(d => !['temp', 'hum', 'co2', 'meter', 'door', 'motion', 'leak'].includes(d.k));
    return '<h2>' + ico('family') + 'Profils enfants</h2><div class="tabs sm" style="margin-bottom:10px">' + kids.map(x => '<button class="' + (x.id === u.id ? 'on' : '') + '" data-act="kuSel" data-arg="' + x.id + '">' + esc(x.name) + '</button>').join('') + '</div>' +
      sw('kuOn', u.child, '<b>' + esc(u.name) + ' est un enfant</b> : pas de réglages, d’alarme, d’énergie ni de serrures ; seulement ses pièces') +
      (u.child ? '<h4 class="rlh">' + ico('rooms') + 'Pièces autorisées <small>(aucune cochée = toutes)</small></h4><div class="alpick">' + [...new Set(rooms.map(r => r.name))].map(n => ck('kuRoom', n, (k.rooms || []).includes(n), esc(n))).join('') + '</div>' +
        '<h4 class="rlh">' + ico('moon') + 'Couvre-feu <small>(exécuté par le NAS)</small></h4>' + (srv() ? (k.curfew || []).map((c, i) => '<div class="kucf"><div class="rlrow"><input type="time" value="' + esc(c.at) + '" data-change="kuCf" data-arg="' + i + '|at">' + daysPick('kuCfDay', i, c.days) + '<button type="button" class="sq" data-act="kuCfDel" data-arg="' + i + '">' + ico('x') + '</button></div><div class="alpick">' + devs.map(d => ck('kuCfDev', i + '|' + d.id, (c.devs || []).includes(d.id), esc(dlabel(d)))).join('') + '</div><input value="' + esc(c.say || '') + '" data-change="kuCf" data-arg="' + i + '|say" placeholder="Annonce sur les tablettes (facultatif) : Au lit ' + esc(u.name) + ' !"></div>').join('') +
          '<button class="btn sm" data-act="kuCfAdd">' + ico('plus') + 'Couvre-feu (ex. TV coupée à 21 h)</button>' : '<p class="muted">Nécessite le serveur Bêta.</p>') : '') +
      '<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn pri" data-act="kuSave">' + ico('check') + 'Enregistrer</button></div>';
  }
  const kuR = () => modal('kumodal', kidBody()), ku = () => S.users.find(x => x.id === KU), kk = () => { const u = ku(); u.kid = Object.assign({ rooms: [], curfew: [] }, u.kid); return u.kid; };
  B.act('kidOpen', () => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); kuR(); });
  B.act('kuSel', el => { KU = el.dataset.arg; kuR(); });
  B.act('kuOn', () => { const u = ku(); u.child = !u.child; if (!u.child) u.deny = (u.deny || []).filter(id => SENS(DATA.DEVICES[id] || {})); kuR(); });
  B.act('kuRoom', el => { kk().rooms = togDay(kk().rooms, el.dataset.arg); });
  B.act('kuCfAdd', () => { kk().curfew.push({ at: '21:00', days: [0, 1, 2, 3, 4], devs: [], say: '' }); kuR(); });
  B.act('kuCfDel', el => { kk().curfew.splice(+el.dataset.arg, 1); kuR(); });
  B.act('kuCf', el => { const [i, k] = el.dataset.arg.split('|'); kk().curfew[+i][k] = el.value; });
  B.act('kuCfDay', el => { const [i, d] = el.dataset.arg.split('|'); const c = kk().curfew[+i]; c.days = togDay(c.days, +d); kuR(); });
  B.act('kuCfDev', el => { const [i, id] = el.dataset.arg.split('|'); const c = kk().curfew[+i]; c.devs = togDay(c.devs, id); });
  B.act('kuSave', async () => {
    S.users.forEach(kidDeny); B.save();
    if (srv() && B.brainSave && S.brain && S.brain.cfg) {
      const rules = (S.brain.cfg.rules || []).filter(r => !/^kid-/.test(r.id));
      S.users.filter(u => u.child).forEach(u => ((u.kid || {}).curfew || []).forEach((c, i) => { if (!(c.devs || []).length && !c.say) return; rules.push({ id: 'kid-' + u.id + '-' + i, name: 'Couvre-feu ' + u.name, on: true, when: [{ type: 'time', at: c.at, days: c.days || [] }], if: [], then: (c.devs || []).map(dev => ({ type: 'device', dev, patch: { on: false } })).concat(c.say ? [{ type: 'say', text: c.say }] : []) }); }));
      if (!await B.brainSave({ rules })) return;
    }
    B.closeModal(); B.show(); B.toast('Profils enfants enregistrés', 'check');
  });

  /* ======================= 11-12. LISTES ET MESSAGES ======================= */
  // sans serveur Bêta : les listes restent sur cet écran (localStorage)
  const LL = () => (S.listsLocal = S.listsLocal || { courses: [], taches: [] }), LB = () => (S.boardLocal = (S.boardLocal || []).filter(m => m.until > Date.now()));
  function localOp(b) {
    const L = LL()[b.list]; if (!L) return;
    if (b.op === 'add') b.text.split(/\s*(?:,|\bet\b)\s*/).filter(Boolean).forEach(t => L.push({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t.charAt(0).toUpperCase() + t.slice(1), done: false, by: b.by || '', who: b.who || '', due: b.due || '', at: Date.now() }));
    else if (b.op === 'toggle') { const x = L.find(i => i.id === b.id); if (x) x.done = !x.done; }
    else if (b.op === 'del' || b.op === 'clear') LL()[b.list] = L.filter(i => b.op === 'del' ? i.id !== b.id : !i.done);
    P.lists = LL(); B.save(); B.emit('lists');
  }
  async function loadLists() { if (!srv()) { P.lists = LL(); P.board = LB(); B.emit('lists'); return; } try { const r = await req('/api/plus/lists'); P.lists = r.lists; P.board = r.board; B.emit('lists'); B.emit('house'); } catch (e) { } }
  setTimeout(loadLists, 3500); setInterval(() => { if (!document.hidden) loadLists(); }, 60000);
  const listOp = async b => { if (!srv()) return localOp(Object.assign({ by: B.user().name }, b)); try { const r = await req('/api/plus/lists', Object.assign({ by: B.user().name }, b)); P.lists = r.lists; P.board = r.board; B.emit('lists'); } catch (e) { B.toast(e.message, 'info'); } };
  B.listAdd = (list, text) => listOp({ op: 'add', list, text });
  const item = (l, x) => '<div class="li lsi' + (x.done ? ' done' : '') + '"><button class="lsck" data-act="lsTog" data-arg="' + l + '|' + x.id + '" aria-label="Fait">' + (x.done ? ico('check') : '') + '</button><div><b>' + esc(x.text) + '</b><small>' + [x.who ? '→ ' + esc((S.users.find(u => u.id === x.who) || {}).name || x.who) : '', x.due ? 'pour le ' + new Date(x.due + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '', x.by ? 'par ' + esc(x.by) : ''].filter(Boolean).join(' · ') + '</small></div><button class="sq" data-act="lsDel" data-arg="' + l + '|' + x.id + '" aria-label="Supprimer">' + ico('x') + '</button></div>';
  RENDER.lsList = s => {
    const L = (P.lists || {})[s.list] || [], todo = L.filter(x => !x.done), done = L.filter(x => x.done);
    return '<div class="lsbox"><form class="lsadd" data-list="' + s.list + '"><input placeholder="' + (s.list === 'courses' ? 'Lait, pain et œufs…' : 'Sortir le chien…') + '" enterkeyhint="done">' + (s.list === 'taches' ? '<select>' + '<option value="">pour qui ?</option>' + S.users.map(u => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('') + '</select><input type="date">' : '') + '<button class="btn pri sm">' + ico('plus') + '</button></form>' +
      (srv() ? '' : '<small class="muted">' + ico('info') + ' Sans serveur Bêta, la liste reste sur cet écran.</small>') + '<div class="list scroll">' + (todo.map(x => item(s.list, x)).join('') || '<p class="muted" style="font-size:13px">' + (s.list === 'courses' ? 'La liste est vide.' : 'Rien à faire !') + '</p>') + (done.length ? '<div class="lsdone"><small class="muted">Fait (' + done.length + ')</small><button class="btn sm" data-act="lsClear" data-arg="' + s.list + '">' + ico('trash') + 'Retirer</button></div>' + done.map(x => item(s.list, x)).join('') : '') + '</div></div>';
  };
  RENDER.lsBoard = () => {
    return '<div class="lsbox"><form class="lsmsg"><input placeholder="Je rentre tard, à table sans moi !" maxlength="200"><select><option value="2">2 h</option><option value="6">6 h</option><option value="12" selected>12 h</option><option value="24">1 jour</option><option value="72">3 jours</option></select><button class="btn pri sm">' + ico('send') + '</button></form>' +
      '<div class="list scroll">' + ((P.board || []).map(m => '<div class="li lsm"><span class="ic">' + ico('chat') + '</span><div><b>' + esc(m.text) + '</b><small>' + esc(m.by || '') + ' · ' + new Date(m.at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' · jusqu’à ' + new Date(m.until).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '</small></div><button class="sq" data-act="bdDel" data-arg="' + m.id + '" aria-label="Retirer">' + ico('x') + '</button></div>').join('') || '<p class="muted" style="font-size:13px">Aucun message. Il s’affiche sur toutes les tablettes (et leur écran de veille).</p>') + '</div>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0">' + ico('mic') + ' « Dis Siri, ajoute aux courses » : Paramètres › Outils › iPhone. Ici : Bêta IA, « ajoute du lait à la liste de courses ».</p></div>';
  };
  B.route('listes', { title: 'Listes', bg: 'assets/bg/generic.jpg', render: () => B.side('listes') + B.header({ id: 'listes', title: 'Listes', sub: 'Courses, tâches et messages de la famille', icon: 'check', info: { t: 'infobox', keys: ['lists'], items: () => { const L = P.lists || { courses: [], taches: [] }; return [{ icon: 'check', v: L.courses.filter(x => !x.done).length, l: 'Courses', cls: 'c' }, { icon: 'family', v: L.taches.filter(x => !x.done).length, l: 'Tâches', cls: 'y' }, { icon: 'chat', v: (P.board || []).length, l: 'Messages' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 560, 1012]) + '">' + B.whead('check', 'Courses') + T({ t: 'lsList', list: 'courses', keys: ['lists'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([570, 235, 1040, 1012]) + '">' + B.whead('family', 'Tâches') + T({ t: 'lsList', list: 'taches', keys: ['lists'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([1050, 235, 1522, 1012]) + '">' + B.whead('chat', 'Messages sur les tablettes') + T({ t: 'lsBoard', keys: ['lists'] }) + '</section>', after: () => loadLists() });
  document.addEventListener('submit', e => {
    const f = e.target; if (!f.classList || !(f.classList.contains('lsadd') || f.classList.contains('lsmsg'))) return; e.preventDefault();
    const [inp, sel, date] = f.querySelectorAll('input,select'), text = inp.value.trim(); if (!text) return;
    if (f.classList.contains('lsmsg') && !srv()) { S.boardLocal = LB(); S.boardLocal.unshift({ id: 'm' + Date.now().toString(36), text, by: B.user().name, at: Date.now(), until: Date.now() + +sel.value * 36e5 }); P.board = S.boardLocal; B.save(); B.emit('lists'); B.emit('house'); }
    else if (f.classList.contains('lsmsg')) req('/api/plus/board', { text, by: B.user().name, hours: +sel.value }).then(r => { P.board = r.board; B.emit('lists'); B.emit('house'); }, er => B.toast(er.message, 'info'));
    else listOp({ op: 'add', list: f.dataset.list, text, who: sel && f.dataset.list === 'taches' ? sel.value : '', due: date ? date.value : '' });
    inp.value = '';
  });
  B.act('lsTog', el => { const [list, id] = el.dataset.arg.split('|'); listOp({ op: 'toggle', list, id }); });
  B.act('lsDel', el => { const [list, id] = el.dataset.arg.split('|'); listOp({ op: 'del', list, id }); });
  B.act('lsClear', el => listOp({ op: 'clear', list: el.dataset.arg }));
  B.act('bdDel', el => !srv() ? (S.boardLocal = LB().filter(m => m.id !== el.dataset.arg), P.board = S.boardLocal, B.save(), B.emit('lists')) : req('/api/plus/board', { del: el.dataset.arg }).then(r => { P.board = r.board; B.emit('lists'); B.emit('house'); }).catch(() => { }));
  // messages : en tête des alertes de l'accueil, de l'écran de verrouillage et de l'écran de veille
  const wx0 = B.wxAlerts;
  B.wxAlerts = () => (P.board || []).filter(m => m.until > Date.now()).slice(0, 2).map(m => ({ icon: 'chat', text: (m.by ? m.by + ' : ' : '') + m.text, board: true })).concat(wx0 ? wx0() : []);
  // Bêta IA : « ajoute du lait et des œufs à la liste de courses », « qu'y a-t-il sur la liste ? »
  const LISTRE = /^(?:peux[- ]tu |tu peux )?(?:ajoute|rajoute|mets|met|note)\s+(.+?)\s+(?:a|à|sur|dans)\s+(?:la\s+)?liste(?:\s+(?:de|des)\s+(courses|taches|tâches))?\s*[.!]?$/i;
  function iaList(text) {
    const t = String(text || '').trim(), m = t.match(LISTRE);
    if (m) { const list = /t[aâ]ches/i.test(m[2] || '') ? 'taches' : 'courses', what = m[1].replace(/^(?:du|de la|des|de l’|de l'|un|une|le|la|les)\s+/i, ''); listOp({ op: 'add', list, text: what }); return 'C’est noté : « ' + what + ' » sur la liste ' + (list === 'courses' ? 'de courses' : 'des tâches') + '.'; }
    if (/(?:qu.?y a.?t.?il|quoi|lis|montre).*(?:liste de courses|liste des courses|courses)/i.test(t) && P.lists) { const l = P.lists.courses.filter(x => !x.done); return l.length ? 'Sur la liste : ' + l.map(x => x.text).join(', ') + '.' : 'La liste de courses est vide.'; }
    return null;
  }
  ['ia', 'iaX'].forEach(k => { const f0 = B[k]; if (f0) B[k] = text => iaList(text) || f0(text); });
})();
