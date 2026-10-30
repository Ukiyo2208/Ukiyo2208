/* Bêta home 7.15 — famille et maison (côté écran) :
   calendriers iCloud, colis, missions des enfants, mode baby-sitter, cadre photo, mode vacances, résumé d'absence,
   bilan du mois, sonnette (photo, réponses rapides, visiteurs), recharge de la voiture, grand texte, association par QR code */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const req = (p, b, m) => B.Server.req(p, b, m);
  const mod = id => !B.modOn || B.modOn(id);
  const FM = B.FM = { cfg: null, state: null, parcels: [], mail: null, events: [] };
  async function load() { if (!srv()) return null; try { const r = await req('/api/famille'); FM.state = r.state; delete r.state; FM.cfg = r; } catch (e) { FM.cfg = null; } B.emit('famille'); sitterCheck(); return FM.cfg; }
  const save = async patch => { try { const r = await req('/api/famille', patch, 'PUT'); FM.cfg = Object.assign(FM.cfg || {}, r); B.emit('famille'); return true; } catch (e) { B.toast(e.message, 'info'); return false; } };
  setTimeout(load, 3000); setInterval(() => { if (!document.hidden) load(); }, 5 * 6e4);
  const need = () => { if (!srv()) { B.toast('Serveur Bêta du NAS nécessaire (Connexions)', 'server'); return false; } if (!FM.cfg) { B.toast('Mettez à jour le serveur Bêta (module « famille » absent)', 'server'); return false; } return true; };
  const needAdmin = () => { if (!isAdmin()) { B.toast('Réservé aux administrateurs', 'lock'); return false; } return need(); };
  const modal = (cls, html) => { const m = document.querySelector('.' + cls); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + html; m.scrollTop = sc; } else B.modal(html, 'wide ' + cls); };
  const sw = (act, on, label) => '<label class="row tbsw"><button type="button" class="sw sm' + (on ? ' on' : '') + '" data-act="' + act + '"></button><span>' + label + '</span></label>';
  const ck = (act, arg, on, label) => '<label class="rlck"><input type="checkbox" data-change="' + act + '" data-arg="' + esc(arg) + '"' + (on ? ' checked' : '') + '>' + label + '</label>';
  const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const daysPick = (act, arg, days) => '<span class="rldays">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="pinc' + ((days || []).includes(d) ? ' on' : '') + '" data-act="' + act + '" data-arg="' + arg + '|' + d + '">' + DAYS[d] + '</button>').join('') + '</span>';
  const tog = (l, v) => { l = (l || []).slice(); const i = l.indexOf(v); i >= 0 ? l.splice(i, 1) : l.push(v); return l; };
  const hm = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const eur = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  // adresse d'une image servie par le NAS (balise <img> : la clé ou le jeton de l'écran passent dans l'adresse)
  const media = p => { const K = S.conn.server; return B.Server.url() + p + (p.includes('?') ? '&' : '?') + (K.device ? 'd=' + encodeURIComponent(K.device) : 'k=' + encodeURIComponent(K.key || '')); };
  const clone = k => JSON.parse(JSON.stringify((FM.cfg || {})[k] || []));

  /* ======================= 1. calendriers iCloud ======================= */
  async function syncCal() {
    if (!srv() || !FM.cfg || !(FM.cfg.cals || []).length) return;
    let r; try { r = await req('/api/famille/events?days=45'); } catch (e) { return; }
    FM.calErr = r.err || {};
    S.events = (S.events || []).filter(e => !e.icloudAuto).concat(r.list.map(e => ({ id: e.id, date: e.date, time: e.time, dur: e.dur || 60, title: e.title + (e.who ? ' · ' + e.who : ''), color: e.color || '#ff2968', where: e.where, icloudAuto: true, cal: 'icloud' })));
    B.save(); B.emit('events'); B.emit('matin');
  }
  setTimeout(syncCal, 6000); setInterval(syncCal, 10 * 6e4);
  let FOUND = null;
  function calBody() {
    const c = FM.cfg, cals = c.cals || [];
    return '<h2>' + ico('calendar') + 'Calendriers de l’iPhone (iCloud)</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Les agendas de vos iPhone s’affichent sur les tablettes, dans le Calendrier et le tableau du matin (en lecture seule).</p>' +
      '<div class="list">' + cals.map((x, i) => '<div class="li calli"><span class="calc" style="background:' + esc(x.color || '#ff2968') + '"></span><div><b>' + esc(x.name) + '</b><small>' + (x.caldav ? 'compte iCloud' : 'lien public') + (FM.calErr && FM.calErr[x.id] ? ' · ⚠ ' + esc(FM.calErr[x.id]) : '') + '</small></div><select data-change="icWho" data-arg="' + i + '"><option value="">toute la famille</option>' + S.users.map(u => '<option' + (x.who === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select><input type="color" value="' + esc(x.color || '#ff2968') + '" data-change="icColor" data-arg="' + i + '"><button class="sq" data-act="icDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') + '</div>' +
      '<section class="svsec"><h4 class="rlh">' + ico('link') + 'Le plus simple : un lien de partage</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">iPhone › Calendrier › Calendriers › ⓘ à côté du calendrier › activez <b>Calendrier public</b> › Partager le lien. Collez-le ici (webcal://…).</p><form class="calform rlrow"><input placeholder="Nom (ex. Travail Sarah)" style="flex:1 1 140px"><input placeholder="webcal://p…-caldav.icloud.com/published/…" style="flex:2 1 240px"><button class="btn sm pri">' + ico('plus') + 'Ajouter</button></form></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('lock') + 'Ou tous vos calendriers avec votre compte Apple</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">appleid.apple.com › Connexion et sécurité › <b>Mots de passe pour app</b> › créez-en un pour « Bêta home ». Il est gardé sur le NAS seulement.</p><div class="grid2"><label class="field">Identifiant Apple<input value="' + esc(c.icloud.user || '') + '" data-change="icAcc" data-arg="user" placeholder="prenom@icloud.com"></label><label class="field">Mot de passe pour app<input type="password" placeholder="' + (c.icloud.pass ? 'déjà enregistré' : 'xxxx-xxxx-xxxx-xxxx') + '" data-change="icAcc" data-arg="pass"></label></div>' +
      '<button class="btn sm" data-act="icFind">' + ico('search') + 'Trouver mes calendriers</button>' + (FOUND ? '<div class="alpick">' + FOUND.map((f, i) => ck('icPick', i, cals.some(x => x.url === f.url), '<span class="calc" style="background:' + esc(f.color || '#ff2968') + '"></span>' + esc(f.name))).join('') + '</div>' : '') + '</section>';
  }
  const calR = () => modal('calmodal', calBody());
  const calSave = async l => { if (await save({ cals: l })) { calR(); syncCal(); } };
  B.act('icOpen', async () => { if (!needAdmin()) return; await load(); calR(); });
  B.act('icWho', el => { const l = clone('cals'); l[+el.dataset.arg].who = el.value; calSave(l); });
  B.act('icColor', el => { const l = clone('cals'); l[+el.dataset.arg].color = el.value; calSave(l); });
  B.act('icDel', el => { const l = clone('cals'); l.splice(+el.dataset.arg, 1); S.events = (S.events || []).filter(e => !e.icloudAuto); calSave(l); });
  B.act('icAcc', async el => { await save({ icloud: { [el.dataset.arg]: el.value.trim() } }); calR(); });
  B.act('icFind', async () => { try { FOUND = await req('/api/famille/icloud/calendars'); if (!FOUND.length) B.toast('Aucun calendrier trouvé', 'info'); calR(); } catch (e) { B.toast(e.message, 'lock'); } });
  B.act('icPick', el => { const f = FOUND[+el.dataset.arg], l = clone('cals').filter(x => x.url !== f.url); if (el.checked) l.push({ id: 'c' + Date.now().toString(36), name: f.name, color: f.color || '#ff2968', caldav: true, url: f.url, who: '' }); calSave(l); });
  document.addEventListener('submit', e => { if (!e.target.classList || !e.target.classList.contains('calform')) return; e.preventDefault(); const [n, u] = e.target.querySelectorAll('input'); if (!/^(webcal|https?):\/\//i.test(u.value.trim())) return B.toast('Collez le lien webcal:// du calendrier public', 'info'); calSave(clone('cals').concat([{ id: 'c' + Date.now().toString(36), name: n.value.trim() || 'iCloud', ics: u.value.trim(), color: '#ff2968', who: '' }])); });

  /* ======================= 2. colis ======================= */
  async function loadParcels() { if (!srv() || !FM.cfg) return; try { const r = await req('/api/famille/parcels'); FM.parcels = r.list; FM.mail = r.mail; } catch (e) { } B.emit('famille'); B.emit('matin'); B.emit('house'); }
  setTimeout(loadParcels, 5000); setInterval(loadParcels, 15 * 6e4);
  const ST = { transit: ['En route', 'route'], today: ['Livraison aujourd’hui', 'carFill'], delivered: ['Livré', 'check'] };
  function pkBody() {
    const c = FM.cfg, l = FM.parcels || [], mail = S.conn.mail || {};
    return '<h2>' + ico('download') + 'Colis</h2>' +
      '<div class="list">' + (l.map(p => '<div class="li pkli ' + p.state + '"><span class="ic">' + ico(ST[p.state][1]) + '</span><div><b>' + esc(p.label || p.carrier) + '</b><small>' + esc(p.carrier + ' · ' + p.number) + ' · ' + ST[p.state][0] + (p.status && p.status !== p.label ? ' — ' + esc(p.status.slice(0, 90)) : '') + '</small></div><span class="row" style="gap:6px">' + (p.url ? '<a class="btn sm" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + ico('link') + 'Suivi</a>' : '') + (p.state !== 'delivered' ? '<button class="btn sm" data-act="pkDone" data-arg="' + p.id + '">' + ico('check') + 'Reçu</button>' : '') + '<button class="sq" data-act="pkDel" data-arg="' + p.id + '">' + ico('x') + '</button></span></div>').join('') || '<p class="muted">Aucun colis en cours.</p>') + '</div>' +
      '<form class="pkform rlrow"><input placeholder="Numéro de suivi" style="flex:1 1 180px"><input placeholder="Quoi ? (ex. chaussures)" style="flex:1 1 140px"><button class="btn sm pri">' + ico('plus') + 'Ajouter</button></form>' +
      '<section class="svsec"><h4 class="rlh">' + ico('mail') + 'Trouver les colis dans mes mails</h4><p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 6px">Le NAS lit l’objet et le début des mails des 14 derniers jours (rien n’est modifié ni envoyé) et repère les numéros Colissimo, Chronopost, La Poste, UPS, DHL, GLS, DPD, Mondial Relay et les livraisons Amazon.</p>' +
      sw('pkMail', c.mail.on, 'Analyser mes mails toutes les 30 min') + '<div class="grid2"><label class="field">Serveur IMAP<input value="' + esc(c.mail.imap || mail.imap || '') + '" data-change="pkM" data-arg="imap" placeholder="imap.gmail.com"></label><label class="field">Adresse<input value="' + esc(c.mail.user || mail.user || '') + '" data-change="pkM" data-arg="user"></label><label class="field">Mot de passe (d’application)<input type="password" placeholder="' + (c.mail.pass ? 'déjà enregistré' : '') + '" data-change="pkM" data-arg="pass"></label></div>' +
      (mail.imap && mail.pass && !c.mail.pass ? '<button class="btn sm" data-act="pkCopy">' + ico('mail') + 'Reprendre la messagerie de Connexions</button> ' : '') + '<button class="btn sm" data-act="pkScan">' + ico('refresh') + 'Analyser maintenant</button>' + (FM.mail && FM.mail.at ? '<small class="muted"> ' + (FM.mail.err ? '⚠ ' + esc(FM.mail.err) : 'dernière lecture ' + hm(FM.mail.at)) + '</small>' : '') + '</section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('route') + 'Suivi détaillé La Poste, Colissimo, Chronopost</h4><label class="field">Clé gratuite (developer.laposte.fr › API Suivi)<input type="password" placeholder="' + (c.laposte ? 'déjà enregistrée' : 'X-Okapi-Key') + '" data-change="pkKey"></label></section>';
  }
  const pkR = async () => { await loadParcels(); modal('pkmodal', pkBody()); };
  B.act('pkOpen', async () => { if (!need()) return; await load(); pkR(); });
  const pkPost = async b => { try { const r = await req('/api/famille/parcels', b); FM.parcels = r.list; FM.mail = r.mail; modal('pkmodal', pkBody()); B.emit('matin'); } catch (e) { B.toast(e.message, 'info'); } };
  B.act('pkDel', el => pkPost({ del: el.dataset.arg }));
  B.act('pkDone', el => pkPost({ delivered: el.dataset.arg }));
  B.act('pkScan', () => { B.toast('Lecture des mails…', 'mail'); pkPost({ scan: true }); });
  B.act('pkMail', async () => { if (!isAdmin()) return; await save({ mail: { on: !FM.cfg.mail.on } }); pkR(); });
  B.act('pkM', async el => { if (!isAdmin()) return; await save({ mail: { [el.dataset.arg]: el.value.trim() } }); });
  B.act('pkCopy', async () => { const m = S.conn.mail; if (await save({ mail: { imap: m.imap, port: +m.port || 993, user: m.user, pass: m.pass, on: true } })) { const t = await req('/api/famille/mail/test', {}); B.toast(t.ok ? 'Messagerie reliée (' + t.n + ' mail(s) récents)' : t.error, t.ok ? 'check' : 'info'); pkR(); } });
  B.act('pkKey', async el => { await save({ laposte: el.value.trim() }); pkR(); });
  document.addEventListener('submit', e => { if (!e.target.classList || !e.target.classList.contains('pkform')) return; e.preventDefault(); const [n, l] = e.target.querySelectorAll('input'); if (n.value.trim()) pkPost({ number: n.value.trim(), label: l.value.trim() }); });
  const today = () => (FM.parcels || []).filter(p => p.state === 'today');
  const wx0 = B.wxAlerts; B.wxAlerts = () => (mod('colis') ? today().slice(0, 2).map(p => ({ icon: 'download', text: 'Livraison aujourd’hui : ' + (p.label || p.carrier), parcel: true })) : []).concat(wx0 ? wx0() : []);
  const mw0 = RENDER.mWeather; if (mw0) RENDER.mWeather = () => { const h = mw0(), l = (FM.parcels || []).filter(p => p.state !== 'delivered'); return l.length && mod('colis') ? h.replace('<div class="mchips">', '<div class="mchips">' + l.slice(0, 3).map(p => '<span' + (p.state === 'today' ? ' class="t-blanc"' : '') + '>' + ico('download') + esc((p.state === 'today' ? 'Aujourd’hui : ' : 'En route : ') + (p.label || p.carrier)) + '</span>').join('')) : h; };

  /* ======================= 3. missions des enfants ======================= */
  const kids = () => S.users.filter(u => !u.admin || u.child);
  const doneToday = (c) => (FM.cfg.done || []).some(x => x.chore === c.id && x.day === F.ymd(new Date()));
  RENDER.msKids = () => {
    if (!srv() || !FM.cfg) return '<p class="warn">Les missions sont gardées sur le serveur Bêta du NAS : reliez-le d’abord.</p>';
    const pts = (FM.state || {}).points || {}, d = new Date();
    return '<div class="mskids">' + kids().map(u => { const l = (FM.cfg.chores || []).filter(c => c.who === u.name && (!c.days || !c.days.length || c.days.includes(d.getDay()))); return '<div class="mskid"><div class="mshead"><img src="' + esc(u.avatar) + '" alt=""><div><b>' + esc(u.name) + '</b><small>' + l.filter(doneToday).length + ' / ' + l.length + ' aujourd’hui</small></div><span class="mspts">' + ico('heartFill') + (pts[u.name] || 0) + '</span></div>' +
      '<div class="msl">' + (l.map(c => '<button class="msc' + (doneToday(c) ? ' done' : '') + '" data-act="msDo" data-arg="' + c.id + '">' + ico(doneToday(c) ? 'check' : c.icon || 'sparkle') + '<span>' + esc(c.name) + '</span><small>+' + c.points + '</small></button>').join('') || '<p class="muted" style="font-size:13px">Pas de mission aujourd’hui.</p>') + '</div>' +
      ((FM.cfg.rewards || []).length ? '<div class="msrw">' + FM.cfg.rewards.map(r => '<button class="btn sm' + ((pts[u.name] || 0) >= r.cost ? '' : ' dis') + '" data-act="msRw" data-arg="' + r.id + '|' + esc(u.name) + '">' + ico('heart') + esc(r.name) + ' · ' + r.cost + '</button>').join('') + '</div>' : '') + '</div>'; }).join('') + '</div>' +
      (isAdmin() ? '<div class="row" style="gap:8px;margin-top:10px"><button class="btn" data-act="msCfg">' + ico('gear') + 'Missions et récompenses</button></div>' : '');
  };
  B.route('missions', { title: 'Missions', bg: 'assets/bg/generic.jpg', render: () => B.side('missions') + B.header({ id: 'missions', title: 'Missions', sub: 'Les tâches des enfants, avec des points', icon: 'heart', info: { t: 'infobox', keys: ['famille'], items: () => { const pts = (FM.state || {}).points || {}; return kids().slice(0, 4).map(u => ({ icon: 'heartFill', v: pts[u.name] || 0, l: u.name, cls: 'y' })); } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('heart', 'Aujourd’hui') + T({ t: 'msKids', keys: ['famille'] }) + '</section>', after: () => load() });
  const msPost = async b => { try { const r = await req('/api/famille/chore', b); FM.cfg.done = r.done; FM.state.points = r.points; B.emit('famille'); return true; } catch (e) { B.toast(e.message, 'info'); return false; } };
  B.act('msDo', async el => { const c = FM.cfg.chores.find(x => x.id === el.dataset.arg), was = doneToday(c); if (await msPost({ done: el.dataset.arg }) && !was) { B.toast('Bravo ' + c.who + ' ! +' + c.points + ' point' + (c.points > 1 ? 's' : ''), 'heartFill'); if (B.fx && B.fx.sound) try { B.fx.sound('notify'); } catch (e) { } } });
  B.act('msRw', async el => { const [id, who] = el.dataset.arg.split('|'), r = FM.cfg.rewards.find(x => x.id === id); if (!confirm('Échanger ' + r.cost + ' points contre « ' + r.name + ' » pour ' + who + ' ?')) return; if (await msPost({ reward: id, who })) B.toast('Demande envoyée aux parents 🎁', 'heart'); });
  function msBody() {
    const ch = FM.cfg.chores || [], rw = FM.cfg.rewards || [];
    return '<h2>' + ico('heart') + 'Missions et récompenses</h2><h4 class="rlh">' + ico('sparkle') + 'Missions</h4>' + ch.map((c, i) => '<div class="rlrow"><input value="' + esc(c.name) + '" data-change="msC" data-arg="' + i + '|name" style="flex:1 1 160px"><select data-change="msC" data-arg="' + i + '|who">' + kids().map(u => '<option' + (c.who === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select><input type="number" min="1" max="50" value="' + c.points + '" data-change="msC" data-arg="' + i + '|points" style="width:64px" title="points">' + daysPick('msDay', i, c.days) + '<button type="button" class="sq" data-act="msCDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="msCAdd">' + ico('plus') + 'Mission</button><button class="btn sm" data-act="msTpl">' + ico('sparkle') + 'Idées de missions</button></div>' +
      '<h4 class="rlh">' + ico('heart') + 'Récompenses</h4>' + rw.map((r, i) => '<div class="rlrow"><input value="' + esc(r.name) + '" data-change="msR" data-arg="' + i + '|name" style="flex:1 1 200px"><input type="number" min="1" value="' + r.cost + '" data-change="msR" data-arg="' + i + '|cost" style="width:80px"><span class="muted">points</span><button type="button" class="sq" data-act="msRDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
      '<button class="btn sm" data-act="msRAdd">' + ico('plus') + 'Récompense</button>' +
      ((FM.cfg.spent || []).length ? '<h4 class="rlh">' + ico('history') + 'Échanges</h4><div class="list">' + FM.cfg.spent.slice(-8).reverse().map(x => '<div class="li" style="grid-template-columns:1fr auto"><span>' + esc(x.who + ' : ' + x.name) + '</span><small class="muted">' + new Date(x.at).toLocaleDateString('fr-FR') + ' · −' + x.cost + '</small></div>').join('') + '</div>' : '');
  }
  const msR = () => modal('msmodal', msBody());
  const msSave = async (k, l) => { if (await save({ [k]: l })) { msR(); load(); } };
  B.act('msCfg', async () => { if (!needAdmin()) return; await load(); msR(); });
  B.act('msC', el => { const [i, k] = el.dataset.arg.split('|'), l = clone('chores'); l[+i][k] = k === 'points' ? Math.max(1, +el.value || 1) : el.value; msSave('chores', l); });
  B.act('msDay', el => { const [i, d] = el.dataset.arg.split('|'), l = clone('chores'); l[+i].days = tog(l[+i].days, +d); msSave('chores', l); });
  B.act('msCDel', el => { const l = clone('chores'); l.splice(+el.dataset.arg, 1); msSave('chores', l); });
  B.act('msCAdd', () => msSave('chores', clone('chores').concat([{ id: 'm' + Date.now().toString(36), name: 'Ranger sa chambre', who: (kids()[0] || {}).name || '', points: 2, days: [], icon: 'sparkle' }])));
  B.act('msTpl', () => { const k = kids(), base = [['Faire son lit', 1, 'bed'], ['Ranger sa chambre', 2, 'sofa'], ['Mettre la table', 1, 'utensils'], ['Débarrasser', 1, 'utensils'], ['Nourrir le chat', 1, 'paw'], ['Devoirs faits', 2, 'school'], ['Sortir les poubelles', 2, 'trash'], ['Se brosser les dents', 1, 'dropFill']]; msSave('chores', clone('chores').concat(k.flatMap(u => base.slice(0, 4).map((b, j) => ({ id: 'm' + Date.now().toString(36) + u.id + j, name: b[0], who: u.name, points: b[1], days: [], icon: b[2] }))))); });
  B.act('msR', el => { const [i, k] = el.dataset.arg.split('|'), l = clone('rewards'); l[+i][k] = k === 'cost' ? Math.max(1, +el.value || 1) : el.value; msSave('rewards', l); });
  B.act('msRDel', el => { const l = clone('rewards'); l.splice(+el.dataset.arg, 1); msSave('rewards', l); });
  B.act('msRAdd', () => msSave('rewards', clone('rewards').concat([{ id: 'r' + Date.now().toString(36), name: '30 min d’écran en plus', cost: 10 }])));

  /* ======================= 4. mode baby-sitter ======================= */
  let sitterUser = null;
  function sitterCheck() {
    const s = FM.cfg && FM.cfg.sitter, on = !!(s && s.on && (!s.until || s.until > Date.now()));
    document.documentElement.classList.toggle('sitter', on);
    if (on && S.user !== 'guest') { sitterUser = S.user; S.user = 'guest'; B.save(); if (B.current !== 'babysitter') location.hash = 'babysitter'; else B.show(); }
    if (!on && S.user === 'guest' && sitterUser) { S.user = sitterUser; sitterUser = null; B.save(); B.show(); }
  }
  RENDER.bsInfo = () => {
    const s = (FM.cfg || {}).sitter || {}, g = B.V && B.V.guest;
    return '<div class="bsinfo"><h3>' + ico('heart') + 'Bienvenue' + (s.name ? ' ' + esc(s.name) : '') + ' !</h3>' + (s.until ? '<p class="muted">Mode baby-sitter jusqu’à ' + hm(s.until) + '</p>' : '') +
      (s.bedtime ? '<div class="bsbed">' + ico('moon') + '<b>Coucher : ' + esc(s.bedtime) + '</b></div>' : '') +
      ((s.contacts || []).length ? '<h4 class="rlh">' + ico('user') + 'Numéros utiles</h4><div class="bsct">' + s.contacts.map(c => '<a href="tel:' + esc(String(c.tel).replace(/\s/g, '')) + '"><b>' + esc(c.name) + '</b><span>' + esc(c.tel) + '</span></a>').join('') + '<a href="tel:15"><b>SAMU</b><span>15</span></a><a href="tel:112"><b>Urgences</b><span>112</span></a></div>' : '<div class="bsct"><a href="tel:15"><b>SAMU</b><span>15</span></a><a href="tel:18"><b>Pompiers</b><span>18</span></a><a href="tel:112"><b>Urgences</b><span>112</span></a></div>') +
      (s.notes ? '<h4 class="rlh">' + ico('edit') + 'Consignes</h4><p class="bsnotes">' + esc(s.notes).replace(/\n/g, '<br>') + '</p>' : '') +
      (g && g.ssid ? '<h4 class="rlh">' + ico('wifi') + 'Wi-Fi</h4><button class="btn" data-act="gwOpen">' + ico('wifi') + esc(g.ssid) + '</button>' : '<button class="btn sm" data-act="gwOpen">' + ico('wifi') + 'Wi-Fi invités</button>') +
      '<div class="row" style="margin-top:14px"><button class="btn" data-act="sitEnd">' + ico('lock') + 'Fin du mode baby-sitter (parents)</button></div></div>';
  };
  B.route('babysitter', { title: 'Baby-sitter', bg: 'assets/bg/generic.jpg', render: () => B.side('babysitter') + B.header({ id: 'babysitter', title: 'Baby-sitter', sub: 'Tout ce qu’il faut savoir', icon: 'heart', info: { t: 'infobox', keys: ['famille'], items: () => { const s = (FM.cfg || {}).sitter || {}; return [{ icon: 'moon', v: s.bedtime || '—', l: 'Coucher', cls: 'y' }, { icon: 'history', v: s.until ? hm(s.until) : '—', l: 'Jusqu’à' }]; } } }) + '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('heart', 'Infos de la maison') + T({ t: 'bsInfo', keys: ['famille'] }) + '</section>', after: async () => { await load(); if (B.V && !B.V.guest && srv()) { try { B.V.guest = await req('/api/extra/guest'); B.emit('famille'); } catch (e) { } } } });
  function sitBody() {
    const s = FM.cfg.sitter;
    return '<h2>' + ico('heart') + 'Mode baby-sitter</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Toutes les tablettes passent en profil invité (pas de réglages, d’alarme, de serrures ni de garage) et affichent une fiche avec les numéros, les consignes et le Wi-Fi. Fin automatique à l’heure choisie, ou avec le code d’un parent.</p>' +
      '<div class="grid2"><label class="field">Prénom du baby-sitter<input value="' + esc(s.name || '') + '" data-change="sitSet" data-arg="name"></label><label class="field">Heure du coucher des enfants<input value="' + esc(s.bedtime || '') + '" data-change="sitSet" data-arg="bedtime" placeholder="20 h 30"></label><label class="field">Durée<select data-sit-h>' + [[3, '3 h'], [4, '4 h'], [5, '5 h'], [6, '6 h'], [8, '8 h'], [12, '12 h']].map(o => '<option value="' + o[0] + '"' + (o[0] === 5 ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label></div>' +
      '<label class="field">Consignes (allergies, repas, rituels…)<textarea rows="3" data-change="sitSet" data-arg="notes">' + esc(s.notes || '') + '</textarea></label>' +
      '<h4 class="rlh">' + ico('user') + 'Numéros utiles</h4>' + (s.contacts || []).map((c, i) => '<div class="rlrow"><input value="' + esc(c.name) + '" data-change="sitCt" data-arg="' + i + '|name" placeholder="Maman"><input value="' + esc(c.tel) + '" data-change="sitCt" data-arg="' + i + '|tel" placeholder="06 …"><button type="button" class="sq" data-act="sitCtDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') + '<button class="btn sm" data-act="sitCtAdd">' + ico('plus') + 'Numéro</button>' +
      '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">' + (s.on ? '<button class="btn dan" data-act="sitEnd">' + ico('lock') + 'Arrêter</button>' : '<button class="btn pri" data-act="sitGo">' + ico('play') + 'Démarrer</button>') + '</div>';
  }
  const sitR = () => modal('sitmodal', sitBody());
  B.act('sitOpen', async () => { if (!needAdmin()) return; await load(); sitR(); });
  B.act('sitSet', el => save({ sitter: { [el.dataset.arg]: el.value } }));
  B.act('sitCt', el => { const [i, k] = el.dataset.arg.split('|'), l = JSON.parse(JSON.stringify(FM.cfg.sitter.contacts || [])); l[+i][k] = el.value; save({ sitter: { contacts: l } }); });
  B.act('sitCtAdd', async () => { const l = (FM.cfg.sitter.contacts || []).concat([{ name: '', tel: '' }]); await save({ sitter: { contacts: l } }); sitR(); });
  B.act('sitCtDel', async el => { const l = (FM.cfg.sitter.contacts || []).slice(); l.splice(+el.dataset.arg, 1); await save({ sitter: { contacts: l } }); sitR(); });
  B.act('sitGo', async () => { const h = +((document.querySelector('[data-sit-h]') || {}).value || 5); try { FM.cfg.sitter = await req('/api/famille/sitter', { on: true, hours: h }); B.closeModal(); sitterCheck(); B.toast('Mode baby-sitter jusqu’à ' + hm(FM.cfg.sitter.until), 'heart'); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('sitEnd', async () => {
    const admins = S.users.filter(u => u.admin && u.pin);
    if (admins.length) { const p = prompt('Code d’un parent'); if (p == null) return; if (!admins.some(u => String(u.pin) === p)) return B.toast('Code incorrect', 'lock'); }
    else if (!confirm('Terminer le mode baby-sitter ?')) return;
    try { FM.cfg.sitter = await req('/api/famille/sitter', { on: false }); B.closeModal(); sitterCheck(); B.toast('Mode baby-sitter terminé', 'check'); } catch (e) { B.toast(e.message, 'info'); }
  });

  const nl0 = B.navList;
  B.navList = NAV => { let out = (nl0 ? nl0(NAV) : NAV).slice(); const add = (id, label, icon, after) => { if (out.some(n => n[0] === id)) return; const i = out.findIndex(n => n[0] === after); out.splice(i < 0 ? out.length : i + 1, 0, [id, label, icon, icon, 'noside']); }; add('missions', 'Missions', 'heart', 'listes'); add('bilan', 'Bilan', 'chart', 'energie'); if (document.documentElement.classList.contains('sitter')) { add('babysitter', 'Baby-sitter', 'heart', 'accueil'); out = out.filter(n => ['accueil', 'babysitter', 'exterieur', 'rdc', 'etage1', 'etage2', 'musique', 'listes', 'interphone'].includes(n[0]) || /^niveau-/.test(n[0])); } return out; };
  window.addEventListener('hashchange', () => { if (document.documentElement.classList.contains('sitter') && /^(parametres|reglages|installation|connexions|marques|securite|admin|sante|routines|energie|chauffage|reseau|journal|bilan|missions)$/.test(location.hash.slice(1))) setTimeout(() => B.go('babysitter'), 0); });
  B.on && B.on('nas', ev => { if (ev.type === 'sitter') load(); });

  /* ======================= 5. cadre photo (écran de veille) ======================= */
  const DK = 'betaos.device', dcfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } }, dset = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  let PHOTOS = [];
  async function loadPhotos() { const p = dcfg().photoframe; if (!p || !srv() || !FM.cfg) return; try { PHOTOS = (await req('/api/photos?n=40&mode=' + (p === 'memories' ? 'memories' : 'random'))).map(x => media('/api/photos/file?id=' + encodeURIComponent(x.id))); } catch (e) { PHOTOS = []; } }
  setTimeout(loadPhotos, 7000); setInterval(loadPhotos, 30 * 6e4);
  B.saverPhotos = () => PHOTOS;
  function phBody() {
    const c = FM.cfg.photos, st = (FM.state || {}).photos || {};
    return '<h2>' + ico('photo') + 'Cadre photo</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">L’écran de veille des tablettes fait défiler vos photos de famille. Choisissez « Souvenirs » pour les photos prises le même jour les années passées.</p>' +
      '<section class="svsec"><h4 class="rlh">' + ico('nas') + 'Dossier de photos du NAS</h4><label class="field">Dossier (dans le conteneur, voir docker-compose : /photos)<input value="' + esc(c.dir || '') + '" data-change="phSet" data-arg="dir" placeholder="/photos"></label><small class="muted">' + (st.count ? st.count + ' photo(s) trouvée(s) dans ' + esc(st.dir) : st.dir ? 'Aucune photo trouvée dans ' + esc(st.dir) : 'Pas encore de dossier') + '</small></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('photo') + 'Ou Immich</h4><div class="grid2"><label class="field">Adresse d’Immich<input value="' + esc(c.immich || '') + '" data-change="phSet" data-arg="immich" placeholder="http://192.168.1.10:2283"></label><label class="field">Clé d’API (Immich › Compte › Clés d’API)<input type="password" placeholder="' + (c.key ? 'déjà enregistrée' : '') + '" data-change="phSet" data-arg="key"></label></div></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('monitor') + 'Sur cette tablette</h4><select data-change="phMine"><option value="">photos des pièces (par défaut)</option><option value="random"' + (dcfg().photoframe === 'random' ? ' selected' : '') + '>photos de famille au hasard</option><option value="memories"' + (dcfg().photoframe === 'memories' ? ' selected' : '') + '>souvenirs (ce jour-là, les années passées)</option></select></section>';
  }
  B.act('phOpen', async () => { if (!need()) return; await load(); modal('phmodal', phBody()); });
  B.act('phSet', async el => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); await save({ photos: { [el.dataset.arg]: el.value.trim() } }); setTimeout(async () => { await load(); modal('phmodal', phBody()); }, 1500); });
  B.act('phMine', async el => { const c = dcfg(); c.photoframe = el.value; if (c.photoframe) c.tablet = Object.assign({}, c.tablet, { photos: true }); dset(c); await loadPhotos(); B.toast(el.value ? 'Cadre photo activé sur cette tablette (' + PHOTOS.length + ' photos)' : 'Photos des pièces', 'photo'); });

  /* ======================= 6-7. mode vacances et résumé d'absence ======================= */
  function vacBody() {
    const v = FM.cfg.vac, d = new Date(Date.now() + 7 * 864e5);
    return '<h2>' + ico('walk') + 'Mode vacances</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Un seul bouton : mode absent, simulation de présence, chauffage hors-gel, alarme activée (si configurée), arrosage qui continue selon la météo. Avant votre retour, le chauffage se relance pour que la maison soit chaude ; au retour, Bêta vous raconte ce qui s’est passé.</p>' +
      (v.on ? '<div class="upst g">' + ico('walk') + '<div><b>En vacances depuis le ' + new Date(v.since).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</b><small>' + (v.back ? 'Retour prévu le ' + new Date(v.back).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + (v.restored ? ' · chauffage relancé' : ' · chauffage relancé ' + v.preheat + ' h avant') : 'Retour non programmé') + '</small></div></div><button class="btn pri" data-act="vacGo" data-arg="0">' + ico('homeFill') + 'Je suis rentré</button>'
        : '<div class="grid2"><label class="field">Retour prévu<input type="datetime-local" data-vac-back value="' + F.ymd(d) + 'T18:00"></label><label class="field">Relancer le chauffage avant (h)<input type="number" min="1" max="72" value="' + (v.preheat || 12) + '" data-vac-pre></label></div><button class="btn pri" data-act="vacGo" data-arg="1">' + ico('walk') + 'Partir en vacances</button>');
  }
  B.act('vacOpen', async () => { if (!needAdmin()) return; await load(); modal('vacmodal', vacBody()); });
  B.act('vacGo', async el => { const on = el.dataset.arg === '1'; try { FM.cfg.vac = await req('/api/famille/vacances', on ? { on: true, back: (document.querySelector('[data-vac-back]') || {}).value, preheat: +((document.querySelector('[data-vac-pre]') || {}).value || 12) } : { on: false }); B.toast(on ? 'Bonnes vacances ! La maison s’occupe de tout.' : 'Bon retour !', on ? 'walk' : 'homeFill'); B.closeModal(); B.emit('brain'); } catch (e) { B.toast(e.message, 'info'); } });
  function absBody(s) {
    if (!s) return '<h2>' + ico('history') + 'Pendant votre absence</h2><p class="muted">Pas encore d’absence enregistrée.</p>';
    const k = [['bellFill', s.rings, 'coup(s) de sonnette'], ['download', s.parcels, 'colis'], ['walk', s.people, 'passage(s) détecté(s)'], ['door', s.opens, 'ouverture(s)'], ['alert', s.alarms, 'alarme(s)'], ['wifi', s.outages, 'coupure(s) internet']];
    return '<h2>' + ico('history') + 'Pendant votre absence</h2><p class="muted" style="margin:0 0 10px">Du ' + new Date(s.start).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' au ' + new Date(s.end).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</p>' +
      '<div class="abskpi">' + k.map(x => '<div class="' + (x[1] ? 'on' : '') + '">' + ico(x[0]) + '<b>' + (x[1] || 0) + '</b><small>' + x[2] + '</small></div>').join('') + (s.kwh != null ? '<div class="on">' + ico('boltPlain') + '<b>' + eur(s.eur || 0) + '</b><small>' + (s.kwh || 0).toFixed(1).replace('.', ',') + ' kWh</small></div>' : '') + '</div>' +
      ((s.items || []).length ? '<div class="list" style="margin-top:10px">' + s.items.slice().reverse().map(x => '<div class="li" style="grid-template-columns:1fr auto"><span>' + esc(x.txt) + '</span><small class="muted">' + new Date(x.t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '</small></div>').join('') + '</div>' : '<p class="muted">Rien à signaler 👍</p>') + '<button class="btn sm" data-act="visOpen">' + ico('camera') + 'Visiteurs de la sonnette</button>';
  }
  B.act('absOpen', async () => { if (!need()) return; try { const r = await req('/api/famille/absence'); B.modal(absBody(r.last), 'wide absmodal'); } catch (e) { B.toast(e.message, 'info'); } });
  B.on && B.on('nas', ev => { if (ev.type === 'absence' && ev.summary && !document.hidden) setTimeout(() => B.modal(absBody(ev.summary), 'wide absmodal'), 1500); });
  const ac0 = RENDER.alarmCard;
  if (ac0) RENDER.alarmCard = () => { const h = ac0(); return srv() && FM.cfg ? h.replace(/(<div class="row" style="gap:8px;flex-wrap:wrap">)/, '$1<button class="btn sm' + (FM.cfg.vac.on ? ' pri' : '') + '" data-act="vacOpen">' + ico('walk') + (FM.cfg.vac.on ? 'En vacances' : 'Mode vacances') + '</button><button class="btn sm" data-act="absOpen">' + ico('history') + 'Pendant l’absence</button><button class="btn sm" data-act="visOpen">' + ico('camera') + 'Visiteurs</button>') : h; };

  /* ======================= 8. bilan du mois ======================= */
  let BM = null, BMk = '';
  async function loadBilan() { if (!srv() || !FM.cfg) return; try { BM = await req('/api/famille/bilan' + (BMk ? '?month=' + BMk : '')); } catch (e) { BM = null; } B.emit('bilan'); }
  RENDER.bmBody = () => {
    if (!srv()) return '<p class="warn">Le bilan est calculé par le serveur Bêta du NAS.</p>'; if (!BM) return '<p class="muted">Lecture…</p>';
    const mName = k => new Date(k + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), e = BM.energy, p = BM.energyPrev, diff = e && p && p.eur ? Math.round((e.eur / p.eur - 1) * 100) : null;
    const card = (icon, v, l, sub, cls) => '<div class="bmc ' + (cls || '') + '">' + ico(icon) + '<b>' + v + '</b><span>' + l + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    return '<div class="bmhead"><button class="sq" data-act="bmGo" data-arg="-1">' + ico('chevL') + '</button><b>' + mName(BM.month) + '</b><button class="sq" data-act="bmGo" data-arg="1">' + ico('chevR') + '</button></div><div class="bmgrid">' +
      card('boltPlain', e && e.kwh ? eur(e.eur) : '—', 'Électricité suivie', e && e.kwh ? Math.round(e.kwh) + ' kWh' + (diff != null ? ' · ' + (diff > 0 ? '+' : '') + diff + ' % vs ' + mName(BM.prev).split(' ')[0] : '') : 'prises et compteurs', diff > 10 ? 'p' : diff < -5 ? 'g' : '') +
      card('boltPlain', (BM.tempo.rouge || 0) + ' / ' + (BM.tempo.blanc || 0), 'Jours rouges / blancs', (BM.tempo.bleu || 0) + ' jours bleus', BM.tempo.rouge ? 'p' : '') +
      card('wifi', BM.outages, 'Coupures internet', BM.outageMin ? BM.outageMin + ' min au total' : 'aucune', BM.outages ? 'y' : 'g') +
      card('bellFill', BM.rings, 'Coups de sonnette', BM.ringsPrev ? BM.ringsPrev + ' le mois d’avant' : '') +
      card('cctv', BM.detect, 'Détections caméras', '') + card('alert', BM.alarms, 'Alarmes', '', BM.alarms ? 'p' : 'g') +
      card('download', BM.parcels, 'Colis livrés', '') + card('heart', BM.chores, 'Missions des enfants', '') + card('sparkle', BM.rules, 'Règles exécutées', '') + '</div>';
  };
  B.route('bilan', { title: 'Bilan', bg: 'assets/bg/generic.jpg', render: () => B.side('bilan') + B.header({ id: 'bilan', title: 'Bilan du mois', sub: 'La maison en chiffres', icon: 'chart', info: { t: 'infobox', keys: ['bilan'], items: () => [{ icon: 'boltPlain', v: BM && BM.energy && BM.energy.kwh ? eur(BM.energy.eur) : '—', l: 'Électricité', cls: 'y' }, { icon: 'bellFill', v: BM ? BM.rings : '—', l: 'Sonnette' }, { icon: 'download', v: BM ? BM.parcels : '—', l: 'Colis' }] } }) + '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('chart', 'Bilan') + T({ t: 'bmBody', keys: ['bilan'] }) + '</section>', after: async () => { await load(); loadBilan(); } });
  B.act('bmGo', el => { const cur = BM ? BM.month : F.ymd(new Date()).slice(0, 7), [y, m] = cur.split('-').map(Number), d = new Date(y, m - 1 + +el.dataset.arg, 15); BMk = F.ymd(d).slice(0, 7); loadBilan(); });

  /* ======================= 9. sonnette : photo, réponses, visiteurs ======================= */
  let ringOv = null;
  B.on && B.on('nas', ev => {
    if (ev.type !== 'ring' || !mod('sonnette')) return;
    if (ringOv) ringOv.remove();
    ringOv = document.createElement('div'); ringOv.className = 'ringov';
    ringOv.innerHTML = '<div class="ringbox"><div class="ringh">' + ico('bellFill') + '<b>On sonne à la porte</b><small>' + hm(Date.now()) + '</small><button class="sq" data-ring="x">' + ico('x') + '</button></div>' + (ev.visit ? '<img src="' + esc(media('/api/famille/visit?id=' + ev.visit)) + '" alt="Visiteur">' : '') +
      '<div class="ringr">' + (ev.replies || []).map(r => '<button class="btn" data-ring="say" data-t="' + esc(r) + '">' + ico('mic') + esc(r) + '</button>').join('') + '<button class="btn pri" data-ring="cam">' + ico('camera') + 'Voir la caméra</button></div></div>';
    ringOv.addEventListener('click', async e => { const b = e.target.closest('[data-ring]'); if (!b) return; const k = b.dataset.ring; if (k === 'x') { ringOv.remove(); ringOv = null; } else if (k === 'cam') { ringOv.remove(); ringOv = null; location.hash = 'exterieur'; } else { try { await req('/api/famille/door/reply', { text: b.dataset.t }); B.toast('Réponse lue à la porte', 'mic'); } catch (er) { B.toast(er.message, 'info'); } } });
    document.body.appendChild(ringOv); if (B.tabletWake) B.tabletWake(); setTimeout(() => { if (ringOv) { ringOv.remove(); ringOv = null; } }, 90000);
  });
  B.act('visOpen', async () => { if (!need()) return; let l = []; try { l = await req('/api/famille/visits'); } catch (e) { } B.modal('<h2>' + ico('camera') + 'Visiteurs</h2><div class="visgrid">' + (l.map(v => '<figure><img loading="lazy" src="' + esc(media('/api/famille/visit?id=' + v.id)) + '" alt=""><figcaption>' + new Date(v.t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</figcaption></figure>').join('') || '<p class="muted">Aucune visite enregistrée (il faut une caméra pour la sonnette : Paramètres › Notifs).</p>') + '</div>' + (isAdmin() ? '<button class="btn sm" data-act="doorCfg">' + ico('gear') + 'Réponses et tablette de l’entrée</button>' : ''), 'wide vismodal'); });
  async function doorBody() { const c = FM.cfg.door, tabs = B.V ? (B.V.tablets || await req('/api/extra/tablets').catch(() => [])) : []; return '<h2>' + ico('bellFill') + 'Sonnette</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Quand on sonne, toutes les tablettes montrent la photo du visiteur avec des réponses rapides. La réponse est lue à voix haute par la tablette placée près de l’entrée (Fully Kiosk), ou par une tablette tournée vers l’extérieur.</p><label class="field">Tablette de l’entrée<select data-change="doorTab"><option value="">—</option>' + tabs.map(t => '<option value="' + t.ip + '"' + (c.tablet === t.ip ? ' selected' : '') + '>' + esc(t.name + (t.room ? ' · ' + t.room : '')) + '</option>').join('') + '</select></label><h4 class="rlh">Réponses rapides</h4>' + c.replies.map((r, i) => '<div class="rlrow"><input value="' + esc(r) + '" data-change="doorR" data-arg="' + i + '" style="flex:1"><button type="button" class="sq" data-act="doorRDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') + '<button class="btn sm" data-act="doorRAdd">' + ico('plus') + 'Réponse</button>'; }
  const doorR = async () => modal('doormodal', await doorBody());
  B.act('doorCfg', async () => { if (!needAdmin()) return; B.closeModal(); await load(); doorR(); });
  B.act('doorTab', async el => { await save({ door: { tablet: el.value } }); });
  B.act('doorR', async el => { const l = FM.cfg.door.replies.slice(); l[+el.dataset.arg] = el.value; await save({ door: { replies: l } }); });
  B.act('doorRDel', async el => { const l = FM.cfg.door.replies.slice(); l.splice(+el.dataset.arg, 1); await save({ door: { replies: l } }); doorR(); });
  B.act('doorRAdd', async () => { await save({ door: { replies: FM.cfg.door.replies.concat(['Un instant s’il vous plaît']) } }); doorR(); });

  /* ======================= 12. recharge de la voiture ======================= */
  async function evBody() {
    const c = FM.cfg.ev, devs = (B.nasDevs ? B.nasDevs() : []).filter(d => ['plug', 'switch'].includes(d.k) || /borne|charge|wallbox|easee/i.test(d.name)); let pl = null; try { pl = await req('/api/famille/ev'); } catch (e) { }
    const sl = (pl && pl.slots) || [], mx = Math.max(0.01, ...sl.map(s => s.p));
    return '<h2>' + ico('charger') + 'Recharge de la voiture</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Dites combien d’heures de charge il faut et pour quand : Bêta choisit les heures les moins chères (heures creuses, jours bleus Tempo) et évite les heures pleines des jours rouges.</p>' +
      sw('evOn', c.on, '<b>Recharge intelligente</b>') + '<div class="grid2"><label class="field">Borne ou prise<select data-change="evSet" data-arg="dev"><option value="">—</option>' + devs.map(d => '<option value="' + d.id + '"' + (c.dev === d.id ? ' selected' : '') + '>' + esc((d.room ? d.room + ' · ' : '') + d.name) + '</option>').join('') + '</select></label><label class="field">Heures de charge nécessaires<input type="number" min="1" max="14" value="' + c.hours + '" data-change="evSet" data-arg="hours"></label><label class="field">Prête à<input type="time" value="' + esc(c.ready) + '" data-change="evSet" data-arg="ready"></label></div>' + ck('evRed', 'r', c.avoidRed, 'Jamais en heures pleines un jour rouge') +
      (sl.length ? '<h4 class="rlh">' + ico('chart') + 'Programme jusqu’à ' + hm(pl.ready) + '</h4><div class="evbars">' + sl.map(s => '<div class="' + (s.on ? 'on' : '') + '"><i style="height:' + Math.max(8, s.p / mx * 100) + '%"></i><small>' + new Date(s.t).getHours() + 'h</small></div>').join('') + '</div><small class="muted">En vert : heures de charge · coût estimé ' + eur(pl.cost * (7.4)) + ' pour une borne de 7,4 kW</small>' : '');
  }
  const evR = async () => modal('evmodal', await evBody());
  B.act('evOpen', async () => { if (!needAdmin()) return; await load(); evR(); });
  B.act('evOn', async () => { await save({ ev: { on: !FM.cfg.ev.on } }); evR(); });
  B.act('evSet', async el => { await save({ ev: { [el.dataset.arg]: el.dataset.arg === 'hours' ? +el.value : el.value } }); evR(); });
  B.act('evRed', async el => { await save({ ev: { avoidRed: el.checked } }); evR(); });

  /* ======================= 11. grand texte (par écran) ======================= */
  const applyBig = () => document.documentElement.classList.toggle('bigtext', !!dcfg().big);
  applyBig();
  const se0 = B.screenExtra;
  B.screenExtra = c => (se0 ? se0(c) : '') + '<label class="row tbsw"><button type="button" class="sw sm' + (dcfg().big ? ' on' : '') + '" data-act="bigTog"></button><span><b>Grand texte</b> : textes et boutons agrandis (grands-parents, tablette vue de loin)</span></label>' + (srv() ? '<button type="button" class="btn sm" data-act="phOpen">' + ico('photo') + 'Cadre photo de cette tablette</button>' : '');
  B.act('bigTog', () => { const c = dcfg(); c.big = !c.big; dset(c); applyBig(); if (B.screenCfg && document.querySelector('.scmodal')) B.screenCfg(); B.show(); });

  /* ======================= 10. nouvel écran : association par QR code ======================= */
  // un écran admin affiche un QR : l'ouvrir sur la tablette relie Bêta home au NAS sans rien taper
  const hp = (location.hash.match(/^#pair=(\d{6})/) || [])[1];
  if (hp && B.pairWith) setTimeout(async () => { const name = prompt('Nom de cet écran', 'Tablette') || 'Écran'; S.conn.server.url = location.origin; B.save(); try { await B.pairWith(hp, name); const c = dcfg(); c.name = name; dset(c); location.hash = 'accueil'; } catch (e) { B.toast(e.message, 'lock'); } }, 800);

  /* ---------- outils ---------- */
  const TOOLS3 = [['icOpen', 'calendar', 'Calendriers iPhone', 'Agendas iCloud sur les tablettes', 'calendrier'], ['pkOpen', 'download', 'Colis', 'Suivi depuis vos mails', 'colis'], ['vacOpen', 'walk', 'Mode vacances', 'Tout en un bouton, retour programmé', 'securite'], ['sitOpen', 'heart', 'Mode baby-sitter', 'Profil invité et fiche d’infos', 'missions'], ['phOpen', 'photo', 'Cadre photo', 'Photos du NAS ou d’Immich', 'photos'], ['evOpen', 'charger', 'Recharge de la voiture', 'Aux heures les moins chères', 'energie'], ['visOpen', 'camera', 'Visiteurs de la sonnette', 'Photos et réponses rapides', 'sonnette']];
  const to0 = B.ACT && B.ACT.toolsOpen;
  if (to0) B.act('toolsOpen', el => { to0(el); const g = document.querySelector('.toolsmodal .tools'); if (g) g.insertAdjacentHTML('beforeend', TOOLS3.filter(t => mod(t[4])).map(t => '<button class="tool" data-act="' + t[0] + '">' + ico(t[1]) + '<b>' + t[2] + '</b><small>' + t[3] + '</small></button>').join('')); });
})();
