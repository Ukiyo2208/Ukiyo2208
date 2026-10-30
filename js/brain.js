/* Bêta home 7.11 — le « cerveau » du serveur Bêta, côté écran :
   - envoie au NAS la liste des appareils reliés en direct, les routines (traduites en ordres) et les personnes
   - éditeur de règles « Si… alors… » exécutées par le NAS 24 h/24
   - présence de la famille et mode absent automatique
   - page Sécurité : alarme maison (absence / nuit), clavier, délais, sirènes
   - suit les évènements du NAS : routine lancée par Alexa/Siri, mode absent, annonces, alarme */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const BR = S.brain = Object.assign({ ok: null, cfg: null, status: null }, S.brain || {}, { ok: null });
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const hubMap = () => S.settings.hubMap || {};
  const hubDevs = () => Object.keys(hubMap()).filter(id => DATA.DEVICES[id] && !(B.brandOff && B.brandOff(hubMap()[id].brand))).map(id => Object.assign({ id, k: B.kindOf(DATA.DEVICES[id]) }, DATA.DEVICES[id]));
  const req = (p, body, m) => B.Server.req(p, body, m);

  /* ---------- envoi de la configuration au NAS ---------- */
  // une routine Bêta (« Je pars »…) devient une liste d'ordres sur les appareils reliés en direct
  function compile(r) {
    const a = r.a || {}, act = [], hd = hubDevs(), ext = d => /^ext/.test(B.floorOf(d.id)) || /jardin|terrasse|cour|extérieur|allée|portail/i.test(d.room || '');
    const add = (list, patch) => list.forEach(d => act.push({ dev: d.id, patch }));
    const lights = hd.filter(d => d.k === 'light' || d.k === 'rgb');
    if (a.lights === 'off') add(lights.filter(d => !ext(d)), { on: false });
    if (a.lights === 'accueil') add(lights.filter(d => /entrée|salon|cuisine|séjour/i.test(d.room || '')), { on: true });
    if (a.lights === 'ambiance') add(lights.filter(d => d.k === 'rgb'), { on: true, color: '#ff9a4a' });
    if (a.ext) add(lights.filter(ext), { on: a.ext === 'on' });
    if (a.covers) add(hd.filter(d => d.k === 'cover'), { pos: a.covers === 'open' ? 100 : 0 });
    if (a.clim === 'off') add(hd.filter(d => d.k === 'clim'), { on: false });
    if (a.chauffage) add(hd.filter(d => d.k === 'heater'), { on: true, mode: a.chauffage });
    if (a.vacuum) add(hd.filter(d => d.k === 'vacuum'), { status: 'cleaning' });
    return { id: r.id, name: r.name, actions: act, away: r.id === 'depart' ? true : r.id === 'retour' ? false : undefined, alarm: a.alarm === 'on' ? 'armed_away' : a.alarm === 'off' ? 'off' : undefined, sched: !!r.sched, time: r.time, days: r.days };
  }
  function payload() {
    const devices = {}; hubDevs().forEach(d => { const m = hubMap()[d.id]; devices[d.id] = { brand: m.brand, bid: m.id, kind: d.k, name: d.name, room: d.room || '' }; });
    const users = S.users.map(u => { const p = u.presence || {}; return { id: u.id, name: u.name, admin: !!u.admin, ot: !!p.ot, net: (p.net || []).map(k => { const m = hubMap()[k]; return m && { brand: m.brand, bid: m.id }; }).filter(Boolean) }; });
    return { devices, routines: (S.routines || []).map(compile), users, home: { lat: +S.settings.lat || 48.4917, lon: +S.settings.lon || 7.6806 } };
  }
  let syncT = 0, lastSent = '';
  function sync(now) {
    clearTimeout(syncT); if (!srv() || BR.ok === false || !isAdmin()) return;
    syncT = setTimeout(async () => { const p = payload(), j = JSON.stringify(p); if (j === lastSent) return; try { BR.cfg = await req('/api/engine', p, 'PUT'); lastSent = j; } catch (e) { } }, now ? 0 : 1500);
  }
  B.brainSync = sync;
  async function load() {
    if (!srv()) return;
    try { BR.cfg = await req('/api/engine'); BR.ok = true; } catch (e) { BR.ok = /404/.test(e.message) ? false : null; }
    try { BR.status = await req('/api/engine/status'); } catch (e) { }
    B.emit('brain'); B.emit('autos'); sync(true);
  }
  setTimeout(load, 2500);
  setInterval(() => { if (srv() && BR.ok) { sync(); req('/api/engine/status').then(s => { BR.status = s; B.emit('brain'); B.emit('autos'); }).catch(() => { }); } }, 30000);
  const save = async patch => { try { BR.cfg = await req('/api/engine', patch, 'PUT'); B.emit('brain'); return true; } catch (e) { B.toast('Serveur Bêta : ' + e.message, 'info'); return false; } };
  B.brainSave = save;

  /* ---------- évènements du NAS ---------- */
  let evAt = 0;
  setInterval(async () => {
    if (!srv() || BR.ok === false || document.hidden && !document.querySelector('.saver')) return;
    let r; try { r = await req('/api/engine/events?since=' + evAt); } catch (e) { return; }
    if (evAt) for (const ev of r.events) {
      if (ev.type === 'routine' && B.runRoutine) { const c = await B.Server.post('/api/engine/claim', { t: ev.t, type: 'routine' }).catch(() => ({})); if (c.ok) { B.src = 'nas'; try { B.runRoutine(ev.id, true); } finally { B.src = null; } } }
      if (ev.type === 'say' && B.tabletSay) B.tabletSay(ev.text);
      if (B.fire) B.fire('nas', ev);   // autres modules de l'écran (listes, scènes, détection)
      if (ev.type === 'away') { if (ev.on && !S.away && B.awayLock) B.awayLock(); else if (!ev.on && S.away) { S.away = 0; B.save(); B.emit('house'); B.emit('abs'); } }
    }
    evAt = r.now; BR.alarm = r.alarm; alarmOverlay(r.alarm);
  }, 3000);

  /* ---------- alarme : délai d'entrée / armement → clavier sur tous les écrans ---------- */
  let ov = null, pin = '';
  function alarmOverlay(a) {
    const show = a && (a.status === 'entry' || a.status === 'triggered' || a.status === 'arming');
    if (!show) { if (ov) { ov.remove(); ov = null; } return; }
    const left = a.until ? Math.max(0, Math.ceil((a.until - Date.now()) / 1000)) : 0;
    const title = a.status === 'entry' ? 'Alarme : saisissez votre code' : a.status === 'arming' ? 'Alarme activée dans' : 'ALARME DÉCLENCHÉE';
    if (!ov) { ov = document.createElement('div'); ov.className = 'alov'; document.body.appendChild(ov); ov.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; if (k === 'ok') return disarm(); pin = k === '⌫' ? pin.slice(0, -1) : (pin + k).slice(0, 8); ov.querySelector('.alpin').textContent = '•'.repeat(pin.length); }); }
    ov.className = 'alov ' + a.status;
    ov.innerHTML = '<div class="albox"><span class="alico">' + ico(a.status === 'arming' ? 'shieldCheck' : 'alert') + '</span><h2>' + title + '</h2>' + (left ? '<div class="alcount">' + left + ' s</div>' : '') + (a.why ? '<p>' + esc(a.why) + '</p>' : '') +
      '<div class="alpin">' + '•'.repeat(pin.length) + '</div><div class="alkeys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, 'ok'].map(k => '<button data-k="' + k + '">' + (k === 'ok' ? ico('check') : k) + '</button>').join('') + '</div><small>' + (a.status === 'arming' ? 'Code pour annuler' : 'Code d’un membre de la famille ou code de l’alarme') + '</small></div>';
  }
  async function disarm() {
    const u = B.user(); try { await B.Server.post('/api/engine/alarm', { mode: 'disarmed', pin, user: u && u.id, by: u && u.name }); pin = ''; if (ov) { ov.remove(); ov = null; } B.toast('Alarme désactivée', 'shieldCheck'); }
    catch (e) { pin = ''; if (ov) { ov.querySelector('.alpin').textContent = ''; ov.querySelector('.albox').classList.add('shake'); setTimeout(() => ov && ov.querySelector('.albox').classList.remove('shake'), 450); } }
  }
  const hasAlarm0 = B.hasAlarm;
  B.hasAlarm = () => !!(BR.cfg && BR.cfg.alarm && BR.cfg.alarm.on) || hasAlarm0();

  /* ---------- règles « Si… alors… » ---------- */
  const PROPS = k => ['temp', 'hum', 'co2', 'meter'].includes(k) ? [['val', 'valeur']] : k === 'cover' || k === 'awning' || k === 'garage' ? [['pos', 'ouverture (%)'], ['open', 'ouvert']] : k === 'lock' ? [['locked', 'verrouillée']] : k === 'clim' ? [['on', 'allumée'], ['cur', 'température']] : [['on', /door|motion|leak/.test(k) ? (k === 'door' ? 'ouvert' : k === 'motion' ? 'mouvement' : 'fuite') : 'allumé']];
  const TRIGS = { time: 'À une heure', sun: 'Lever / coucher du soleil', device: 'Un appareil change', presence: 'Présence de la famille', away: 'Mode absent', doorbell: 'On sonne', tempo: 'Couleur Tempo de demain', vigil: 'Vigilance Météo-France', alarm: 'Alarme', detect: 'Caméra : détection (Frigate)', list: 'Ajout à une liste' };
  const CONDS = { away: 'Mode absent', night: 'Nuit / jour', between: 'Entre deux heures', days: 'Certains jours', device: 'État d’un appareil', someone: 'Quelqu’un à la maison', alarm: 'État de l’alarme', tempo: 'Couleur Tempo du jour', sim: 'Simulation de présence' };
  const ACTS = { device: 'Commander un appareil', routine: 'Lancer une routine', notify: 'Envoyer une notification', say: 'Annonce sur les tablettes', away: 'Mode absent', alarm: 'Alarme', delay: 'Attendre', scene: 'Lancer une scène', heat: 'Chauffage', list: 'Ajouter à une liste', board: 'Message sur les tablettes', water: 'Arroser (selon la météo)' };
  const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const dname = id => { const d = DATA.DEVICES[id]; return d ? (d.room ? d.room + ' · ' : '') + d.name : '?'; };
  const OPS = { '==': '=', '>': '>', '<': '<', changes: 'change' };
  const fmtV = (p, v) => v === true || v === 'true' ? 'oui' : v === false || v === 'false' ? 'non' : v + (p === 'pos' ? ' %' : '');
  function says(x, kind) {
    switch (x.type) {
      case 'time': return 'à ' + x.at + (x.days && x.days.length && x.days.length < 7 ? ' (' + x.days.map(d => DAYS[d]).join(' ') + ')' : '');
      case 'sun': return (x.ev === 'sunrise' ? 'au lever' : 'au coucher') + ' du soleil' + (+x.off ? ' (' + (x.off > 0 ? '+' : '') + x.off + ' min)' : '');
      case 'device': { const k = (DATA.DEVICES[x.dev] && B.kindOf(DATA.DEVICES[x.dev])) || '', bool = ['on', 'open', 'locked'].includes(x.prop) && x.op !== 'changes' && x.op !== '>' && x.op !== '<', yes = (x.value === true || x.value === 'true') !== (x.op === '!=');
        if (bool) return '« ' + dname(x.dev) + ' » ' + (kind === 'if' ? BOOL_IS : BOOL_EV)(k, x.prop, yes) + (x.for ? ' depuis ' + x.for + ' min' : '');
        return '« ' + dname(x.dev) + ' » ' + (PROPS(k).find(p => p[0] === x.prop) || ['', x.prop])[1] + ' ' + (x.op === 'changes' ? 'change' : OPS[x.op] + ' ' + fmtV(x.prop, x.value)) + (x.for ? ' depuis ' + x.for + ' min' : ''); }
      case 'presence': return { arrive: (uName(x.user) || 'quelqu’un') + ' arrive', leave: (uName(x.user) || 'quelqu’un') + ' part', all_away: 'tout le monde est parti', first_home: 'le premier rentre' }[x.ev];
      case 'away': return 'le mode absent ' + (x.on ? 's’active' : 'se coupe');
      case 'doorbell': return 'on sonne';
      case 'vigil': return 'vigilance ' + ({ 2: 'jaune', 3: 'orange', 4: 'rouge' })[x.level || 3] + ' ou plus';
      case 'alarm': return kind === 'if' ? 'l’alarme est ' + ({ armed: 'activée', disarmed: 'désactivée', triggered: 'déclenchée' })[x.is] : 'l’alarme ' + ({ triggered: 'se déclenche', armed: 's’active', disarmed: 'se coupe' })[x.status];
      case 'night': return x.is === false ? 'il fait jour' : 'il fait nuit';
      case 'between': return 'entre ' + x.from + ' et ' + x.to;
      case 'days': return 'le ' + (x.days || []).map(d => DAYS[d]).join(' ');
      case 'someone': return x.is === false ? 'personne à la maison' : 'quelqu’un à la maison';
      case 'routine': return 'lancer « ' + ((S.routines.find(r => r.id === x.id) || {}).name || '?') + ' »';
      case 'notify': return 'notifier ' + ({ all: 'tout le monde', admins: 'les admins' }[x.who || 'all'] || 'un membre') + ' : « ' + (x.message || x.title || '') + ' »';
      case 'say': return 'annoncer « ' + (x.text || '') + ' »';
      case 'delay': return 'attendre ' + (x.sec >= 60 ? Math.round(x.sec / 60) + ' min' : x.sec + ' s');
      case 'detect': return 'la caméra ' + (x.cam ? '« ' + x.cam.replace(/_/g, ' ') + ' » ' : '') + 'voit ' + ({ person: 'une personne', car: 'une voiture', dog: 'un chien', cat: 'un chat', package: 'un colis' }[x.label] || 'quelque chose');
      case 'list': return kind === 'then' ? 'ajouter « ' + (x.text || '') + ' » à la liste ' + (x.list === 'taches' ? 'des tâches' : 'de courses') : 'on ajoute quelque chose à la liste ' + (x.list === 'taches' ? 'des tâches' : x.list === 'courses' ? 'de courses' : '');
      case 'scene': return 'scène « ' + ((((B.P || {}).cfg || {}).scenes || []).find(s => s.id === x.id) || {}).name + ' »';
      case 'heat': return 'chauffage « ' + ((((B.P || {}).cfg || {}).heat || { zones: [] }).zones.find(z => z.id === x.zone) || {}).name + ' » : ' + ({ auto: 'automatique', comfort: 'confort', eco: 'éco', frost: 'hors-gel', off: 'arrêt', boost: 'boost 1 h' }[x.mode || 'auto']);
      case 'board': return 'afficher « ' + (x.text || '') + ' » sur les tablettes';
      case 'water': return 'arroser si la météo le permet';
      case 'tempo': return kind === 'if' ? 'aujourd’hui est un jour ' + (x.color || 'rouge') : 'demain est un jour ' + x.color;
      case 'sim': return x.is === false ? 'la simulation de présence est arrêtée' : 'la simulation de présence tourne';
    }
    if (x.type === 'away' && kind === 'then') return (x.on ? 'activer' : 'couper') + ' le mode absent';
    return x.type;
  }
  // « s'allume », « s'ouvre », « détecte un mouvement » / « est allumé », « est ouvert »…
  const BOOL_EV = (k, prop, yes) => prop === 'locked' ? (yes ? 'se verrouille' : 'se déverrouille') : k === 'motion' ? (yes ? 'détecte un mouvement' : 'ne détecte plus rien') : k === 'leak' ? (yes ? 'détecte une fuite' : 'est sec') : k === 'door' || prop === 'open' ? (yes ? 's’ouvre' : 'se ferme') : (yes ? 's’allume' : 's’éteint');
  const BOOL_IS = (k, prop, yes) => prop === 'locked' ? (yes ? 'est verrouillé' : 'est déverrouillé') : k === 'motion' ? (yes ? 'détecte un mouvement' : 'ne détecte rien') : k === 'leak' ? (yes ? 'détecte une fuite' : 'est sec') : k === 'door' || prop === 'open' ? (yes ? 'est ouvert' : 'est fermé') : (yes ? 'est allumé' : 'est éteint');
  const uName = id => (S.users.find(u => u.id === id) || {}).name;
  const actSay = a => a.type === 'device' ? patchTxt(a.patch) + ' « ' + dname(a.dev) + ' »' : a.type === 'away' ? (a.on ? 'activer' : 'couper') + ' le mode absent' : a.type === 'alarm' ? ({ armed_away: 'activer l’alarme (absence)', armed_night: 'activer l’alarme (nuit)', disarmed: 'désactiver l’alarme' })[a.mode] : says(a, 'then');
  const patchTxt = p => p ? ('on' in p ? (p.on ? 'allumer' : 'éteindre') : 'pos' in p ? (p.pos >= 100 ? 'ouvrir' : p.pos <= 0 ? 'fermer' : 'ouvrir à ' + p.pos + ' %') : 'locked' in p ? (p.locked ? 'verrouiller' : 'déverrouiller') : 'bri' in p ? 'régler à ' + p.bri + ' %' : 'temp' in p ? 'régler à ' + p.temp + ' °C' : 'status' in p ? 'lancer' : 'commander') : '';
  const sentence = r => 'Quand ' + (r.when || []).map(t => says(t, 'when')).join(' ou ') + ((r.if || []).length ? ', si ' + r.if.map(c => says(c, 'if')).join(' et ') : '') + ' → ' + (r.then || []).map(actSay).join(', puis ');
  B.ruleSentence = sentence; B.ruleSays = says; B.ruleActSay = a => actSay(a);

  RENDER.blist = () => {
    if (!srv() || BR.ok === false) return RENDER.alist0 ? RENDER.alist0() : '';
    const rules = (BR.cfg && BR.cfg.rules) || [], fired = (BR.status && BR.status.fired) || {};
    return '<div class="list scroll" style="flex:1">' + (rules.length ? rules.map(r => '<div class="li auto"><span class="ic">' + ico({ time: 'calendar', sun: 'sun2', device: 'plug', presence: 'family', away: 'walk', doorbell: 'bellFill', tempo: 'boltPlain', vigil: 'alert', alarm: 'shieldCheck', detect: 'cctv', list: 'check' }[((r.when || [])[0] || {}).type] || 'sparkle') + '</span>' +
      '<div><b>' + esc(r.name || 'Règle') + '</b><small>' + esc(sentence(r)) + (fired[r.id] ? ' · dernière fois ' + new Date(fired[r.id]).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '</small></div>' +
      '<div class="row" style="gap:6px"><button class="sw sm' + (r.on !== false ? ' on' : '') + '" data-act="ruleToggle" data-arg="' + r.id + '" role="switch" aria-label="Activer"></button><button class="sq" data-act="ruleEdit" data-arg="' + r.id + '" aria-label="Modifier">' + ico('edit') + '</button></div></div>').join('') : '<p class="muted" style="font-size:13px">Aucune règle pour l’instant.</p>') + '</div>' +
      '<div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn pri" data-act="ruleEdit">' + ico('plus') + 'Nouvelle règle</button>' + ((S.autos || []).length ? '<button class="btn" data-act="ruleImport">' + ico('download') + 'Reprendre les automatismes de cet écran</button>' : '') + '<button class="btn" data-act="presenceCfg">' + ico('family') + 'Présence</button></div>' +
      '<p class="muted" style="font-size:12px;margin:10px 0 0;line-height:1.45">' + ico('server') + ' Exécutées par le serveur du NAS, 24 h/24, même si aucun écran n’est allumé. Seuls les appareils reliés en direct (Marques) peuvent être commandés.</p>';
  };

  let R = null;   // règle en cours d'édition
  const blank = () => ({ id: 'r' + Date.now().toString(36), name: '', on: true, when: [{ type: 'time', at: '19:00', days: [] }], if: [], then: [{ type: 'notify', who: 'all', title: '', message: '' }] });
  const devOpts = (cur, filt) => '<option value="">— appareil —</option>' + hubDevs().filter(filt || (() => true)).map(d => '<option value="' + d.id + '"' + (d.id === cur ? ' selected' : '') + '>' + esc((d.room ? d.room + ' · ' : '') + d.name) + '</option>').join('');
  const sel = (path, cur, opts) => '<select data-change="rlSet" data-arg="' + path + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const inp = (path, v, type, ph) => '<input type="' + (type || 'text') + '" data-input="rlIn" data-arg="' + path + '" value="' + esc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
  const daysPick = (path, days) => '<span class="rldays">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="pinc' + ((days || []).includes(d) ? ' on' : '') + '" data-act="rlDay" data-arg="' + path + '|' + d + '">' + DAYS[d] + '</button>').join('') + '</span>';
  function fields(sec, i, x) {
    const p = sec + '.' + i + '.', k = x.dev && DATA.DEVICES[x.dev] ? B.kindOf(DATA.DEVICES[x.dev]) : '';
    switch (x.type) {
      case 'time': return inp(p + 'at', x.at, 'time') + daysPick(p + 'days', x.days);
      case 'sun': return sel(p + 'ev', x.ev, [['sunset', 'coucher'], ['sunrise', 'lever']]) + inp(p + 'off', x.off || 0, 'number', 'décalage (min)');
      case 'device': return '<select data-change="rlSet" data-arg="' + p + 'dev">' + devOpts(x.dev, sec === 'then' ? d => !['temp', 'hum', 'co2', 'meter', 'door', 'motion', 'leak'].includes(d.k) : null) + '</select>' +
        (sec === 'then' ? sel(p + 'act', x.act || 'on', ACTOPT(k)) + (['bri', 'temp', 'pos'].includes(x.act) ? inp(p + 'num', x.num, 'number', x.act === 'temp' ? '°C' : '%') : '') :
          sel(p + 'prop', x.prop || PROPS(k)[0][0], PROPS(k)) + sel(p + 'op', x.op || '==', sec === 'when' ? [['==', '='], ['>', '>'], ['<', '<'], ['changes', 'change']] : [['==', '='], ['>', '>'], ['<', '<'], ['!=', '≠']]) + (x.op === 'changes' ? '' : ['on', 'open', 'locked'].includes(x.prop || PROPS(k)[0][0]) ? sel(p + 'value', String(x.value == null ? true : x.value), [['true', 'oui'], ['false', 'non']]) : inp(p + 'value', x.value, 'number')) + (sec === 'when' ? inp(p + 'for', x.for || '', 'number', 'depuis (min)') : ''));
      case 'presence': return sel(p + 'ev', x.ev || 'all_away', [['all_away', 'tout le monde est parti'], ['first_home', 'le premier rentre'], ['arrive', 'une personne arrive'], ['leave', 'une personne part']]) + (/arrive|leave/.test(x.ev) ? sel(p + 'user', x.user || '', [['', 'n’importe qui']].concat(S.users.map(u => [u.id, u.name]))) : '');
      case 'away': return sel(p + 'on', String(x.on === undefined ? true : x.on), [['true', sec === 'then' ? 'activer' : 's’active'], ['false', sec === 'then' ? 'couper' : 'se coupe']]);
      case 'tempo': return sel(p + 'color', x.color || 'rouge', [['rouge', 'rouge'], ['blanc', 'blanc'], ['bleu', 'bleu']]);
      case 'vigil': return sel(p + 'level', x.level || 3, [[2, 'jaune'], [3, 'orange'], [4, 'rouge']]);
      case 'alarm': return sec === 'then' ? sel(p + 'mode', x.mode || 'armed_away', [['armed_away', 'activer (absence)'], ['armed_night', 'activer (nuit)'], ['disarmed', 'désactiver']]) : sec === 'if' ? sel(p + 'is', x.is || 'armed', [['armed', 'activée'], ['disarmed', 'désactivée'], ['triggered', 'déclenchée']]) : sel(p + 'status', x.status || 'triggered', [['triggered', 'se déclenche'], ['armed', 's’active'], ['disarmed', 'se coupe']]);
      case 'night': return sel(p + 'is', String(x.is !== false), [['true', 'il fait nuit'], ['false', 'il fait jour']]);
      case 'between': return inp(p + 'from', x.from || '22:00', 'time') + '<span class="muted">et</span>' + inp(p + 'to', x.to || '06:00', 'time');
      case 'days': return daysPick(p + 'days', x.days);
      case 'someone': return sel(p + 'is', String(x.is !== false), [['true', 'quelqu’un est là'], ['false', 'personne']]);
      case 'routine': return sel(p + 'id', x.id || '', S.routines.map(r => [r.id, r.name]));
      case 'notify': return sel(p + 'who', x.who || 'all', [['all', 'tout le monde'], ['admins', 'les admins']].concat(S.users.map(u => [u.id, u.name]))) + inp(p + 'title', x.title, 'text', 'Titre') + inp(p + 'message', x.message, 'text', 'Message') + '<label class="rlck"><input type="checkbox" data-change="rlCk" data-arg="' + p + 'critical"' + (x.critical ? ' checked' : '') + '>critique</label><label class="rlck"><input type="checkbox" data-change="rlCk" data-arg="' + p + 'photo"' + (x.photo ? ' checked' : '') + '>photo caméra</label>';
      case 'say': return inp(p + 'text', x.text, 'text', 'On sonne à la porte');
      case 'delay': return inp(p + 'sec', x.sec || 60, 'number', 'secondes');
      case 'detect': return inp(p + 'cam', x.cam || '', 'text', 'caméra (vide = toutes)') + sel(p + 'label', x.label || 'person', [['person', 'personne'], ['car', 'voiture'], ['dog', 'chien'], ['cat', 'chat'], ['package', 'colis']]);
      case 'list': return sel(p + 'list', x.list || 'courses', [['courses', 'courses'], ['taches', 'tâches']]) + (sec === 'then' ? inp(p + 'text', x.text, 'text', 'Piles AA') : '');
      case 'scene': return sel(p + 'id', x.id || '', [['', '— scène —']].concat((((B.P || {}).cfg || {}).scenes || []).map(s => [s.id, s.name])));
      case 'heat': return sel(p + 'zone', x.zone || '', [['', '— zone —']].concat(((((B.P || {}).cfg || {}).heat || {}).zones || []).map(z => [z.id, z.name]))) + sel(p + 'mode', x.mode || 'eco', [['auto', 'automatique'], ['comfort', 'confort'], ['eco', 'éco'], ['frost', 'hors-gel'], ['off', 'arrêt'], ['boost', 'boost 1 h']]);
      case 'board': return inp(p + 'text', x.text, 'text', 'Pensez à fermer le garage') + inp(p + 'hours', x.hours || 6, 'number', 'heures');
      case 'water': return '<span class="muted">selon les réglages de l’arrosage</span>';
      case 'sim': return sel(p + 'is', String(x.is !== false), [['true', 'tourne'], ['false', 'est arrêtée']]);
    }
    return '';
  }
  const ACTOPT = k => k === 'cover' || k === 'awning' || k === 'garage' ? [['open', 'ouvrir'], ['close', 'fermer'], ['pos', 'ouvrir à…'], ['stop', 'arrêter']] : k === 'lock' ? [['lock', 'verrouiller'], ['unlock', 'déverrouiller']] : k === 'clim' || k === 'heater' ? [['on', 'allumer'], ['off', 'éteindre'], ['temp', 'régler à…']] : k === 'vacuum' || k === 'mower' ? [['start', 'lancer'], ['dock', 'retour à la base']] : k === 'light' || k === 'rgb' ? [['on', 'allumer'], ['off', 'éteindre'], ['bri', 'luminosité…']] : [['on', 'allumer'], ['off', 'éteindre']];
  const toPatch = a => ({ on: { on: true }, off: { on: false }, open: { pos: 100 }, close: { pos: 0 }, stop: { moving: 'stop' }, lock: { locked: true }, unlock: { locked: false }, start: { status: 'cleaning' }, dock: { status: 'docked' }, bri: { on: true, bri: +a.num || 50 }, temp: { on: true, temp: +a.num || 21 }, pos: { pos: +a.num || 50 } })[a.act || 'on'];
  function editor() {
    const row = (sec, list, NAMES) => list.map((x, i) => '<div class="rlrow"><select data-change="rlType" data-arg="' + sec + '.' + i + '">' + Object.keys(NAMES).map(k => '<option value="' + k + '"' + (k === x.type ? ' selected' : '') + '>' + NAMES[k] + '</option>').join('') + '</select><span class="rlf">' + fields(sec, i, x) + '</span><button type="button" class="sq" data-act="rlDel" data-arg="' + sec + '.' + i + '" aria-label="Retirer">' + ico('x') + '</button></div>').join('');
    return '<h2>' + ico('sparkle') + (BR.cfg && BR.cfg.rules.some(r => r.id === R.id) ? 'Modifier la règle' : 'Nouvelle règle') + '</h2>' +
      '<label class="field">Nom<input data-input="rlIn" data-arg="name" value="' + esc(R.name) + '" placeholder="Porte du garage restée ouverte"></label>' +
      '<h4 class="rlh">' + ico('bolt') + 'Quand… <small>(l’un ou l’autre)</small></h4>' + row('when', R.when, TRIGS) + '<button type="button" class="btn sm" data-act="rlAdd" data-arg="when">' + ico('plus') + 'Déclencheur</button>' +
      '<h4 class="rlh">' + ico('check') + 'Seulement si… <small>(toutes vraies, facultatif)</small></h4>' + row('if', R.if, CONDS) + '<button type="button" class="btn sm" data-act="rlAdd" data-arg="if">' + ico('plus') + 'Condition</button>' +
      '<h4 class="rlh">' + ico('play') + 'Alors…</h4>' + row('then', R.then, ACTS) + '<button type="button" class="btn sm" data-act="rlAdd" data-arg="then">' + ico('plus') + 'Action</button>' +
      '<p class="rlsum">' + esc(sentence(norm(R))) + '</p>' +
      '<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:10px"><span class="row" style="gap:8px">' + (BR.cfg && BR.cfg.rules.some(r => r.id === R.id) ? '<button type="button" class="btn dan" data-act="rlRemove">' + ico('trash') + 'Supprimer</button><button type="button" class="btn" data-act="rlTest">' + ico('play') + 'Tester</button>' : '') + '</span><span class="row" style="gap:8px"><button type="button" class="btn" data-act="closeModal">Annuler</button><button type="button" class="btn pri" data-act="rlSave">' + ico('check') + 'Enregistrer</button></span></div>';
  }
  // règle prête pour le serveur : ordres d'appareils traduits, valeurs typées
  function norm(r) {
    const o = JSON.parse(JSON.stringify(r)), typ = v => v === 'true' ? true : v === 'false' ? false : v !== '' && v != null && !isNaN(v) ? +v : v;
    ['when', 'if'].forEach(s => o[s].forEach(x => { if (x.type === 'device') { const k = DATA.DEVICES[x.dev] ? B.kindOf(DATA.DEVICES[x.dev]) : ''; x.prop = x.prop || PROPS(k)[0][0]; x.op = x.op || '=='; if (x.op !== 'changes') x.value = typ(x.value == null ? true : x.value); if (x.for) x.for = +x.for; else delete x.for; } ['on', 'is'].forEach(k => { if (k in x) x[k] = typ(x[k]); }); if ('level' in x) x.level = +x.level; if ('off' in x) x.off = +x.off || 0; }));
    const DEF = { tempo: { color: 'rouge' }, detect: { label: 'person' }, list: { list: 'courses' }, heat: { mode: 'eco' }, board: { hours: 6 } };
    ['when', 'if', 'then'].forEach(sx => o[sx].forEach(x => { Object.keys(DEF[x.type] || {}).forEach(k => { if (x[k] == null || x[k] === '') x[k] = DEF[x.type][k]; }); }));
    o.then.forEach(a => { if (a.type === 'device') { a.patch = toPatch(a); } if (a.type === 'away') a.on = typ(a.on === undefined ? true : a.on); if (a.type === 'delay') a.sec = +a.sec || 60; });
    return o;
  }
  const redraw = () => { const m = document.querySelector('.rlmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + editor(); m.scrollTop = sc; } };
  const at = path => { const [s, i, k] = path.split('.'); return k ? [R[s][+i], k] : [R, s]; };
  B.act('ruleEdit', el => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); const r = el.dataset && el.dataset.arg && BR.cfg.rules.find(x => x.id === el.dataset.arg); R = r ? JSON.parse(JSON.stringify(r)) : blank(); (R.then || []).forEach(a => { if (a.type === 'device' && !a.act && a.patch) { const p = a.patch; a.act = 'on' in p && !('bri' in p) && !('temp' in p) ? (p.on ? 'on' : 'off') : 'bri' in p ? 'bri' : 'temp' in p ? 'temp' : 'pos' in p ? (p.pos >= 100 ? 'open' : p.pos <= 0 ? 'close' : 'pos') : 'locked' in p ? (p.locked ? 'lock' : 'unlock') : 'on'; a.num = p.bri || p.temp || p.pos; } }); B.modal(editor(), 'wide rlmodal'); });
  B.act('rlIn', el => { const [o, k] = at(el.dataset.arg); o[k] = el.value; const s = document.querySelector('.rlsum'); if (s) s.textContent = sentence(norm(R)); });
  B.act('rlSet', el => { const [o, k] = at(el.dataset.arg); o[k] = el.value; if (k === 'dev') { delete o.prop; delete o.value; delete o.act; } redraw(); });
  B.act('rlCk', el => { const [o, k] = at(el.dataset.arg); o[k] = el.checked; });
  B.act('rlType', el => { const [s, i] = el.dataset.arg.split('.'); R[s][+i] = { type: el.value }; redraw(); });
  B.act('rlDay', el => { const [path, d] = el.dataset.arg.split('|'), [o, k] = at(path); o[k] = o[k] || []; const n = +d, j = o[k].indexOf(n); j >= 0 ? o[k].splice(j, 1) : o[k].push(n); redraw(); });
  B.act('rlAdd', el => { const s = el.dataset.arg; R[s].push(s === 'when' ? { type: 'device', op: '==' } : s === 'if' ? { type: 'away', is: true } : { type: 'device', act: 'on' }); redraw(); });
  B.act('rlDel', el => { const [s, i] = el.dataset.arg.split('.'); R[s].splice(+i, 1); redraw(); });
  B.act('rlSave', async () => {
    const r = norm(R); if (!r.when.length || !r.then.length) return B.toast('Il faut au moins un déclencheur et une action', 'info');
    if (r.when.concat(r.if).some(x => x.type === 'device' && !x.dev) || r.then.some(x => x.type === 'device' && !x.dev)) return B.toast('Choisissez l’appareil', 'info');
    r.name = r.name || sentence(r).slice(0, 60);
    const list = (BR.cfg.rules || []).filter(x => x.id !== r.id).concat([r]);
    if (await save({ rules: list })) { B.closeModal(); B.emit('autos'); B.toast('Règle enregistrée sur le NAS', 'check'); }
  });
  B.act('rlRemove', async () => { if (!confirm('Supprimer cette règle ?')) return; if (await save({ rules: BR.cfg.rules.filter(x => x.id !== R.id) })) { B.closeModal(); B.emit('autos'); } });
  B.act('rlTest', async () => { try { await B.Server.post('/api/engine/rule', { id: R.id }); B.toast('Règle lancée (sans ses conditions)', 'play'); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('ruleToggle', async el => { const list = BR.cfg.rules.map(r => r.id === el.dataset.arg ? Object.assign({}, r, { on: r.on === false }) : r); await save({ rules: list }); B.emit('autos'); });
  // les anciens automatismes de l'écran deviennent des règles du NAS
  B.act('ruleImport', async () => {
    const conv = [];
    (S.autos || []).forEach(a => {
      const t = a.trig, c = a.act, when = t.type === 'time' ? [{ type: 'time', at: t.v, days: t.days || [] }] : /sun/.test(t.type) ? [{ type: 'sun', ev: t.type, off: +t.v || 0 }] : t.type === 'doorbell' ? [{ type: 'doorbell' }] : null;
      let then = c.type === 'routine' ? [{ type: 'routine', id: c.v }] : c.type === 'notify' ? [{ type: 'notify', who: 'all', title: 'Bêta home', message: c.v }] : c.type === 'device' && hubMap()[c.v] ? [{ type: 'device', dev: c.v, patch: toPatch({ act: c.a === 'status' ? 'start' : c.a }) }] : c.type === 'light' && hubMap()[c.v] ? [{ type: 'device', dev: c.v, patch: { on: true } }] : c.type === 'ext' ? hubDevs().filter(d => /^ext/.test(B.floorOf(d.id)) && (d.k === 'light' || d.k === 'rgb')).map(d => ({ type: 'device', dev: d.id, patch: { on: c.v === 'on' } })) : null;
      if (when && then && then.length) conv.push({ id: 'imp' + a.id, name: (a.note || 'Repris de l’écran'), on: a.on, when, if: t.night ? [{ type: 'night', is: true }] : [], then });
    });
    if (!conv.length) return B.toast('Aucun automatisme reprenable (il faut des appareils reliés en direct)', 'info');
    if (await save({ rules: (BR.cfg.rules || []).filter(r => !conv.some(c => c.id === r.id)).concat(conv) })) { B.toast(conv.length + ' automatisme(s) repris par le NAS', 'check'); B.emit('autos'); }
  });
  // la page Routines montre les règles du NAS à la place des automatismes de l'écran
  if (RENDER.alist && !RENDER.alist0) { RENDER.alist0 = RENDER.alist; RENDER.alist = () => RENDER.blist(); }

  /* ---------- présence et mode absent automatique ---------- */
  function presenceBody() {
    const c = (BR.cfg && BR.cfg.presence) || {}, st = (BR.status && BR.status.presence) || {}, netDevs = hubDevs().filter(d => d.k === 'motion' || /^p:/.test(hubMap()[d.id].id));
    return '<h2>' + ico('family') + 'Présence et mode absent</h2><p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">Pour chaque personne : OwnTracks (position du téléphone) et/ou un appareil « présence » de la box (téléphone connecté au Wi-Fi). Le NAS sait alors qui est là, même tablettes éteintes.</p>' +
      '<div class="list">' + S.users.map(u => { const p = u.presence || {}; return '<div class="li prow"><img src="' + esc(u.avatar) + '" alt=""><div><b>' + esc(u.name) + ' <small class="tag2 ' + (st[u.id] === true ? '' : st[u.id] === false ? 'off' : 'wait') + '">' + (st[u.id] === true ? 'à la maison' : st[u.id] === false ? 'absent' : 'inconnu') + '</small></b>' +
        '<label class="rlck"><input type="checkbox" data-change="prOt" data-arg="' + u.id + '"' + (p.ot ? ' checked' : '') + '>OwnTracks</label>' + netDevs.map(d => '<label class="rlck"><input type="checkbox" data-change="prNet" data-arg="' + u.id + '|' + d.id + '"' + ((p.net || []).includes(d.id) ? ' checked' : '') + '>' + esc(d.name) + '</label>').join('') +
        (netDevs.length ? '' : '<small class="muted">Ajoutez la Freebox / Livebox / Bbox dans Marques pour suivre les téléphones par le Wi-Fi.</small>') + '</div></div>'; }).join('') + '</div>' +
      '<div class="tbbox" style="margin-top:12px"><label class="row tbsw"><button type="button" class="sw sm' + (c.auto ? ' on' : '') + '" data-act="prAuto"></button><span><b>Mode absent automatique</b> : quand tout le monde est parti, puis retour au premier qui rentre</span></label>' +
      '<div class="grid2"><label class="field">Délai avant « parti » (min)<input type="number" min="1" max="60" value="' + (c.delay || 10) + '" data-change="prNum" data-arg="delay"></label>' +
      '<label class="field">Routine au départ<select data-change="prSel" data-arg="away"><option value="">—</option>' + S.routines.map(r => '<option value="' + r.id + '"' + (c.away === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label>' +
      '<label class="field">Routine au retour<select data-change="prSel" data-arg="home"><option value="">—</option>' + S.routines.map(r => '<option value="' + r.id + '"' + (c.home === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label>' +
      '<label class="row tbsw" style="align-self:end"><button type="button" class="sw sm' + (c.alarm ? ' on' : '') + '" data-act="prAlarm"></button><span>Activer / couper l’alarme avec</span></label></div>' +
      '<p class="muted" style="font-size:12px;margin:0">Le Wi-Fi des téléphones se met parfois en veille : le délai évite les faux départs.</p></div>';
  }
  const prRedraw = () => { const m = document.querySelector('.prmodal'); if (m) m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + presenceBody(); };
  B.act('presenceCfg', async () => { if (!srv()) return B.toast('Serveur Bêta nécessaire', 'server'); await load(); B.modal(presenceBody(), 'wide prmodal'); });
  B.act('prOt', el => { const u = S.users.find(x => x.id === el.dataset.arg); u.presence = Object.assign({}, u.presence, { ot: el.checked }); B.save(); sync(true); });
  B.act('prNet', el => { const [uid, did] = el.dataset.arg.split('|'), u = S.users.find(x => x.id === uid), p = u.presence = Object.assign({ net: [] }, u.presence); p.net = (p.net || []).filter(x => x !== did).concat(el.checked ? [did] : []); B.save(); sync(true); });
  B.act('prAuto', async () => { await save({ presence: { auto: !(BR.cfg.presence || {}).auto } }); prRedraw(); });
  B.act('prAlarm', async () => { await save({ presence: { alarm: !(BR.cfg.presence || {}).alarm } }); prRedraw(); });
  B.act('prNum', el => save({ presence: { [el.dataset.arg]: Math.max(1, +el.value || 10) } }));
  B.act('prSel', el => save({ presence: { [el.dataset.arg]: el.value } }));

  /* ---------- page Sécurité : alarme maison ---------- */
  const ST = { disarmed: ['Désactivée', 'p'], arming: ['Activation…', 'y'], armed: ['Activée', 'g'], entry: ['Entrée détectée', 'y'], triggered: ['DÉCLENCHÉE', 'p'] };
  RENDER.alarmCard = () => {
    const a = BR.alarm || (BR.status && BR.status.alarm) || { status: 'disarmed' }, c = (BR.cfg && BR.cfg.alarm) || {}, st = ST[a.status] || ST.disarmed;
    if (!srv() || BR.ok === false) return '<p class="warn">L’alarme maison tourne sur le serveur Bêta du NAS : reliez-le d’abord (Connexions).</p>';
    if (!c.on) return '<div class="secempty">' + ico('shieldCheck') + '<b>Alarme maison sans abonnement</b><p class="muted">Vos détecteurs d’ouverture et de mouvement (Zigbee, Aqara, Shelly…), une sirène ou une prise, les tablettes qui parlent et les notifications critiques : c’est tout ce qu’il faut.</p><button class="btn pri" data-act="alCfg">' + ico('gear') + 'Configurer l’alarme</button></div>';
    return '<div class="secst ' + st[1] + '"><span class="secico">' + ico(a.status === 'disarmed' ? 'shieldCheck' : a.status === 'triggered' ? 'alert' : 'lock') + '</span><div><b>' + st[0] + (a.mode ? ' · ' + (a.mode === 'night' ? 'nuit' : 'absence') : '') + '</b><small>' + (a.by ? 'par ' + esc(a.by) : '') + (a.why ? ' · ' + esc(a.why) : '') + '</small></div></div>' +
      '<div class="secbtns"><button class="btn big' + (a.mode === 'away' && a.status !== 'disarmed' ? ' on' : '') + '" data-act="alArm" data-arg="armed_away">' + ico('walk') + 'Absence<small>' + c.away.length + ' détecteur(s)</small></button><button class="btn big' + (a.mode === 'night' && a.status !== 'disarmed' ? ' on' : '') + '" data-act="alArm" data-arg="armed_night">' + ico('moon') + 'Nuit<small>' + c.night.length + ' détecteur(s)</small></button><button class="btn big" data-act="alOff">' + ico('unlock') + 'Désactiver<small>code demandé</small></button></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="alCfg">' + ico('gear') + 'Réglages de l’alarme</button><button class="btn sm" data-act="presenceCfg">' + ico('family') + 'Présence et absent auto</button></div>';
  };
  RENDER.secLog = () => '<div class="list scroll" style="flex:1">' + (((BR.status && BR.status.log) || []).map(l => '<div class="li" style="grid-template-columns:30px 1fr auto"><span class="ic">' + ico(l.icon || 'sparkle') + '</span><span>' + esc(l.txt) + '</span><small class="muted">' + new Date(l.t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '</small></div>').join('') || '<p class="muted">Rien pour l’instant.</p>') + '</div>';
  RENDER.whoHome = () => { const st = (BR.status && BR.status.presence) || {}; return '<div class="sechome">' + S.users.map(u => '<div class="' + (st[u.id] === true ? 'in' : st[u.id] === false ? 'out' : '') + '"><img src="' + esc(u.avatar) + '" alt=""><b>' + esc(u.name) + '</b><small>' + (st[u.id] === true ? 'à la maison' : st[u.id] === false ? 'absent' : 'non suivi') + '</small></div>').join('') + '</div>'; };
  B.route('securite', { title: 'Sécurité', bg: 'assets/bg/generic.jpg', render: () => B.side('securite') + B.header({ id: 'securite', title: 'Sécurité', sub: 'Alarme, présence et journal de la maison', icon: 'shieldCheck', info: { t: 'infobox', keys: ['brain'], items: () => {
    const a = BR.alarm || (BR.status && BR.status.alarm) || {}, p = (BR.status && BR.status.presence) || {};
    return [{ icon: 'shieldCheck', v: (ST[a.status] || ST.disarmed)[0], l: 'Alarme', cls: a.status === 'armed' ? 'g' : a.status === 'triggered' ? 'p' : '' }, { icon: 'family', v: Object.values(p).filter(Boolean).length + '/' + S.users.length, l: 'À la maison', cls: 'c' }, { icon: 'walk', v: S.away ? 'Oui' : 'Non', l: 'Mode absent' }, { icon: 'sparkle', v: ((BR.cfg && BR.cfg.rules) || []).filter(r => r.on !== false).length, l: 'Règles actives', go: 'routines' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 800, 640]) + '">' + B.whead('shieldCheck', 'Alarme maison') + T({ t: 'alarmCard', keys: ['brain'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([105, 650, 800, 1012]) + '">' + B.whead('family', 'Qui est à la maison') + T({ t: 'whoHome', keys: ['brain', 'users'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 235, 1522, 1012]) + '">' + B.whead('history', 'Journal du NAS') + T({ t: 'secLog', keys: ['brain'] }) + '</section>', after: () => load() });
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); const i = out.findIndex(n => n[0] === 'absence'); if (!out.some(n => n[0] === 'securite')) out.splice(i < 0 ? out.length : i + 1, 0, ['securite', 'Sécurité', 'shieldCheck', 'shieldCheck', 'noside']); return out; };
  B.act('alArm', async el => { try { const r = await B.Server.post('/api/engine/alarm', { mode: el.dataset.arg, by: B.user().name }); BR.alarm = r.alarm; B.emit('brain'); alarmOverlay(r.alarm); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('alOff', () => { alarmOverlay(Object.assign({}, BR.alarm || {}, { status: 'entry', until: 0, why: 'Désactiver l’alarme' })); });
  function alarmBody() {
    const c = BR.cfg.alarm, hd = hubDevs(), sens = hd.filter(d => ['door', 'motion', 'garage', 'cover'].includes(d.k)), sir = hd.filter(d => ['plug', 'light', 'rgb', 'power'].includes(d.k) || /sir[eè]ne/i.test(d.name));
    const pick = (k, list) => '<div class="alpick">' + (list.length ? list.map(d => '<label class="rlck"><input type="checkbox" data-change="alPick" data-arg="' + k + '|' + d.id + '"' + ((c[k] || []).includes(d.id) ? ' checked' : '') + '>' + esc((d.room ? d.room + ' · ' : '') + d.name) + '</label>').join('') : '<small class="muted">Aucun appareil relié en direct de ce type.</small>') + '</div>';
    return '<h2>' + ico('shieldCheck') + 'Alarme maison</h2>' +
      '<label class="row tbsw"><button type="button" class="sw sm' + (c.on ? ' on' : '') + '" data-act="alOn"></button><span><b>Alarme active</b> (exécutée par le NAS, 24 h/24)</span></label>' +
      '<h4 class="rlh">' + ico('walk') + 'Détecteurs en mode Absence</h4>' + pick('away', sens) + '<h4 class="rlh">' + ico('moon') + 'Détecteurs en mode Nuit <small>(portes et fenêtres, pas l’intérieur)</small></h4>' + pick('night', sens) +
      '<h4 class="rlh">' + ico('door') + 'Portes d’entrée <small>(laissent le temps de taper le code)</small></h4>' + pick('doors', sens.filter(d => d.k === 'door' || d.k === 'garage')) +
      '<h4 class="rlh">' + ico('bellFill') + 'Sirènes et lumières à déclencher</h4>' + pick('sirens', sir) +
      '<div class="grid2"><label class="field">Délai d’entrée (s)<input type="number" min="0" max="120" value="' + c.entry + '" data-change="alNum" data-arg="entry"></label><label class="field">Délai de sortie (s)<input type="number" min="0" max="300" value="' + c.exit + '" data-change="alNum" data-arg="exit"></label>' +
      '<label class="field">Code de l’alarme (en plus des codes PIN)<input type="password" inputmode="numeric" placeholder="' + (c.code ? 'déjà défini' : '4 à 8 chiffres') + '" data-change="alCode"></label>' +
      '<label class="row tbsw" style="align-self:end"><button type="button" class="sw sm' + (c.say ? ' on' : '') + '" data-act="alSay"></button><span>Annonces vocales sur les tablettes</span></label></div>' +
      '<p class="muted" style="font-size:12px;line-height:1.5">En cas d’intrusion : sirènes allumées, notification critique avec la photo de la caméra de la sonnette, annonce sur les tablettes. Le code PIN de chaque personne (Paramètres › Sécurité) désactive aussi l’alarme.</p>';
  }
  const alRedraw = () => { const m = document.querySelector('.almodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + alarmBody(); m.scrollTop = sc; } };
  const alSave = async patch => { await save({ alarm: Object.assign({}, patch) }); alRedraw(); };
  B.act('alCfg', async () => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); await load(); B.modal(alarmBody(), 'wide almodal'); });
  B.act('alOn', () => alSave({ on: !BR.cfg.alarm.on }));
  B.act('alSay', () => alSave({ say: !BR.cfg.alarm.say }));
  B.act('alNum', el => alSave({ [el.dataset.arg]: Math.max(0, +el.value || 0) }));
  B.act('alCode', el => { const v = el.value.replace(/\D/g, ''); if (v && (v.length < 4 || v.length > 8)) return B.toast('4 à 8 chiffres', 'info'); alSave({ code: v }); B.toast('Code de l’alarme enregistré sur le NAS', 'lock'); });
  B.act('alPick', el => { const [k, id] = el.dataset.arg.split('|'), l = (BR.cfg.alarm[k] || []).filter(x => x !== id).concat(el.checked ? [id] : []); alSave({ [k]: l }); });
})();
