/* Bêta home 7.11 — services de la maison (côté écran) :
   - page Santé : marques en erreur, appareils hors ligne, piles faibles, ponts, serveur
   - courbes d'historique dans la fiche des capteurs, prises et clims (données gardées sur le NAS)
   - EDF Tempo, vigilance Météo-France (Bas-Rhin), calendrier des collectes (Fegersheim / Eurométropole)
   - Sécurité : codes PIN vérifiés par le NAS, mode sécurisé, écrans associés par code */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const BR = () => S.brain || {};

  /* ---------- courbes d'historique dans la fiche d'un appareil ---------- */
  const METRIC = { temp: ['Température', '°C'], hum: ['Humidité', '%'], co2: ['CO₂', 'ppm'], meter: ['Mesure', ''], plug: ['Puissance', 'W'], power: ['Puissance', 'W'], clim: ['Température de la pièce', '°C'] };
  const cache = {};
  B.panelExtra = id => {
    const m = (S.settings.hubMap || {})[id], k = DATA.DEVICES[id] && B.kindOf(DATA.DEVICES[id]); if (!m || !METRIC[k] || !srv()) return '';
    const r = (cache[id] && cache[id].r) || '24h';
    setTimeout(() => chart(id, r), 30);
    return '<div class="pchart" data-hist="' + id + '"><div class="row"><b>' + ico('chart') + METRIC[k][0] + '</b><span class="pcr">' + [['24h', '24 h'], ['7j', '7 j'], ['30j', '30 j']].map(x => '<button class="' + (x[0] === r ? 'on' : '') + '" data-act="histR" data-arg="' + id + '|' + x[0] + '">' + x[1] + '</button>').join('') + '</span></div><div class="pcsvg"></div></div>';
  };
  async function chart(id, r) {
    const span = { '24h': 864e5, '7j': 7 * 864e5, '30j': 30 * 864e5 }[r], c = cache[id];
    let pts = c && c.r === r && Date.now() - c.at < 60000 ? c.pts : null;
    if (!pts) { try { pts = await B.Server.req('/api/history?dev=' + encodeURIComponent(id) + '&from=' + (Date.now() - span) + '&max=200'); } catch (e) { pts = []; } cache[id] = { r, pts, at: Date.now() }; }
    document.querySelectorAll('.pchart[data-hist="' + id + '"] .pcsvg').forEach(el => { el.innerHTML = svg(pts, METRIC[B.kindOf(DATA.DEVICES[id])][1], span); });
  }
  function svg(pts, unit, span) {
    if (pts.length < 2) return '<p class="muted" style="font-size:12px;margin:6px 0">Pas encore assez de mesures : le NAS les enregistre au fil du temps.</p>';
    const W = 320, H = 110, t0 = Date.now() / 1000 - span / 1000, vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.15 || 1;
    const x = t => ((t - t0) / (span / 1000)) * W, y = v => H - ((v - lo + pad) / (hi - lo + 2 * pad)) * H;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' '), last = pts[pts.length - 1];
    const fmt = v => (Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(1).replace('.', ',')) + (unit ? ' ' + unit : '');
    return '<svg viewBox="0 0 ' + W + ' ' + (H + 4) + '" preserveAspectRatio="none" class="pcline"><defs><linearGradient id="pcg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fd3ff" stop-opacity=".35"/><stop offset="1" stop-color="#2fd3ff" stop-opacity="0"/></linearGradient></defs><path d="' + d + ' L' + x(last[0]).toFixed(1) + ' ' + H + ' L' + x(pts[0][0]).toFixed(1) + ' ' + H + 'Z" fill="url(#pcg)"/><path d="' + d + '" fill="none" stroke="#2fd3ff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="pcleg"><span>min ' + fmt(lo) + '</span><span>max ' + fmt(hi) + '</span><span>actuel <b>' + fmt(last[1]) + '</b></span></div>';
  }
  B.act('histR', el => { const [id, r] = el.dataset.arg.split('|'); cache[id] = Object.assign({}, cache[id], { r, at: 0 }); el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); chart(id, r); });

  /* ---------- page Santé ---------- */
  const H = { health: null, bridge: null, hub: null };
  async function loadHealth() {
    if (!srv()) return;
    const [h, b, hub] = await Promise.all([B.Server.req('/api/engine/health').catch(() => null), B.Server.req('/api/bridge').catch(() => null), B.Server.req('/api/hub').catch(() => null)]);
    Object.assign(H, { health: h, bridge: b, hub, at: Date.now() }); B.emit('sante');
  }
  RENDER.santeList = () => {
    if (!srv()) return '<p class="warn">La santé de la maison est suivie par le serveur Bêta du NAS : reliez-le d’abord.</p>';
    if (!H.health) return '<p class="muted">Lecture…</p>';
    const h = H.health, names = {}; (B.Hub && B.Hub.BRANDS || []).forEach(b => { names[b.id] = b.name; });
    const issues = h.devices.map(d => ({ lvl: d.lvl, icon: /pile/.test(d.issue) ? 'battery' : 'wifi', t: d.name + (d.room ? ' — ' + d.room : ''), s: d.issue, id: d.id }))
      .concat(h.brands.map(b => ({ lvl: 2, icon: 'link', t: names[b.id] || b.id, s: b.err, brand: b.id })));
    const st = H.bridge && H.bridge.status, hk = st && st.hk;
    const services = [
      ['server', 'Serveur Bêta', 'En ligne', 'g'],
      ['link', 'Pont Alexa (Matter)', st ? (st.offline ? 'Arrêté' : st.matterErr ? 'Indisponible' : st.commissioned ? 'Relié' : 'En attente d’appairage') : 'Non installé', st && !st.offline && !st.matterErr ? 'g' : 'y'],
      ['homeFill', 'Pont Maison (HomeKit)', hk ? (st.offline ? 'Arrêté' : hk.paired ? 'Relié' : 'En attente d’appairage') : 'Non installé', hk && !st.offline ? 'g' : 'y'],
      ['bellFill', 'Notifications', S.notif && Object.keys(S.notif.topic || {}).length ? 'Configurées' : 'À configurer', S.notif && Object.keys(S.notif.topic || {}).length ? 'g' : 'y']
    ];
    return '<div class="sante"><div class="sth ' + (issues.some(i => i.lvl > 1) ? 'p' : issues.length ? 'y' : 'g') + '">' + ico(issues.length ? 'alert' : 'check') + '<b>' + (issues.length ? issues.length + ' point' + (issues.length > 1 ? 's' : '') + ' à vérifier' : 'Tout va bien') + '</b><small>Vérifié par le NAS ' + (h.at ? 'à ' + F.time(new Date(h.at)) : '') + '</small></div>' +
      '<div class="list">' + (issues.map(i => '<div class="li sti ' + (i.lvl > 1 ? 'p' : 'y') + '"><span class="ic">' + ico(i.icon) + '</span><div><b>' + esc(i.t) + '</b><small>' + esc(i.s) + '</small></div>' + (i.brand ? '<button class="btn sm" data-act="hubOpen" data-arg="' + i.brand + '">' + ico('gear') + 'Ouvrir</button>' : DATA.DEVICES[i.id] ? '<button class="btn sm" data-act="panel" data-id="' + i.id + '">' + ico('dots') + '</button>' : '') + '</div>').join('') || '<p class="muted" style="font-size:13px">Aucun appareil hors ligne, aucune pile faible, toutes les marques répondent.</p>') + '</div>' +
      '<h4 class="rlh">' + ico('server') + 'Services</h4><div class="stsv">' + services.map(s => '<div class="' + s[3] + '">' + ico(s[0]) + '<b>' + s[1] + '</b><small>' + s[2] + '</small></div>').join('') + '</div>' +
      '<p class="muted" style="font-size:12px;margin:10px 0 0">Vous recevez une notification quand un nouveau problème apparaît (Notifs › « Santé de la maison »).</p></div>';
  };
  B.route('sante', { title: 'Santé', bg: 'assets/bg/generic.jpg', render: () => B.side('sante') + B.header({ id: 'sante', title: 'Santé de la maison', sub: 'Appareils hors ligne, piles faibles, services', icon: 'heart', info: { t: 'infobox', keys: ['sante'], items: () => {
    const h = H.health || { devices: [], brands: [] };
    return [{ icon: 'wifi', v: h.devices.filter(d => d.issue === 'hors ligne').length, l: 'Hors ligne', cls: h.devices.some(d => d.issue === 'hors ligne') ? 'p' : 'g' }, { icon: 'battery', v: h.devices.filter(d => /pile/.test(d.issue)).length, l: 'Piles faibles' }, { icon: 'link', v: h.brands.length, l: 'Marques en erreur', cls: h.brands.length ? 'p' : 'g' }, { icon: 'homeFill', v: Object.keys(S.settings.hubMap || {}).length, l: 'Appareils suivis', cls: 'c' }];
  } } }) + '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('heart', 'Santé', '<button class="wmore" data-act="santeReload" aria-label="Actualiser">' + ico('refresh') + '</button>') + T({ t: 'santeList', keys: ['sante'] }) + '</section>', after: () => loadHealth() });
  B.act('santeReload', loadHealth);
  setInterval(() => { if (B.current === 'sante') loadHealth(); }, 60000);
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); const i = out.findIndex(n => n[0] === 'journal'); if (!out.some(n => n[0] === 'sante')) out.splice(i < 0 ? out.length : i, 0, ['sante', 'Santé', 'heart', 'heart', 'noside']); return out; };

  /* ---------- Tempo et vigilance : dans les alertes de l'accueil et de l'écran de verrouillage ---------- */
  const wx0 = B.wxAlerts;
  B.wxAlerts = () => {
    const out = [], st = BR().status || {}, v = st.vigil, t = st.tempo;
    if (v && v.items && v.items.length) v.items.filter(x => x.level >= 2).sort((a, b) => b.level - a.level).slice(0, 2).forEach(x => out.push({ icon: 'alert', text: 'Vigilance ' + x.color + ' ' + x.phen + ' (' + x.when + ')', vig: x.level }));
    if (t && t.tomorrow && t.tomorrow !== 'bleu') out.push({ icon: 'boltPlain', text: 'Demain : jour ' + t.tomorrow.toUpperCase() + ' Tempo', tempo: t.tomorrow });
    else if (t && t.today === 'rouge') out.push({ icon: 'boltPlain', text: 'Aujourd’hui : jour ROUGE Tempo (6 h – 22 h)', tempo: 'rouge' });
    return out.concat(wx0 ? wx0() : []);
  };
  // pastille Tempo du jour dans l'en-tête de la page Énergie
  const en = B.ROUTES && B.ROUTES.energie;
  if (en) { const r0 = en.render; en.render = () => { const h = r0(), t = (BR().status || {}).tempo; return t && t.today ? h.replace('</section>', '</section><div class="tempo-chip abs t-' + t.today + '">' + ico('boltPlain') + 'Tempo : <b>' + t.today + '</b>' + (t.tomorrow ? ' · demain <b>' + t.tomorrow + '</b>' : '') + '</div>') : h; }; }

  /* ---------- collectes de déchets : affichées dans le calendrier et sur l'écran de verrouillage ---------- */
  async function trashSync() {
    if (!srv()) return;
    let list; try { list = await B.Server.req('/api/engine/trash?days=45'); } catch (e) { return; }
    S.events = (S.events || []).filter(e => !e.trashAuto).concat(list.map(e => ({ id: 'trash:' + e.date + ':' + e.name, date: e.date, time: '', title: e.name + ' (collecte)', cal: 'maison', color: e.color || '#22e3a4', trashAuto: true })));
    S.notif = S.notif || {}; S.notif.trashServer = list.length > 0;   // le NAS envoie le rappel la veille
    B.save(); B.emit('events'); B.emit('house');
  }
  setTimeout(trashSync, 4000); setInterval(trashSync, 6 * 36e5);

  /* ---------- réglages : Tempo, vigilance, collectes ---------- */
  const DN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function svcBody() {
    const c = BR().cfg || {}, tp = c.tempo || {}, vg = c.vigil || {}, tr = c.trash || { rules: [] }, st = BR().status || {};
    return '<h2>' + ico('sparkle') + 'Services de la maison</h2>' +
      '<section class="svsec"><h4 class="rlh">' + ico('boltPlain') + 'EDF Tempo</h4><label class="row tbsw"><button type="button" class="sw sm' + (tp.on ? ' on' : '') + '" data-act="svTempo"></button><span>Suivre la couleur Tempo (aujourd’hui et demain) et prévenir la veille d’un jour rouge</span></label>' +
        (st.tempo && st.tempo.today ? '<p class="muted">Aujourd’hui : <b>' + st.tempo.today + '</b>' + (st.tempo.tomorrow ? ' · demain : <b>' + st.tempo.tomorrow + '</b>' : ' · demain : publié vers 11 h') + '</p>' : '') + '</section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('alert') + 'Vigilance Météo-France</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 8px">Créez une clé gratuite sur <b>portail-api.meteofrance.fr</b> (API « Données Publiques Vigilance »), puis collez-la ici. Département : Bas-Rhin (67) pour Fegersheim.</p>' +
        '<div class="grid2"><label class="field">Clé d’API<input type="password" placeholder="' + (vg.key ? 'déjà enregistrée' : 'eyJ…') + '" data-change="svVigKey" autocomplete="off"></label><label class="field">Département<input value="' + esc(vg.dept || '67') + '" data-change="svVigDept" maxlength="3"></label>' +
        '<label class="field">Prévenir à partir de<select data-change="svVigLvl">' + [[2, 'jaune'], [3, 'orange'], [4, 'rouge']].map(o => '<option value="' + o[0] + '"' + ((vg.level || 3) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label></div>' +
        (st.vigil ? '<p class="muted">' + (st.vigil.err ? '⚠ ' + esc(st.vigil.err) : 'Niveau actuel : <b>' + (st.vigil.color || 'vert') + '</b>' + (st.vigil.items && st.vigil.items.length ? ' — ' + esc(st.vigil.items.map(x => x.phen + ' ' + x.color + ' (' + x.when + ')').join(', ')) : '')) + '</p>' : '') + '</section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('trash') + 'Collectes des déchets</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 8px">Fegersheim fait partie de l’Eurométropole de Strasbourg : reprenez les jours de votre calendrier de collecte (papier ou site de l’Eurométropole). Si vous avez un lien de calendrier (.ics), collez-le : il s’ajoute aux règles.</p>' +
        (tr.rules || []).map((r, i) => '<div class="rlrow"><input value="' + esc(r.name) + '" data-change="svTr" data-arg="' + i + '|name" placeholder="Bac jaune (tri)"><select data-change="svTr" data-arg="' + i + '|day">' + DN.map((d, j) => '<option value="' + j + '"' + (+r.day === j ? ' selected' : '') + '>' + d + '</option>').join('') + '</select><select data-change="svTr" data-arg="' + i + '|every"><option value="1"' + (+r.every !== 2 ? ' selected' : '') + '>chaque semaine</option><option value="2"' + (+r.every === 2 ? ' selected' : '') + '>une semaine sur deux</option></select>' +
          (+r.every === 2 ? '<label class="rlck">dont le<input type="date" value="' + esc(r.ref || '') + '" data-change="svTr" data-arg="' + i + '|ref"></label>' : '') + '<input type="color" value="' + esc(r.color || '#22e3a4') + '" data-change="svTr" data-arg="' + i + '|color"><button type="button" class="sq" data-act="svTrDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="svTrAdd">' + ico('plus') + 'Collecte</button><button type="button" class="btn sm" data-act="svTrTpl">' + ico('sparkle') + 'Modèle Eurométropole</button></div>' +
        '<div class="grid2" style="margin-top:8px"><label class="field">Calendrier .ics (facultatif)<input value="' + esc(tr.ics || '') + '" data-change="svTrIcs" placeholder="https://…/collectes.ics"></label><label class="field">Rappel la veille à<input type="time" value="' + esc(tr.at || '19:00') + '" data-change="svTrAt"></label></div></section>';
  }
  const svRedraw = () => { const m = document.querySelector('.svmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + svcBody(); m.scrollTop = sc; } };
  const svSave = async patch => { if (B.brainSave && await B.brainSave(patch)) { svRedraw(); if (patch.trash) trashSync(); setTimeout(async () => { try { S.brain.status = await B.Server.req('/api/engine/status'); svRedraw(); B.emit('brain'); } catch (e) { } }, 2500); } };
  const trs = () => JSON.parse(JSON.stringify(((BR().cfg || {}).trash || {}).rules || []));
  B.act('svcOpen', async () => { if (!srv()) return B.toast('Serveur Bêta nécessaire', 'server'); if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); try { S.brain.cfg = await B.Server.req('/api/engine'); S.brain.status = await B.Server.req('/api/engine/status'); } catch (e) { } B.modal(svcBody(), 'wide svmodal'); });
  B.act('svTempo', () => svSave({ tempo: { on: !(((BR().cfg || {}).tempo) || {}).on } }));
  B.act('svVigKey', el => { if (el.value.trim()) svSave({ vigil: { key: el.value.trim() } }); });
  B.act('svVigDept', el => svSave({ vigil: { dept: el.value.trim() || '67' } }));
  B.act('svVigLvl', el => svSave({ vigil: { level: +el.value } }));
  B.act('svTr', el => { const [i, k] = el.dataset.arg.split('|'), l = trs(); l[+i][k] = k === 'day' || k === 'every' ? +el.value : el.value; svSave({ trash: { rules: l } }); });
  B.act('svTrDel', el => { const l = trs(); l.splice(+el.dataset.arg, 1); svSave({ trash: { rules: l } }); });
  B.act('svTrAdd', () => svSave({ trash: { rules: trs().concat([{ name: 'Nouvelle collecte', day: 1, every: 1, color: '#22e3a4' }]) } }));
  // modèle courant dans l'Eurométropole : ordures chaque semaine, tri une semaine sur deux, verre/biodéchets à ajuster
  B.act('svTrTpl', () => { const nx = d => { const x = new Date(); x.setDate(x.getDate() + ((d - x.getDay() + 7) % 7 || 7)); return F.ymd(x); }; svSave({ trash: { rules: trs().concat([{ name: 'Ordures ménagères (bac gris)', day: 2, every: 1, color: '#8a9bb5' }, { name: 'Tri sélectif (bac jaune)', day: 4, every: 2, ref: nx(4), color: '#ffd23f' }, { name: 'Biodéchets (bac marron)', day: 5, every: 1, color: '#a0703c' }]) } }); B.toast('Modèle ajouté : ajustez les jours d’après votre calendrier de Fegersheim', 'trash'); });
  B.act('svTrIcs', el => svSave({ trash: { ics: el.value.trim() } }));
  B.act('svTrAt', el => svSave({ trash: { at: el.value || '19:00' } }));

  /* ---------- sécurité : codes PIN du NAS, mode sécurisé, écrans associés ---------- */
  const A = { info: null };
  async function loadAuth() { try { A.info = await B.Server.req('/api/auth'); } catch (e) { A.info = null; } }
  // session administrateur : demandée quand le NAS refuse un réglage (mode sécurisé)
  B.adminLogin = () => new Promise(done => {
    const admins = S.users.filter(u => u.admin), me = B.user(), u0 = admins.find(u => u.id === (me && me.id)) || admins[0];
    if (!u0) return done(false);
    let pin = '', who = u0.id;
    const m = B.modal('<div class="pinpad"><b>' + ico('lock') + ' Code administrateur</b><span class="muted">Le serveur demande le code PIN d’un administrateur</span><select class="search" data-who>' + admins.map(u => '<option value="' + u.id + '"' + (u.id === who ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select><div class="pinv"></div><div class="keys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => '<button data-k="' + k + '">' + k + '</button>').join('') + '</div></div>', 'sm pin');
    let closed = false; const fin = v => { if (closed) return; closed = true; B.closeModal(); done(v); };
    const show = () => { m.querySelector('.pinv').textContent = '•'.repeat(pin.length) || ' '; };
    m.querySelector('[data-who]').addEventListener('change', e => { who = e.target.value; });
    new MutationObserver((x, o) => { if (!document.body.contains(m)) { o.disconnect(); fin(false); } }).observe(document.body, { childList: true, subtree: true });
    m.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.dataset.k;
      if (k !== '✓') { pin = k === '⌫' ? pin.slice(0, -1) : (pin + k).slice(0, 8); return show(); }
      if (pin.length < 4) return;
      try { const r = await fetch(B.Server.url() + '/api/auth/login', { method: 'POST', headers: B.Server.headers(), body: JSON.stringify({ user: who, pin, long: true }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); sessionStorage.setItem('betaos.session', j.session); fin(true); }
      catch (err) { const p = m.querySelector('.pinpad'); p.classList.add('shake'); B.toast(err.message, 'lock'); setTimeout(() => { p.classList.remove('shake'); pin = ''; show(); }, 450); }
    });
  });
  function secBody() {
    const a = A.info;
    if (!a) return '<h2>' + ico('lock') + 'Sécurité</h2><p class="warn">Serveur Bêta injoignable.</p>';
    return '<h2>' + ico('lock') + 'Sécurité</h2><p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">Les codes PIN sont gardés (hachés) sur le NAS. En mode sécurisé, les réglages de la maison demandent le code d’un administrateur, et chaque nouvel écran doit être associé avec un code.</p>' +
      '<div class="list">' + S.users.map(u => { const x = a.users.find(y => y.id === u.id); return '<div class="li prow"><img src="' + esc(u.avatar) + '" alt=""><div><b>' + esc(u.name) + (u.admin ? ' <small class="tag2">admin</small>' : '') + ' <small class="tag2 ' + (x && x.pin ? '' : 'wait') + '">' + (x && x.pin ? 'code défini' : 'pas de code') + '</small></b><span class="row" style="gap:6px"><input type="password" inputmode="numeric" maxlength="8" placeholder="Nouveau code (4 à 8 chiffres)" data-pin="' + u.id + '" class="secpin"><button class="btn sm" data-act="secPin" data-arg="' + u.id + '">' + ico('check') + 'Enregistrer</button></span></div></div>'; }).join('') + '</div>' +
      '<div class="tbbox" style="margin-top:12px"><label class="row tbsw"><button type="button" class="sw sm' + (a.secure ? ' on' : '') + '" data-act="secOn"></button><span><b>Mode sécurisé</b> — réglages protégés par le code d’un administrateur</span></label></div>' +
      '<h4 class="rlh">' + ico('monitor') + 'Écrans associés</h4><div class="list">' + (a.devices.map(d => '<div class="li" style="grid-template-columns:30px 1fr auto"><span class="ic">' + ico('monitor') + '</span><div><b>' + esc(d.name) + '</b><small>associé le ' + new Date(d.at).toLocaleDateString('fr-FR') + (d.last ? ' · vu ' + new Date(d.last).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</small></div><button class="btn sm dan" data-act="secRevoke" data-arg="' + d.id + '">' + ico('trash') + 'Retirer</button></div>').join('') || '<p class="muted" style="font-size:13px">Aucun écran associé : ils utilisent encore la clé du serveur.</p>') + '</div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" data-act="secPairStart">' + ico('plus') + 'Associer un nouvel écran</button>' + (S.conn.server.key && !S.conn.server.device ? '<button class="btn" data-act="secPairMe">' + ico('monitor') + 'Associer cet écran (et oublier la clé)</button>' : '') + '</div><div class="secpair"></div>';
  }
  const secRedraw = async () => { await loadAuth(); const m = document.querySelector('.secmodal'); if (m) m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + secBody(); };
  B.act('secOpen', async () => { if (!srv()) return B.toast('Serveur Bêta nécessaire', 'server'); await loadAuth(); try { await B.Server.post('/api/auth/users', { users: S.users.map(u => ({ id: u.id, name: u.name, admin: !!u.admin })) }); } catch (e) { } await loadAuth(); B.modal(secBody(), 'wide secmodal'); });
  B.act('secPin', async el => { const id = el.dataset.arg, v = (document.querySelector('[data-pin="' + id + '"]') || {}).value || ''; if (!/^\d{4,8}$/.test(v)) return B.toast('4 à 8 chiffres', 'info'); try { await B.Server.post('/api/auth/pin', { user: id, pin: v }); const u = S.users.find(x => x.id === id); if (u && v.length === 4) { u.pin = v; B.save(); } B.toast('Code enregistré sur le NAS', 'lock'); secRedraw(); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('secOn', async () => { try { await B.Server.post('/api/auth/secure', { on: !A.info.secure }); B.toast(A.info.secure ? 'Mode sécurisé désactivé' : 'Mode sécurisé activé', 'lock'); secRedraw(); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('secRevoke', async el => { if (!confirm('Retirer cet écran ? Il devra être associé à nouveau.')) return; try { await B.Server.post('/api/auth/revoke', { id: el.dataset.arg }); secRedraw(); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('secPairStart', async () => { try { const r = await B.Server.post('/api/auth/pair/start', {}); const box2 = document.querySelector('.secpair'); if (box2) box2.innerHTML = '<div class="paircode"><small>Sur le nouvel écran : Connexions › Serveur Bêta › « J’ai un code d’association »</small><b>' + r.code.slice(0, 3) + ' ' + r.code.slice(3) + '</b><small>Valable 10 minutes, une seule fois.</small></div>'; } catch (e) { B.toast(e.message, 'info'); } });
  B.act('secPairMe', async () => { try { const r = await B.Server.post('/api/auth/pair/start', {}); await pairWith(r.code, (B.devCfgName && B.devCfgName()) || 'Écran'); secRedraw(); } catch (e) { B.toast(e.message, 'info'); } });
  async function pairWith(code, name) {
    const r = await fetch(B.Server.url() + '/api/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'association refusée');
    S.conn.server.device = j.device; S.conn.server.key = ''; B.save(); await B.Server.ping(); B.toast('Écran associé au serveur Bêta', 'check');
  }
  // sur un nouvel écran : saisir le code d'association au lieu de la clé
  B.act('pairCode', async () => {
    const url = (document.querySelector('[name=srvUrl], #srvUrl, input[data-k="url"]') || {}).value || S.conn.server.url; if (url) S.conn.server.url = url.trim().replace(/\/+$/, '');
    if (!S.conn.server.url) return B.toast('Indiquez d’abord l’adresse du serveur', 'server');
    const code = prompt('Code d’association à 6 chiffres (affiché sur un écran administrateur, Paramètres › Sécurité)'); if (!code) return;
    try { await pairWith(code.replace(/\D/g, ''), prompt('Nom de cet écran', 'Tablette') || 'Écran'); B.show(); } catch (e) { B.toast(e.message, 'info'); }
  });

  /* ---------- accès : boutons dans Paramètres et Connexions ---------- */
  const sfx1 = B.RENDER.sfx;
  if (sfx1) B.RENDER.sfx = s => sfx1(s).replace('<button class="btn sm" data-act="brandsCfg">', '<button class="btn sm" data-act="secOpen">' + ico('lock') + 'Sécurité</button><button class="btn sm" data-act="svcOpen">' + ico('sparkle') + 'Services</button><button class="btn sm" data-act="brandsCfg">');
  const conn0 = B.RENDER.conn;
  if (conn0) B.RENDER.conn = s => conn0(s).replace('<div class="csave">', '<div class="ccard tile wide2"><div class="cch">' + B.badge('lock') + '<div><b>Associer cet écran par code</b><small>Plus besoin de la clé du serveur : un administrateur affiche un code (Paramètres › Sécurité)</small></div></div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="pairCode">' + ico('monitor') + 'J’ai un code d’association</button></div></div><div class="csave">');
})();
