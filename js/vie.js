/* Bêta home 7.14 — la vie de la maison (côté écran) :
   - Réseau : ligne internet (coupures, disponibilité), nouveaux appareils, Wi-Fi invités avec QR code, contrôle parental
   - Réveil en douceur, modes (cinéma, repas, invités : ne pas déranger, Wi-Fi invités, musique), conseiller Tempo
   - page Matin (météo, agenda, trajets, bus/tram CTS, TER), page Interphone, rappels d'entretien
   - mode secours (NAS ou internet coupés) et page Administration */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const req = (p, b, m) => B.Server.req(p, b, m);
  const mod = id => !B.modOn || B.modOn(id);
  const V = B.V = { cfg: null, state: null, guest: null, morning: null, tablets: null, rem: null, hist: null, admin: null };
  async function load() { if (!srv()) return null; try { const r = await req('/api/extra'); V.state = r.state; delete r.state; V.cfg = r; } catch (e) { V.cfg = null; } B.emit('vie'); return V.cfg; }
  const save = async patch => { try { const r = await req('/api/extra', patch, 'PUT'); V.cfg = Object.assign(V.cfg || {}, r); B.emit('vie'); return true; } catch (e) { B.toast(e.message, 'info'); return false; } };
  setTimeout(load, 3500);
  const need = () => { if (!srv()) { B.toast('Serveur Bêta du NAS nécessaire (Connexions)', 'server'); return false; } if (!V.cfg) { B.toast('Mettez à jour le serveur Bêta (module « vie de la maison » absent)', 'server'); return false; } return true; };
  const needAdmin = () => { if (!isAdmin()) { B.toast('Réservé aux administrateurs', 'lock'); return false; } return need(); };
  const modal = (cls, html) => { const m = document.querySelector('.' + cls); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + html; m.scrollTop = sc; } else B.modal(html, 'wide ' + cls); };
  const sw = (act, on, label, arg) => '<label class="row tbsw"><button type="button" class="sw sm' + (on ? ' on' : '') + '" data-act="' + act + '"' + (arg ? ' data-arg="' + esc(arg) + '"' : '') + '></button><span>' + label + '</span></label>';
  const ck = (act, arg, on, label) => '<label class="rlck"><input type="checkbox" data-change="' + act + '" data-arg="' + esc(arg) + '"' + (on ? ' checked' : '') + '>' + label + '</label>';
  const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const daysPick = (act, arg, days) => '<span class="rldays">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="pinc' + ((days || []).includes(d) ? ' on' : '') + '" data-act="' + act + '" data-arg="' + arg + '|' + d + '">' + DAYS[d] + '</button>').join('') + '</span>';
  const tog = (l, v) => { l = (l || []).slice(); const i = l.indexOf(v); i >= 0 ? l.splice(i, 1) : l.push(v); return l; };
  const devs = f => (B.nasDevs ? B.nasDevs() : []).filter(f || (() => true));
  const dlabel = d => (d.room ? d.room + ' · ' : '') + d.name;
  const hm = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const radios = () => (B.Music && B.Music.sources ? B.Music.sources().filter(x => x.group === 'Radio' && /^https?:/.test(x.ref || '')) : []);
  async function tablets() { if (!V.tablets) { try { V.tablets = await req('/api/extra/tablets'); } catch (e) { V.tablets = []; } } return V.tablets; }

  /* ---------- QR code (bibliothèque qrcode-generator, MIT) ---------- */
  function qr(text, px) {
    if (!window.qrcode) return '<p class="warn">QR indisponible</p>';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag(px || 6, 2);
  }
  const wifiQ = (ssid, pass) => 'WIFI:T:' + (pass ? 'WPA' : 'nopass') + ';S:' + String(ssid).replace(/([\\;,:"])/g, '\\$1') + ';P:' + String(pass || '').replace(/([\\;,:"])/g, '\\$1') + ';;';

  /* ======================= 1. Wi-Fi invités ======================= */
  let GW = { tab: 'guest' };
  function gwBody() {
    const g = V.guest || {}, c = (V.cfg || {}).guest || {}, net = GW.tab === 'guest' ? { ssid: g.ssid, pass: g.pass } : { ssid: (c.main || {}).ssid, pass: GW.mainPass || '' };
    return '<h2>' + ico('wifi') + 'Wi-Fi invités</h2><div class="tabs sm" style="margin-bottom:10px"><button class="' + (GW.tab === 'guest' ? 'on' : '') + '" data-act="gwTab" data-arg="guest">Réseau invités</button><button class="' + (GW.tab === 'main' ? 'on' : '') + '" data-act="gwTab" data-arg="main">Réseau de la maison</button></div>' +
      '<div class="gwgrid"><div class="gwqr">' + (net.ssid ? qr(wifiQ(net.ssid, net.pass), 7) + '<b>' + esc(net.ssid) + '</b>' + (net.pass ? '<small>' + esc(net.pass) + '</small>' : '') + '<button class="btn sm" data-act="gwShow">' + ico('expand') + 'Afficher en grand</button>' : '<p class="muted">Indiquez le nom du réseau' + (GW.tab === 'guest' && g.can ? ' (ou activez le Wi-Fi invités de la Bbox)' : '') + '.</p>') + '</div><div>' +
      (GW.tab === 'guest' ? (g.can ? '<div class="upst ' + (g.on ? 'g' : '') + '">' + ico('wifi') + '<div><b>Wi-Fi invités ' + (g.on ? 'allumé' : g.on === false ? 'coupé' : '?') + '</b><small>' + (g.offAt ? 'coupure automatique à ' + hm(g.offAt) : 'Bbox') + (g.err ? ' · ' + esc(g.err) : '') + '</small></div></div><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" data-act="gwOn" data-arg="1">' + ico('power') + 'Allumer</button><button class="btn" data-act="gwOn" data-arg="0">Couper</button></div><label class="field">Coupure automatique après<select data-change="gwHours">' + [[0, 'jamais'], [2, '2 h'], [4, '4 h'], [8, '8 h'], [24, '1 jour'], [72, '3 jours']].map(o => '<option value="' + o[0] + '"' + (+c.hours === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>'
        : '<p class="muted" style="font-size:12.5px">Avec le mot de passe admin de la Bbox (Marques › Bbox), Bêta allume et coupe le Wi-Fi invités lui-même. Sinon, saisissez son nom et son mot de passe pour le QR code.</p>') +
        '<label class="field">Nom du réseau invités' + (g.can ? ' (vide = celui de la Bbox)' : '') + '<input value="' + esc(c.ssid || '') + '" data-change="gwSet" data-arg="ssid"></label><label class="field">Mot de passe<input type="password" placeholder="' + (c.pass ? 'déjà enregistré' : '') + '" data-change="gwSet" data-arg="pass"></label>'
        : '<label class="field">Nom du réseau de la maison<input value="' + esc((c.main || {}).ssid || '') + '" data-change="gwMain" data-arg="ssid" placeholder="Deco-Maison"></label><label class="field">Mot de passe (gardé sur le NAS)<input type="password" placeholder="' + ((c.main || {}).pass ? 'déjà enregistré : retapez-le pour le QR' : '') + '" data-input="gwMainPass"></label><p class="muted" style="font-size:12px">Pour le QR du réseau principal, le mot de passe n’est jamais renvoyé par le NAS : retapez-le ici.</p>') + '</div></div>';
  }
  const gwR = () => modal('gwmodal', gwBody());
  B.act('gwOpen', async () => { if (!need()) return; try { V.guest = await req('/api/extra/guest'); } catch (e) { V.guest = {}; } gwR(); });
  B.act('gwTab', el => { GW.tab = el.dataset.arg; gwR(); });
  B.act('gwOn', async el => { try { V.guest = await req('/api/extra/guest', { on: el.dataset.arg === '1' }); gwR(); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('gwHours', el => save({ guest: { hours: +el.value } }).then(gwR));
  B.act('gwSet', async el => { await save({ guest: { [el.dataset.arg]: el.value } }); try { V.guest = await req('/api/extra/guest'); } catch (e) { } gwR(); });
  B.act('gwMain', async el => { await save({ guest: { main: { ssid: el.value, pass: '••••' } } }); gwR(); });
  B.act('gwMainPass', el => { GW.mainPass = el.value; clearTimeout(GW.t); GW.t = setTimeout(() => { save({ guest: { main: { ssid: ((V.cfg.guest || {}).main || {}).ssid || '', pass: GW.mainPass } } }); gwR(); }, 600); });
  B.act('gwShow', () => { const g = V.guest || {}, c = (V.cfg || {}).guest || {}, n = GW.tab === 'guest' ? { ssid: g.ssid, pass: g.pass } : { ssid: (c.main || {}).ssid, pass: GW.mainPass }; B.closeModal(); const o = document.createElement('div'); o.className = 'gwfull'; o.innerHTML = '<div>' + qr(wifiQ(n.ssid, n.pass), 10) + '<b>' + esc(n.ssid) + '</b>' + (n.pass ? '<span>' + esc(n.pass) + '</span>' : '') + '<small>Scannez avec l’appareil photo pour vous connecter · touchez pour fermer</small></div>'; o.addEventListener('click', () => o.remove()); document.body.appendChild(o); });

  /* ======================= 2. contrôle parental ======================= */
  let PC = null;
  async function clients() { const out = []; for (const id of ['bbox', 'deco', 'freebox']) { try { ((await req('/api/hub/' + id + '/info')).clients || []).forEach(c => out.push(Object.assign({ src: id }, c))); } catch (e) { } } return out; }
  function pcBody() {
    const kids = V.cfg.kids || [], st = (V.state || {}).kids || [], k = kids.find(x => x.id === PC) || null, bb = (V.state || {}).bbox;
    return '<h2>' + ico('lock') + 'Contrôle parental (Internet)</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">Coupe Internet sur les appareils d’un enfant aux heures choisies, ou en pause d’un bouton. Il passe par la <b>Bbox</b> (mot de passe admin requis). Le Deco ne permet de bloquer un appareil que depuis son app : si vos Deco sont en mode routeur, la Bbox ne voit que les Deco — passez-les en mode point d’accès pour que ça marche.</p>' +
      (bb ? '' : '<p class="warn">Bbox non reliée avec son mot de passe admin (Marques › Bbox).</p>') +
      '<div class="list">' + kids.map(x => { const s = st.find(y => y.id === x.id) || {}; return '<div class="li pcli"><span class="ic">' + ico(s.blocked ? 'lock' : 'unlock') + '</span><div><b>' + esc(x.name) + '</b><small>' + (x.macs || []).length + ' appareil(s) · ' + (s.blocked ? 'Internet coupé' + (x.pause > Date.now() ? ' (pause jusqu’à ' + hm(x.pause) + ')' : '') : 'Internet autorisé') + '</small></div><span class="row" style="gap:6px;flex-wrap:wrap">' + (x.pause > Date.now() ? '<button class="btn sm" data-act="pcPause" data-arg="' + x.id + '|0">Reprendre</button>' : '<button class="btn sm" data-act="pcPause" data-arg="' + x.id + '|60">' + ico('pause') + '1 h</button><button class="btn sm" data-act="pcPause" data-arg="' + x.id + '|720">Jusqu’à demain</button>') + '<button class="sq" data-act="pcEdit" data-arg="' + x.id + '">' + ico('edit') + '</button></span></div>'; }).join('') + '</div>' +
      '<button class="btn" data-act="pcEdit">' + ico('plus') + 'Profil (ex. Léo)</button>' +
      (k ? '<div class="tbbox" style="margin-top:12px"><label class="field">Nom<input value="' + esc(k.name) + '" data-change="pcSet" data-arg="name"></label><b>Appareils</b><div class="alpick">' + (PC_CL || []).filter(c => c.mac).map(c => ck('pcMac', c.mac, (k.macs || []).includes(c.mac), esc(c.name) + ' <small class="muted">' + esc(c.ip || '') + '</small>')).join('') + '</div><b>Internet coupé</b>' +
        (k.sched || []).map((p, i) => '<div class="rlrow">' + daysPick('pcDay', i, p.days) + '<input type="time" value="' + esc(p.from) + '" data-change="pcP" data-arg="' + i + '|from"><span class="muted">à</span><input type="time" value="' + esc(p.to) + '" data-change="pcP" data-arg="' + i + '|to"><button type="button" class="sq" data-act="pcPDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="pcPAdd">' + ico('plus') + 'Plage</button><button type="button" class="btn sm" data-act="pcTpl">' + ico('moon') + 'La nuit en semaine (21 h – 7 h)</button><button type="button" class="btn sm dan" data-act="pcDel">' + ico('trash') + 'Supprimer</button></div></div>' : '');
  }
  let PC_CL = null;
  const pcSave = async list => { if (await save({ kids: list })) { await load(); modal('pcmodal', pcBody()); } };
  const pcK = () => JSON.parse(JSON.stringify(V.cfg.kids || []));
  B.act('pcOpen', async () => { if (!needAdmin()) return; await load(); PC_CL = await clients(); modal('pcmodal', pcBody()); });
  B.act('pcEdit', el => { if (el.dataset && el.dataset.arg) { PC = el.dataset.arg; return modal('pcmodal', pcBody()); } const k = { id: 'k' + Date.now().toString(36), name: 'Enfant', macs: [], sched: [], on: true }; PC = k.id; pcSave(pcK().concat([k])); });
  const pcUpd = f => { const l = pcK(), k = l.find(x => x.id === PC); f(k); pcSave(l); };
  B.act('pcSet', el => pcUpd(k => { k[el.dataset.arg] = el.value; }));
  B.act('pcMac', el => pcUpd(k => { k.macs = tog(k.macs, el.dataset.arg); }));
  B.act('pcDay', el => { const [i, d] = el.dataset.arg.split('|'); pcUpd(k => { k.sched[+i].days = tog(k.sched[+i].days, +d); }); });
  B.act('pcP', el => { const [i, f] = el.dataset.arg.split('|'); pcUpd(k => { k.sched[+i][f] = el.value; }); });
  B.act('pcPAdd', () => pcUpd(k => { k.sched.push({ days: [1, 2, 3, 4, 5], from: '21:00', to: '07:00' }); }));
  B.act('pcPDel', el => pcUpd(k => { k.sched.splice(+el.dataset.arg, 1); }));
  B.act('pcTpl', () => pcUpd(k => { k.sched = [{ days: [0, 1, 2, 3, 4], from: '21:00', to: '07:00' }, { days: [5, 6], from: '22:30', to: '08:00' }]; }));
  B.act('pcDel', () => { if (!confirm('Supprimer ce profil ? Internet sera rendu à ses appareils.')) return; const l = pcK().filter(x => x.id !== PC); PC = null; pcSave(l); });
  B.act('pcPause', async el => { const [id, min] = el.dataset.arg.split('|'); try { await req('/api/extra/kid', { id, pause: +min > 0, minutes: +min }); await load(); modal('pcmodal', pcBody()); B.toast(+min ? 'Internet en pause' : 'Internet rendu', 'lock'); } catch (e) { B.toast(e.message, 'info'); } });

  /* ======================= 3. ligne internet et nouveaux appareils (page Réseau) ======================= */
  async function loadHist() { if (!srv() || !V.cfg) return; try { V.hist = await req('/api/extra/net/history?days=7'); } catch (e) { } B.emit('reseau'); }
  const nb0 = RENDER.netBoxes;
  if (nb0) RENDER.netBoxes = () => {
    const h = nb0(); if (!V.cfg) return h;
    const st = (V.state || {}).net || {}, hi = V.hist || {}, pts = (hi.points || []).slice(-240);
    const spark = pts.length > 2 ? '<div class="netspark">' + pts.map(p => '<i class="' + (p[1] ? '' : 'off') + '" style="height:' + (p[1] ? Math.max(8, Math.min(100, (p[2] || 0) / Math.max(1, ...pts.map(x => x[2] || 0)) * 100)) : 100) + '%"></i>').join('') + '</div>' : '';
    const nd = st.newDevs || [];
    const x = '<div class="netbox"><div class="nbh"><span class="nbdot ' + (st.online ? 'g' : st.online === false ? 'p' : '') + '"></span><div><b>Ligne internet</b><small>' + (st.online === false ? 'coupée depuis ' + hm(st.since) : st.online ? 'en ligne depuis ' + new Date(st.since).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'vérification…') + (hi.uptime != null ? ' · disponible ' + String(hi.uptime).replace('.', ',') + ' % sur 7 jours' : '') + '</small></div></div>' + spark +
      ((hi.outages || []).length ? '<div class="nbouts">' + hi.outages.slice(0, 5).map(o => '<span>' + ico('alert') + new Date(o.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + (o.end ? Math.max(1, Math.round((o.end - o.start) / 6e4)) + ' min' : 'en cours') + '</span>').join('') + '</div>' : '<small class="muted">Aucune coupure ces 7 derniers jours.</small>') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="gwOpen">' + ico('wifi') + 'Wi-Fi invités</button><button class="btn sm" data-act="pcOpen">' + ico('lock') + 'Contrôle parental</button>' + (isAdmin() ? sw('netWatch', st.watch !== false, 'Prévenir d’un nouvel appareil') : '') + '</div></div>' +
      (nd.length ? '<div class="netbox"><b>' + ico('alert') + ' Nouveaux appareils</b><div class="list">' + nd.map(n => '<div class="li netc"><span class="ic">' + ico(n.link === 'wifi' ? 'wifi' : 'link') + '</span><div><b>' + esc(n.name || n.mac) + '</b><small>' + esc([n.ip, n.mac, new Date(n.t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })].join(' · ')) + '</small></div>' + (isAdmin() ? '<button class="btn sm" data-act="netKnown" data-arg="' + esc(n.mac) + '">' + ico('check') + 'Je le connais</button>' : '') + '</div>').join('') + '</div></div>' : '');
    return /^<div class="netboxes/.test(h) ? h.replace(/<\/div>$/, '') + x + '</div>' : h + '<div class="netboxes">' + x + '</div>';
  };
  B.act('netWatch', async () => { await save({ netWatch: !(((V.state || {}).net || {}).watch !== false) }); await load(); B.emit('reseau'); });
  B.act('netKnown', async el => { try { await req('/api/extra/net/known', { mac: el.dataset.arg }); await load(); B.emit('reseau'); } catch (e) { } });
  const rr = B.ROUTES && B.ROUTES.reseau; if (rr) { const a0 = rr.after; rr.after = () => { if (a0) a0(); load().then(loadHist); }; }

  /* ======================= 4. réveil en douceur ======================= */
  let WK = null;
  async function wkBody() {
    const l = V.cfg.wakes || [], tabs = await tablets(), w = l.find(x => x.id === WK);
    const lights = devs(d => d.k === 'light' || d.k === 'rgb'), covers = devs(d => ['cover', 'awning'].includes(d.k));
    return '<h2>' + ico('sun') + 'Réveil en douceur</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">La lumière monte doucement (chaude puis plus vive), les volets s’ouvrent petit à petit, puis la tablette de la chambre lance la radio et dit bonjour avec la météo, Tempo et les poubelles. À une heure fixe, ou au moment où sonne l’alarme de l’iPhone (Raccourcis › Automatisation › Alarme).</p>' +
      '<div class="list">' + l.map(x => '<div class="li pcli"><span class="ic">' + ico('sun') + '</span><div><b>' + esc(x.name) + '</b><small>' + (x.time ? x.time + ' ' + (x.days && x.days.length ? x.days.map(d => DAYS[d]).join(' ') : 'tous les jours') : 'sur l’alarme de l’iPhone') + ' · ' + (x.ramp || 15) + ' min</small></div><span class="row" style="gap:6px"><button class="btn sm" data-act="wkRun" data-arg="' + x.id + '">' + ico('play') + 'Essayer</button><button class="sq" data-act="wkEdit" data-arg="' + x.id + '">' + ico('edit') + '</button></span></div>').join('') + '</div><button class="btn" data-act="wkEdit">' + ico('plus') + 'Réveil</button>' +
      (w ? '<div class="tbbox" style="margin-top:12px"><div class="grid2"><label class="field">Nom<input value="' + esc(w.name) + '" data-change="wkSet" data-arg="name"></label><label class="field">Pour<select data-change="wkSet" data-arg="who">' + S.users.map(u => '<option' + (w.who === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select></label><label class="field">Heure (vide = alarme de l’iPhone)<input type="time" value="' + esc(w.time || '') + '" data-change="wkSet" data-arg="time"></label><label class="field">Montée de la lumière (min)<input type="number" min="1" max="45" value="' + (w.ramp || 15) + '" data-change="wkSet" data-arg="ramp"></label></div>' +
        '<div class="rlrow"><span class="muted">Jours</span>' + daysPick('wkDay', 'd', w.days) + '</div><b>Lumières</b><div class="alpick">' + (lights.map(d => ck('wkPick', 'lights|' + d.id, (w.lights || []).includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucune lumière pilotable par le NAS.</small>') + '</div>' +
        '<b>Volets</b><div class="alpick">' + (covers.map(d => ck('wkPick', 'covers|' + d.id, (w.covers || []).includes(d.id), esc(dlabel(d)))).join('') || '<small class="muted">Aucun volet pilotable par le NAS.</small>') + '</div>' +
        '<div class="grid2"><label class="field">Tablette de la chambre (Fully Kiosk)<select data-change="wkSet" data-arg="tablet"><option value="">—</option>' + tabs.map(t => '<option value="' + t.ip + '"' + (w.tablet === t.ip ? ' selected' : '') + '>' + esc(t.name + (t.room ? ' · ' + t.room : '')) + '</option>').join('') + '</select></label><label class="field">Radio<select data-change="wkSet" data-arg="radio"><option value="">aucune</option>' + radios().map(r => '<option value="' + esc(r.ref) + '"' + (w.radio === r.ref ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label></div>' +
        ck('wkSay', 'say', w.say !== false, 'Dire bonjour avec la météo, Tempo et les poubelles') + '<div class="row" style="gap:8px;margin-top:6px"><button class="btn sm dan" data-act="wkDel">' + ico('trash') + 'Supprimer</button></div>' +
        '<p class="muted" style="font-size:12px;line-height:1.5">iPhone : Raccourcis › Automatisation › <b>Alarme</b> › « Lorsque l’alarme sonne » › Obtenir le contenu de l’URL : <code>' + esc((S.conn.server.url || '') + '/api/quick?do=wake&id=' + w.id + '&d=JETON') + '</code> (jeton : Outils › iPhone).</p></div>' : '');
  }
  const wkR = async () => modal('wkmodal', await wkBody());
  const wkL = () => JSON.parse(JSON.stringify(V.cfg.wakes || []));
  const wkUpd = async f => { const l = wkL(), w = l.find(x => x.id === WK); f(w); if (await save({ wakes: l })) wkR(); };
  B.act('wkOpen', async () => { if (!needAdmin()) return; await load(); wkR(); });
  B.act('wkEdit', async el => { if (el.dataset && el.dataset.arg) { WK = el.dataset.arg; return wkR(); } const w = { id: 'w' + Date.now().toString(36), name: 'Réveil de ' + B.user().name, who: B.user().name, time: '07:00', days: [1, 2, 3, 4, 5], ramp: 15, lights: [], covers: [], tablet: '', radio: '', say: true, on: true }; WK = w.id; if (await save({ wakes: wkL().concat([w]) })) wkR(); });
  B.act('wkSet', el => wkUpd(w => { w[el.dataset.arg] = el.dataset.arg === 'ramp' ? +el.value : el.value; }));
  B.act('wkDay', el => wkUpd(w => { w.days = tog(w.days, +el.dataset.arg.split('|')[1]); }));
  B.act('wkPick', el => { const [k, id] = el.dataset.arg.split('|'); wkUpd(w => { w[k] = tog(w[k], id); }); });
  B.act('wkSay', el => wkUpd(w => { w.say = el.checked; }));
  B.act('wkDel', async () => { if (!confirm('Supprimer ce réveil ?')) return; const l = wkL().filter(x => x.id !== WK); WK = null; if (await save({ wakes: l })) wkR(); });
  B.act('wkRun', async el => { try { await req('/api/extra/wake', { id: el.dataset.arg, by: B.user().name }); B.toast('Réveil lancé', 'sun'); } catch (e) { B.toast(e.message, 'info'); } });

  /* ======================= 5. modes : options dans l'éditeur de scène ======================= */
  // l'éditeur de scène (plus.js) reçoit une section « Mode » ; appliquer la scène lance aussi ses options
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="scRun"],[data-act="scTry"]'); if (!b || !srv() || !V.cfg) return;
    const id = b.dataset.arg, sc = id && ((B.P && B.P.cfg && B.P.cfg.scenes) || []).find(s => s.id === id);
    if (sc && sc.mode) { req('/api/extra/mode', { id: sc.id }).catch(() => { }); if (sc.mode.radio && !sc.mode.tablet && B.Music) { const r = radios().find(x => x.ref === sc.mode.radio); if (r) B.Music.play(r.id); } }
  });
  const mo = new MutationObserver(() => {
    const m = document.querySelector('.scmodal2'); if (!m || m.querySelector('.scmode') || !B.scEditing) return;
    const sc = B.scEditing(), md = sc.mode || {}, anchor = m.querySelector('.row:last-child'); if (!anchor) return;
    const box2 = document.createElement('div'); box2.className = 'scmode tbbox';
    box2.innerHTML = '<b>' + ico('film') + 'Mode (facultatif) : cinéma, repas, invités…</b><div class="grid2"><label class="field">Ne pas déranger<select data-change="scMode" data-arg="dnd">' + [[0, 'non'], [1, '1 h'], [2, '2 h'], [3, '3 h'], [8, 'la nuit']].map(o => '<option value="' + o[0] + '"' + (+md.dnd === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label class="field">Musique (radio)<select data-change="scMode" data-arg="radio"><option value="">aucune</option>' + radios().map(r => '<option value="' + esc(r.ref) + '"' + (md.radio === r.ref ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label><label class="field">Annonce<input value="' + esc(md.say || '') + '" data-change="scMode" data-arg="say" placeholder="À table !"></label></div>' + ck('scMode', 'guest', !!md.guest, 'Allumer le Wi-Fi invités');
    anchor.parentNode.insertBefore(box2, anchor);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  B.act('scMode', el => { const sc = B.scEditing && B.scEditing(); if (!sc) return; sc.mode = Object.assign({}, sc.mode, { [el.dataset.arg]: el.type === 'checkbox' ? el.checked : el.dataset.arg === 'dnd' ? +el.value : el.value }); if (!sc.mode.dnd && !sc.mode.radio && !sc.mode.say && !sc.mode.guest) delete sc.mode; });
  B.act('modeTpl', async () => {
    if (!B.P || !B.P.cfg) return B.toast('Serveur Bêta nécessaire', 'server');
    const rooms = B.roomsList(null), r = rooms.find(x => /salon|séjour/i.test(x.name)) || rooms[0], kit = rooms.find(x => /cuisine|séjour|repas/i.test(x.name)) || r;
    const st = (room, f) => { const o = {}; (room ? room.devs : []).forEach(d => { const k = B.kindOf(d); if (k === 'light' || k === 'rgb') o[d.id] = f.light; else if (['cover', 'awning'].includes(k) && f.cover != null) o[d.id] = { pos: f.cover }; else if (d.type === 'media' && f.media != null) o[d.id] = { on: f.media }; }); return o; };
    const mk = (id, name, icon, room, f, mode) => ({ id: 'mode-' + id, name, icon, room: room ? room.name : 'maison', rkey: room ? room.key : 'maison', moments: [], adaptive: false, states: st(room, f), mode });
    const list = (B.P.cfg.scenes || []).filter(s => !/^mode-/.test(s.id)).concat([mk('cine', 'Cinéma', 'film', r, { light: { on: true, bri: 8, color: '#3b2bff' }, cover: 0, media: true }, { dnd: 3 }), mk('repas', 'À table', 'utensils', kit, { light: { on: true, bri: 80 } }, { say: 'À table !', dnd: 1 }), mk('invites', 'Invités', 'family', r, { light: { on: true, bri: 70 } }, { guest: true })]);
    try { await req('/api/plus', { scenes: list }, 'PUT'); B.P.cfg.scenes = list; B.emit('plus'); B.toast('Modes Cinéma, À table et Invités créés : ajustez-les avec le crayon', 'film'); } catch (e) { B.toast(e.message, 'info'); }
  });
  const scl0 = RENDER.scList; if (scl0) RENDER.scList = () => { const h = scl0(); return srv() ? h.replace('<button class="btn pri" data-act="scEdit">', '<button class="btn" data-act="modeTpl">' + ico('film') + 'Créer les modes Cinéma, À table, Invités</button>' + (V.cfg && V.cfg.dnd > Date.now() ? '<button class="btn" data-act="dndOff">' + ico('bellFill') + 'Ne pas déranger jusqu’à ' + hm(V.cfg.dnd) + ' · arrêter</button>' : '') + '<button class="btn pri" data-act="scEdit">') : h; };
  B.act('dndOff', async () => { await req('/api/extra/dnd', { hours: 0 }).catch(() => { }); await load(); B.emit('plus'); });

  /* ======================= 7. conseiller Tempo et appareils décalés ======================= */
  function tpBody() {
    const c = V.cfg, plugs = devs(d => ['plug', 'switch', 'power', 'heater'].includes(d.k));
    return '<h2>' + ico('boltPlain') + 'Conseiller Tempo</h2><p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 10px">La veille d’un jour rouge, une notification concrète : chauffage baissé, appareils les plus gourmands de la semaine à décaler, appareils coupés automatiquement. Et vos appareils « décalables » (chauffe-eau, borne, déshumidificateur…) suivent les heures creuses tout seuls.</p>' +
      sw('tpAdv', c.advice !== false, 'Conseils détaillés la veille d’un jour rouge') +
      '<h4 class="rlh">' + ico('plug') + 'Appareils décalés automatiquement</h4><div class="list">' + (plugs.map(d => { const s = (c.shift || []).find(x => x.dev === d.id); return '<div class="li" style="grid-template-columns:1fr auto"><span>' + esc(dlabel(d)) + '</span><select data-change="tpShift" data-arg="' + d.id + '"><option value="">jamais</option><option value="red"' + (s && s.mode === 'red' ? ' selected' : '') + '>coupé les jours rouges (6 h – 22 h)</option><option value="hc"' + (s && s.mode === 'hc' ? ' selected' : '') + '>seulement en heures creuses</option></select></div>'; }).join('') || '<p class="muted">Aucune prise pilotable par le NAS.</p>') + '</div>';
  }
  B.act('tpOpen', async () => { if (!needAdmin()) return; await load(); modal('tpmodal', tpBody()); });
  B.act('tpAdv', async () => { await save({ advice: V.cfg.advice === false }); modal('tpmodal', tpBody()); });
  B.act('tpShift', async el => { const l = (V.cfg.shift || []).filter(x => x.dev !== el.dataset.arg).concat(el.value ? [{ dev: el.dataset.arg, mode: el.value }] : []); await save({ shift: l }); });

  /* ======================= 9-10. page Matin ======================= */
  async function loadMorning() { if (!srv() || !V.cfg) return; try { V.morning = await req('/api/extra/morning'); } catch (e) { } B.emit('matin'); }
  const WMO = c => c == null ? '' : c === 0 ? 'Ciel dégagé' : c <= 3 ? 'Quelques nuages' : c <= 48 ? 'Brouillard' : c <= 67 ? 'Pluie' : c <= 77 ? 'Neige' : c <= 82 ? 'Averses' : 'Orages';
  RENDER.mWeather = () => {
    const m = V.morning || {}, w = m.weather, now = new Date(), tr = (m.trash || []).filter(e => e.date === F.ymd(new Date(Date.now() + 864e5))), tp = m.tempo;
    return '<div class="mwx"><div class="mwxt"><b>' + F.time(now) + '</b><span>' + F.dayMonth(now) + '</span></div>' + (w ? '<div class="mwxn">' + (B.wxIcon ? B.wxIcon(w.code, false) : '') + '<b>' + w.now + '°</b><small>' + WMO(w.code) + ' · ' + w.min + '° / ' + w.max + '°' + (w.rain >= 30 ? ' · pluie ' + w.rain + ' %' : '') + '</small></div>' : B.WX && B.WX.now ? '<div class="mwxn"><b>' + Math.round(B.WX.now.temp) + '°</b></div>' : '') +
      '<div class="mchips">' + (tp && tp.today ? '<span class="t-' + tp.today + '">' + ico('boltPlain') + 'Tempo ' + tp.today + '</span>' : '') + tr.map(e => '<span>' + ico('trash') + 'Ce soir : ' + esc(e.name) + '</span>').join('') + (m.reminders || []).map(r => '<span>' + ico('history') + esc(r) + '</span>').join('') + ((B.P && B.P.board) || []).slice(0, 2).map(x => '<span>' + ico('chat') + esc(x.text) + '</span>').join('') + '</div></div>';
  };
  RENDER.mAgenda = () => {
    const today = F.ymd(new Date()), ev = (S.events || []).filter(e => e.date === today && !e.trashAuto).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
    return '<div class="list scroll">' + (ev.map(e => '<div class="li magl"><span class="mcol" style="background:' + esc(e.color || '#2fd3ff') + '"></span><b>' + esc(e.time || 'Journée') + '</b><span>' + esc(e.title) + '</span></div>').join('') || '<p class="muted">Rien au programme aujourd’hui.</p>') + '</div>';
  };
  RENDER.mTraffic = () => {
    const l = (V.morning || {}).traffic || [];
    return '<div class="list">' + (l.map(t => t.err ? '<div class="li"><span>' + esc(t.name) + ' : ' + esc(t.err) + '</span></div>' : '<div class="li mtr ' + (t.delay >= 10 ? 'p' : t.delay >= 4 ? 'y' : 'g') + '"><span class="ic">' + ico('car') + '</span><div><b>' + esc((t.who ? t.who + ' → ' : '') + t.name) + '</b><small>' + t.km.toString().replace('.', ',') + ' km' + (t.live ? (t.delay ? ' · +' + t.delay + ' min de bouchons' : ' · fluide') : ' · sans le trafic (clé TomTom pour le direct)') + '</small></div><b class="mmin">' + t.min + ' min</b></div>').join('') || '<p class="muted" style="font-size:13px">Ajoutez vos trajets (travail, école) : Outils › Tableau du matin.</p>') + '</div>';
  };
  RENDER.mTransit = () => {
    const l = (V.morning || {}).transit || [];
    return '<div class="list scroll">' + (l.map(x => x.err ? '<div class="li"><small class="muted">' + esc(x.src + ' ' + x.stop + ' : ' + x.err) + '</small></div>' : '<div class="li mdep"><span class="mline ' + x.mode + '">' + esc(String(x.line || '').trim().slice(0, 14)) + '</span><div><b>' + esc(x.dir || '') + '</b><small>' + esc(x.stop) + (x.late > 0 ? ' · ' + x.late + ' min de retard' : '') + '</small></div><b class="mmin">' + Math.max(0, Math.round((x.at - Date.now()) / 6e4)) + ' min</b></div>').join('') || '<p class="muted" style="font-size:13px">Bus et tram CTS, TER Fegersheim-Lipsheim : Outils › Tableau du matin.</p>') + '</div>';
  };
  B.route('matin', { title: 'Matin', bg: 'assets/bg/generic.jpg', render: () => B.side('matin') + B.header({ id: 'matin', title: 'Bonjour !', sub: 'Tout pour bien partir', icon: 'sun', info: { t: 'infobox', keys: ['matin'], items: () => { const m = V.morning || {}, t = (m.traffic || []).filter(x => !x.err)[0], d = (m.transit || []).filter(x => !x.err)[0]; return [{ icon: 'car', v: t ? t.min + ' min' : '—', l: t ? t.name : 'Trajet', cls: t && t.delay >= 10 ? 'p' : 'c' }, { icon: 'route', v: d ? Math.max(0, Math.round((d.at - Date.now()) / 6e4)) + ' min' : '—', l: d ? String(d.line).trim() : 'Prochain départ', cls: 'y' }, { icon: 'trash', v: (m.trash || []).filter(e => e.date === F.ymd(new Date(Date.now() + 864e5))).length || '—', l: 'Poubelles ce soir' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 800, 600]) + '">' + B.whead('sunGear', 'Aujourd’hui') + T({ t: 'mWeather', keys: ['matin', 'clock'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([105, 610, 800, 1012]) + '">' + B.whead('cal', 'Agenda') + T({ t: 'mAgenda', keys: ['matin', 'events'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 235, 1522, 560]) + '">' + B.whead('home', 'Trajets') + T({ t: 'mTraffic', keys: ['matin'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 570, 1522, 1012]) + '">' + B.whead('link', 'Départs bus, tram et TER') + T({ t: 'mTransit', keys: ['matin', 'clock'] }) + '</section>', after: () => load().then(loadMorning) });
  setInterval(() => { if (B.current === 'matin' && !document.hidden) loadMorning(); }, 60000);
  // configuration : trajets, clés, arrêts ; et affichage automatique sur cette tablette
  const DK = 'betaos.device', dcfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } }, dset = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  let NEAR = { cts: null, sncf: null };
  function mcBody() {
    const c = V.cfg, t = c.transit || {}, mm = dcfg().morning || {};
    const stops = (src, list, key) => (NEAR[src] || []).map(s => ck('mcStop', src + '|' + (s.ref || s.id) + '|' + s.name, (list || []).some(x => (x.ref || x.id) === (s.ref || s.id)), esc(s.name))).join('') + (list || []).filter(x => !(NEAR[src] || []).some(s => (s.ref || s.id) === (x.ref || x.id))).map(s => ck('mcStop', src + '|' + (s.ref || s.id) + '|' + s.name, true, esc(s.name))).join('');
    return '<h2>' + ico('sun') + 'Tableau du matin</h2>' +
      '<section class="svsec"><h4 class="rlh">' + ico('monitor') + 'Sur cette tablette</h4>' + sw('mcAuto', mm.on, 'Afficher le tableau du matin tout seul') + '<div class="grid2"><label class="field">de<input type="time" value="' + esc(mm.from || '06:30') + '" data-change="mcAt" data-arg="from"></label><label class="field">à<input type="time" value="' + esc(mm.to || '09:00') + '" data-change="mcAt" data-arg="to"></label></div></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('car') + 'Trajets</h4>' + (c.commute || []).map((x, i) => '<div class="rlrow"><select data-change="mcC" data-arg="' + i + '|who"><option value="">—</option>' + S.users.map(u => '<option' + (x.who === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select><input value="' + esc(x.name) + '" data-change="mcC" data-arg="' + i + '|name" placeholder="Travail"><input value="' + esc(x.to || '') + '" data-change="mcC" data-arg="' + i + '|to" placeholder="Adresse" style="flex:1 1 200px"><small class="muted">' + (x.err ? '⚠ ' + esc(x.err) : x.lat ? '✓' : '') + '</small><button type="button" class="sq" data-act="mcCDel" data-arg="' + i + '">' + ico('x') + '</button></div>').join('') +
        '<button class="btn sm" data-act="mcCAdd">' + ico('plus') + 'Trajet</button><label class="field">Clé TomTom (gratuite, pour les bouchons en direct)<input type="password" placeholder="' + (c.traffic.tomtom ? 'déjà enregistrée' : 'developer.tomtom.com') + '" data-change="mcKey" data-arg="tomtom"></label><small class="muted">Sans clé : temps de trajet sans le trafic (OpenStreetMap).</small></section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('route') + 'Bus et tram CTS</h4><label class="field">Jeton CTS (gratuit : api.cts-strasbourg.eu)<input type="password" placeholder="' + (t.cts ? 'déjà enregistré' : 'jeton') + '" data-change="mcKey" data-arg="cts"></label>' + (t.cts ? '<button class="btn sm" data-act="mcNear" data-arg="cts">' + ico('pin') + 'Arrêts près de la maison</button><div class="alpick">' + stops('cts', t.ctsStops) + '</div>' : '') + '</section>' +
      '<section class="svsec"><h4 class="rlh">' + ico('route') + 'Trains TER (SNCF)</h4><label class="field">Clé SNCF (gratuite : numerique.sncf.com › API)<input type="password" placeholder="' + (t.sncf ? 'déjà enregistrée' : 'clé') + '" data-change="mcKey" data-arg="sncf"></label>' + (t.sncf ? '<button class="btn sm" data-act="mcNear" data-arg="sncf">' + ico('pin') + 'Gares proches (Fegersheim-Lipsheim…)</button><div class="alpick">' + stops('sncf', t.sncfStops) + '</div>' : '') + '</section>';
  }
  const mcR = () => modal('mcmodal', mcBody());
  const mcL = () => JSON.parse(JSON.stringify(V.cfg.commute || []));
  B.act('mcOpen', async () => { if (!need()) return; await load(); mcR(); });
  B.act('mcAuto', () => { const c = dcfg(); c.morning = Object.assign({ from: '06:30', to: '09:00' }, c.morning, { on: !(c.morning || {}).on }); dset(c); mcR(); });
  B.act('mcAt', el => { const c = dcfg(); c.morning = Object.assign({ from: '06:30', to: '09:00' }, c.morning, { [el.dataset.arg]: el.value }); dset(c); });
  B.act('mcC', async el => { if (!isAdmin()) return; const [i, k] = el.dataset.arg.split('|'), l = mcL(); l[+i][k] = el.value; if (k === 'to') { delete l[+i].lat; delete l[+i].err; } if (await save({ commute: l })) mcR(); });
  B.act('mcCAdd', async () => { if (await save({ commute: mcL().concat([{ id: 'c' + Date.now().toString(36), who: B.user().name, name: 'Travail', to: '' }]) })) mcR(); });
  B.act('mcCDel', async el => { const l = mcL(); l.splice(+el.dataset.arg, 1); if (await save({ commute: l })) mcR(); });
  B.act('mcKey', async el => { const k = el.dataset.arg, v = el.value.trim(); if (await save(k === 'tomtom' ? { traffic: { tomtom: v } } : { transit: { [k]: v } })) mcR(); });
  B.act('mcNear', async el => { try { NEAR[el.dataset.arg] = await req('/api/extra/transit/near?src=' + el.dataset.arg); if (!NEAR[el.dataset.arg].length) B.toast('Aucun arrêt trouvé près de l’adresse de la maison', 'info'); mcR(); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('mcStop', async el => { const [src, id, ...n] = el.dataset.arg.split('|'), key = src === 'cts' ? 'ctsStops' : 'sncfStops', l = (V.cfg.transit[key] || []).filter(x => (x.ref || x.id) !== id).concat(el.checked ? [src === 'cts' ? { ref: id, name: n.join('|') } : { id, name: n.join('|') }] : []); if (await save({ transit: { [key]: l } })) mcR(); });
  // affichage automatique le matin sur cette tablette
  let mDone = '';
  setInterval(() => {
    const mm = dcfg().morning; if (!mm || !mm.on || !mod('matin')) return;
    const t = F.time(new Date()), inW = t >= (mm.from || '06:30') && t < (mm.to || '09:00'), day = F.ymd(new Date());
    if (inW && mDone !== day && !document.querySelector('.modal')) { mDone = day; if (B.tabletWake) B.tabletWake(); location.hash = 'matin'; }
    if (!inW && B.current === 'matin' && mDone === day) { mDone = day + '-fin'; location.hash = (B.startPage && B.startPage()) || 'accueil'; }
  }, 30000);

  /* ======================= 11. interphone ======================= */
  const PHRASES = ['À table !', 'On part dans 5 minutes', 'Venez m’aider s’il vous plaît', 'Le repas est prêt', 'Extinction des feux, bonne nuit', 'Quelqu’un peut ouvrir la porte ?'];
  let IT = { to: 'all' };
  RENDER.icTargets = () => {
    if (!srv() || !V.cfg) return '<p class="warn">L’interphone passe par le serveur Bêta du NAS et les tablettes Fully Kiosk.</p>';
    const t = V.tablets || [];
    return '<div class="ictg"><button class="' + (IT.to === 'all' ? 'on' : '') + '" data-act="icTo" data-arg="all">' + ico('group') + '<b>Toute la maison</b><small>' + t.length + ' tablette(s)</small></button>' + t.map(x => '<button class="' + (IT.to === x.ip ? 'on' : '') + (x.online ? '' : ' off') + '" data-act="icTo" data-arg="' + x.ip + '">' + ico('monitor') + '<b>' + esc(x.name) + '</b><small>' + esc(x.room || x.ip) + '</small></button>').join('') + '</div>' +
      (isAdmin() ? '<button class="btn sm" data-act="icNames">' + ico('edit') + 'Nommer les tablettes</button>' : '');
  };
  RENDER.icSend = () => '<div class="icsend"><div class="icph">' + PHRASES.map(p => '<button class="btn" data-act="icSay" data-arg="' + esc(p) + '">' + esc(p) + '</button>').join('') + '</div><form class="icform"><input placeholder="Votre message…" maxlength="300">' + (window.webkitSpeechRecognition || window.SpeechRecognition ? '<button type="button" class="btn" data-act="icMic" aria-label="Dicter">' + ico('mic') + '</button>' : '') + '<button class="btn pri">' + ico('send') + 'Annoncer</button></form><p class="muted" style="font-size:12px">Lu à voix haute par Fully Kiosk sur la ou les tablettes choisies, et affiché sur les écrans ouverts. Siri : « Dis Siri, annonce à la cuisine… » (Outils › iPhone).</p></div>';
  B.route('interphone', { title: 'Interphone', bg: 'assets/bg/generic.jpg', render: () => B.side('interphone') + B.header({ id: 'interphone', title: 'Interphone', sub: 'Parler à une pièce ou à toute la maison', icon: 'mic', info: { t: 'infobox', keys: ['vie'], items: () => [{ icon: 'monitor', v: (V.tablets || []).filter(x => x.online).length, l: 'Tablettes en ligne', cls: 'c' }, { icon: 'bellFill', v: V.cfg && V.cfg.dnd > Date.now() ? hm(V.cfg.dnd) : 'Non', l: 'Ne pas déranger' }] } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 760, 1012]) + '">' + B.whead('group', 'À qui ?') + T({ t: 'icTargets', keys: ['vie'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([770, 235, 1522, 1012]) + '">' + B.whead('chat', 'Message') + T({ t: 'icSend', keys: [] }) + '</section>', after: async () => { await load(); V.tablets = null; await tablets(); B.emit('vie'); } });
  const announce = async text => { if (!text) return; try { const r = await req('/api/extra/announce', { text, to: IT.to === 'all' ? 'all' : [IT.to], by: B.user().name }); B.toast('Annoncé sur ' + r.n + ' tablette(s)', 'mic'); } catch (e) { B.toast(e.message, 'info'); } };
  B.act('icTo', el => { IT.to = el.dataset.arg; B.emit('vie'); });
  B.act('icSay', el => announce(el.dataset.arg));
  document.addEventListener('submit', e => { if (!e.target.classList || !e.target.classList.contains('icform')) return; e.preventDefault(); const i = e.target.querySelector('input'); announce(i.value.trim()); i.value = ''; });
  B.act('icMic', () => { const R = window.SpeechRecognition || window.webkitSpeechRecognition; try { const r = new R(); r.lang = 'fr-FR'; r.onresult = ev => { const i = document.querySelector('.icform input'); if (i) i.value = ev.results[0][0].transcript; }; r.onerror = () => B.toast('Dictée indisponible ici (il faut une adresse https)', 'info'); r.start(); B.toast('Parlez…', 'mic'); } catch (e) { B.toast('Dictée indisponible', 'info'); } });
  B.act('icNames', async () => { V.tablets = null; const t = await tablets(); B.modal('<h2>' + ico('monitor') + 'Tablettes</h2><div class="list">' + t.map(x => '<div class="rlrow"><b style="min-width:110px">' + esc(x.ip) + '</b><input value="' + esc(x.name) + '" data-change="icName" data-arg="' + x.ip + '|name" placeholder="Tablette cuisine"><input value="' + esc(x.room || '') + '" data-change="icName" data-arg="' + x.ip + '|room" placeholder="Cuisine"></div>').join('') + '</div><p class="muted" style="font-size:12px">Donnez le même nom dans Paramètres › Cet écran sur chaque tablette : les messages ciblés s’y afficheront aussi.</p>', 'wide'); });
  B.act('icName', async el => { const [ip, k] = el.dataset.arg.split('|'), tb = Object.assign({}, V.cfg.tablets); tb[ip] = Object.assign({}, tb[ip], { [k]: el.value }); await save({ tablets: tb }); V.tablets = null; await tablets(); B.emit('vie'); });
  // message reçu : bandeau sur cet écran (s'il est visé)
  B.on && B.on('nas', ev => {
    if (ev.type === 'dnd' && V.cfg) { V.cfg.dnd = ev.until; B.emit('vie'); B.emit('plus'); }
    if (ev.type !== 'say' || ev.board) return;
    const me = dcfg().name || ''; if (ev.to && ev.to.length && !ev.to.includes(me)) return;
    const o = document.createElement('div'); o.className = 'icpop'; o.innerHTML = ico('mic') + '<div><b>' + esc(ev.text) + '</b>' + (ev.from ? '<small>' + esc(ev.from) + '</small>' : '') + '</div>'; o.addEventListener('click', () => o.remove()); document.body.appendChild(o); setTimeout(() => o.remove(), 15000);
  });

  /* ======================= 12. rappels d'entretien ======================= */
  const TPL = [['Changer le filtre de la VMC', 6, 'fan'], ['Entretien de la chaudière', 12, 'flame'], ['Détartrer la machine à café', 2, 'utensils'], ['Nettoyer le filtre du lave-vaisselle', 1, 'dishwasher'], ['Tester les détecteurs de fumée', 6, 'alert'], ['Contrôle technique de la voiture', 24, 'car'], ['Ramonage', 12, 'flame'], ['Nettoyer les filtres de la clim', 3, 'snow'], ['Purger les radiateurs', 12, 'therm'], ['Sel de l’adoucisseur', 2, 'dropFill']];
  async function loadRem() { if (!srv() || !V.cfg) return; try { V.rem = await req('/api/extra/reminders'); } catch (e) { } B.emit('lists'); B.emit('house'); }
  setTimeout(loadRem, 5000); setInterval(loadRem, 30 * 6e4);
  const today = () => F.ymd(new Date());
  function rmBody() {
    const l = V.rem || [];
    return '<h2>' + ico('history') + 'Rappels de la maison</h2><p class="muted" style="font-size:13px;margin:0 0 10px">Une notification le jour venu (à 10 h), et le rappel s’affiche sur l’accueil et dans Listes jusqu’à ce qu’on touche « Fait ».</p>' +
      '<div class="list">' + l.map(r => '<div class="li rmli ' + (r.next <= today() ? 'due' : '') + '"><span class="ic">' + ico(r.icon || 'history') + '</span><div><b>' + esc(r.name) + '</b><small>tous les ' + r.every + ' mois · ' + (r.last ? 'fait le ' + new Date(r.last + 'T12:00').toLocaleDateString('fr-FR') + ' · ' : '') + (r.next <= today() ? 'à faire' : 'prochain : ' + new Date(r.next + 'T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })) + '</small></div><span class="row" style="gap:6px"><button class="btn sm" data-act="rmDone" data-arg="' + r.id + '">' + ico('check') + 'Fait</button><input type="number" min="1" max="120" value="' + r.every + '" data-change="rmEvery" data-arg="' + r.id + '" style="width:60px" title="mois"><button class="sq" data-act="rmDel" data-arg="' + r.id + '">' + ico('x') + '</button></span></div>').join('') + '</div>' +
      '<h4 class="rlh">' + ico('plus') + 'Ajouter</h4><div class="alpick">' + TPL.filter(t => !l.some(r => r.name === t[0])).map((t, i) => '<button class="btn sm" data-act="rmTpl" data-arg="' + TPL.indexOf(t) + '">' + ico(t[2]) + esc(t[0]) + ' · ' + t[1] + ' mois</button>').join('') + '</div><form class="rmform rlrow"><input placeholder="Autre rappel" style="flex:1 1 200px"><input type="number" min="1" max="120" value="12" style="width:70px"><span class="muted">mois</span><button class="btn sm pri">' + ico('plus') + '</button></form>';
  }
  const rmR = async () => { await loadRem(); modal('rmmodal', rmBody()); };
  const rmL = () => JSON.parse(JSON.stringify((V.cfg && V.cfg.reminders) || []));
  const rmSave = async l => { if (await save({ reminders: l })) rmR(); };
  B.act('rmOpen', async () => { if (!need()) return; await load(); rmR(); });
  B.act('rmTpl', el => { const t = TPL[+el.dataset.arg]; rmSave(rmL().concat([{ id: 'r' + Date.now().toString(36), name: t[0], every: t[1], icon: t[2], last: F.ymd(new Date()) }])); });
  B.act('rmEvery', el => { const l = rmL(), r = l.find(x => x.id === el.dataset.arg); r.every = Math.max(1, +el.value || 12); rmSave(l); });
  B.act('rmDel', el => rmSave(rmL().filter(x => x.id !== el.dataset.arg)));
  B.act('rmDone', async el => { try { V.rem = (await req('/api/extra/reminder/done', { id: el.dataset.arg })).reminders; await load(); if (document.querySelector('.rmmodal')) modal('rmmodal', rmBody()); B.emit('lists'); B.emit('house'); B.toast('Noté : prochain rappel dans quelques mois', 'check'); } catch (e) { B.toast(e.message, 'info'); } });
  document.addEventListener('submit', e => { if (!e.target.classList || !e.target.classList.contains('rmform')) return; e.preventDefault(); const [n, m] = e.target.querySelectorAll('input'); if (!n.value.trim()) return; rmSave(rmL().concat([{ id: 'r' + Date.now().toString(36), name: n.value.trim(), every: +m.value || 12, icon: 'history', last: F.ymd(new Date()) }])); });
  const due = () => (V.rem || []).filter(r => r.on !== false && r.next <= today());
  const wx0 = B.wxAlerts; B.wxAlerts = () => (wx0 ? wx0() : []).concat(mod('rappels') ? due().slice(0, 2).map(r => ({ icon: 'history', text: 'À faire : ' + r.name, rem: true })) : []);
  const ls0 = RENDER.lsList; if (ls0) RENDER.lsList = s => { const h = ls0(s); if (s.list !== 'taches' || !mod('rappels') || !V.cfg) return h; const d = due(); return h.replace(/<\/div><\/div>$/, '') + '<div class="rmdue"><div class="row" style="justify-content:space-between;align-items:center"><small class="muted">' + ico('history') + ' Entretien de la maison</small><button class="btn sm" data-act="rmOpen">' + ico('gear') + 'Rappels</button></div>' + d.map(r => '<div class="li lsi"><button class="lsck" data-act="rmDone" data-arg="' + r.id + '" aria-label="Fait"></button><div><b>' + esc(r.name) + '</b><small>tous les ' + r.every + ' mois</small></div></div>').join('') + '</div></div></div>'; };

  /* ======================= 13. mode secours ======================= */
  let sos = { nas: 0, net: 0, was: false };
  async function watchdog() {
    const K = S.conn || {}; if (!K.server || !K.server.url) return;
    const was = srv(); await B.Server.ping();
    const ok = srv(); if (!ok && !sos.nas) sos.nas = Date.now(); if (ok) sos.nas = 0;
    if (ok && V.cfg) { const st = await req('/api/extra').catch(() => null); if (st) { V.state = st.state; sos.net = st.state.net && st.state.net.online === false ? st.state.net.since : 0; } }
    if (!navigator.onLine && !sos.net) sos.net = Date.now();
    if (was !== ok) { B.show(); if (ok) { B.toast('Serveur Bêta de retour', 'check'); load(); } }
    banner();
  }
  function banner() {
    let el = document.querySelector('.sosbar');
    const msg = sos.nas ? 'Serveur Bêta injoignable depuis ' + hm(sos.nas) + ' : mode secours. Les appareils Home Assistant restent pilotables, les listes et scènes restent sur cet écran.' : sos.net ? 'Internet coupé depuis ' + hm(sos.net) + ' : la maison continue en local (lumières, règles, alarme).' : '';
    if (!msg) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'sosbar'; el.addEventListener('click', () => el.classList.toggle('min')); document.body.appendChild(el); }
    el.innerHTML = ico(sos.nas ? 'server' : 'wifi') + '<span>' + esc(msg) + '</span>';
  }
  setInterval(watchdog, 30000); window.addEventListener('online', () => { sos.net = 0; banner(); }); window.addEventListener('offline', () => { sos.net = Date.now(); banner(); });
  B.sos = () => sos;

  /* ======================= 14. administration ======================= */
  const sz = b => b == null ? '—' : b > 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' Go' : b > 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' Mo' : Math.round(b / 1e3) + ' Ko';
  const dur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600); return (d ? d + ' j ' : '') + h + ' h ' + Math.floor(s % 3600 / 60) + ' min'; };
  async function loadAdmin() { if (!srv() || !V.cfg) return; try { V.admin = await req('/api/extra/admin'); } catch (e) { V.admin = { err: e.message }; } B.emit('admin'); }
  RENDER.adServer = () => {
    const a = V.admin; if (!srv()) return '<p class="warn">Serveur Bêta injoignable.</p>'; if (!a) return '<p class="muted">Lecture…</p>'; if (a.err) return '<p class="warn">' + esc(a.err) + '</p>';
    const used = a.disk ? (a.disk.total - a.disk.free) / a.disk.total : 0;
    return '<div class="adgrid"><div><small>Version</small><b>' + esc(a.version === 'dev' ? 'locale' : a.version.slice(0, 7)) + '</b></div><div><small>Allumé depuis</small><b>' + dur(a.uptime) + '</b></div><div><small>Mémoire du serveur</small><b>' + sz(a.mem) + '</b></div><div><small>Charge (1 / 5 / 15 min)</small><b>' + a.load.map(x => x.toFixed(2)).join(' / ') + '</b></div><div><small>Node.js</small><b>' + esc(a.node) + '</b></div><div><small>Internet</small><b>' + (a.internet.online ? 'en ligne' : a.internet.online === false ? 'coupé' : '—') + '</b></div></div>' +
      '<h4 class="rlh">' + ico('nas') + 'Stockage</h4>' + (a.disk ? '<div class="adbar"><i style="width:' + Math.round(used * 100) + '%" class="' + (used > 0.9 ? 'p' : used > 0.75 ? 'y' : '') + '"></i></div><small class="muted">' + sz(a.disk.free) + ' libres sur ' + sz(a.disk.total) + '</small>' : '') +
      '<div class="adgrid"><div><small>Données Bêta</small><b>' + sz(a.data.bytes) + '</b></div><div><small>Historique</small><b>' + sz(a.sub.history.bytes) + '</b></div><div><small>Sauvegardes</small><b>' + sz(a.sub.backups.bytes) + ' · ' + a.sub.backups.files + '</b></div></div>' +
      '<h4 class="rlh">' + ico('layers') + 'Modules du serveur</h4><div class="adchips">' + Object.keys(a.modules || {}).map(k => '<span class="' + (a.modules[k] ? 'on' : '') + '">' + esc(k) + '</span>').join('') + '</div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn sm" data-act="bkOpen">' + ico('cloudUp') + 'Sauvegardes</button><button class="btn sm" data-act="upOpen">' + ico('download') + 'Mises à jour</button><button class="btn sm" data-act="modOpen">' + ico('layers') + 'Modules</button></div>';
  };
  RENDER.adBrands = () => { const a = V.admin; if (!a || a.err) return ''; return '<div class="list scroll">' + (a.hub.map(h => '<div class="li sti ' + (h.status === 'err' ? 'p' : h.status === 'ok' ? '' : 'y') + '"><span class="ic">' + ico(h.status === 'err' ? 'alert' : h.status === 'ok' ? 'check' : 'info') + '</span><div><b>' + esc(h.name) + '</b><small>' + esc(h.info || h.status || 'non testée') + '</small></div></div>').join('') || '<p class="muted">Aucune marque reliée.</p>') + '</div>'; };
  RENDER.adLogs = () => { const a = V.admin; if (!a || a.err) return ''; return '<div class="list scroll adlogs">' + ((a.logs || []).map(l => '<div class="li ' + l.lvl + '"><small>' + new Date(l.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</small><span>' + esc(l.msg) + '</span></div>').join('') || '<p class="muted">Aucune erreur récente 👍</p>') + '</div>'; };
  B.route('admin', { title: 'Administration', bg: 'assets/bg/generic.jpg', render: () => B.side('admin') + B.header({ id: 'admin', title: 'Administration', sub: 'Serveur, stockage, marques et erreurs', icon: 'server', info: { t: 'infobox', keys: ['admin'], items: () => { const a = V.admin || {}; return [{ icon: 'server', v: a.uptime ? dur(a.uptime).split(' ').slice(0, 2).join(' ') : '—', l: 'Allumé depuis', cls: 'c' }, { icon: 'nas', v: a.disk ? sz(a.disk.free) : '—', l: 'Libres' }, { icon: 'alert', v: (a.logs || []).filter(l => l.lvl === 'error').length, l: 'Erreurs', cls: (a.logs || []).some(l => l.lvl === 'error') ? 'p' : 'g' }, { icon: 'link', v: (a.hub || []).filter(h => h.status === 'err').length, l: 'Marques en erreur' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 800, 1012]) + '">' + B.whead('nas', 'Serveur Bêta', '<button class="wmore" data-act="adReload" aria-label="Actualiser">' + ico('refresh') + '</button>') + T({ t: 'adServer', keys: ['admin'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 235, 1522, 600]) + '">' + B.whead('link', 'Marques') + T({ t: 'adBrands', keys: ['admin'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 610, 1522, 1012]) + '">' + B.whead('alert', 'Journal des erreurs') + T({ t: 'adLogs', keys: ['admin'] }) + '</section>', after: async () => { if (!isAdmin()) { location.hash = 'parametres'; return B.toast('Réservé aux administrateurs', 'lock'); } await load(); loadAdmin(); } });
  B.act('adReload', loadAdmin);

  /* ---------- menus et outils ---------- */
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); const add = (id, label, icon, after) => { if (out.some(n => n[0] === id)) return; const i = out.findIndex(n => n[0] === after); out.splice(i < 0 ? out.length : i + 1, 0, [id, label, icon, icon, 'noside']); }; add('matin', 'Matin', 'sun', 'accueil'); add('interphone', 'Interphone', 'mic', 'listes'); if (isAdmin()) add('admin', 'Administration', 'server', 'reseau'); return out; };
  const TOOLS2 = [['gwOpen', 'wifi', 'Wi-Fi invités', 'QR code, coupure automatique', 'reseau'], ['pcOpen', 'lock', 'Contrôle parental', 'Internet coupé par horaire (Bbox)', 'reseau'], ['wkOpen', 'sun', 'Réveil en douceur', 'Lumière, volets, radio, météo', 'reveil'], ['tpOpen', 'boltPlain', 'Conseiller Tempo', 'Jours rouges, heures creuses', 'energie'], ['mcOpen', 'route', 'Tableau du matin', 'Trajets, bus, tram, TER', 'matin'], ['rmOpen', 'history', 'Rappels de la maison', 'Filtres, chaudière, CT…', 'rappels']];
  const to0 = B.ACT && B.ACT.toolsOpen;
  if (to0) B.act('toolsOpen', el => { to0(el); const g = document.querySelector('.toolsmodal .tools'); if (g) g.insertAdjacentHTML('beforeend', TOOLS2.filter(t => mod(t[4])).map(t => '<button class="tool" data-act="' + t[0] + '">' + ico(t[1]) + '<b>' + t[2] + '</b><small>' + t[3] + '</small></button>').join('')); });
})();
