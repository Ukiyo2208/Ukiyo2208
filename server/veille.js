// Serveur Bêta 7.20 — veille des marques : pour corriger vite quand une marque change.
// - panne : une marque qui marchait ne répond plus depuis X minutes → notification (et « elle refonctionne »)
// - réponse différente : la marque répond, mais ses appareils ont disparu ou des champs manquent (API modifiée)
// - nouvelles versions : dernières versions publiées (GitHub) des projets utilisés (Tasmota, Zigbee2MQTT, Frigate…)
// - signaux d'alerte : tickets ouverts cette semaine sur l'intégration Home Assistant de la même marque
//   (ceux qui utilisent la même API cloud s'en rendent compte en premier : connexion refusée, API changée…)
// - ticket GitHub (facultatif) dans votre dépôt, avec tout ce qu'il faut pour écrire le correctif
// Page « Veille des marques » (Réglages › Système). Notification « Marques » dans Paramètres › Notifs.
'use strict';
const fs = require('fs'), path = require('path');
const { request } = require('./hub/net');

// d'où viennent les nouvelles de chaque marque : gh = dépôt GitHub du projet, ha = intégration Home Assistant,
// cloud = API cloud non officielle (la plus fragile : on prévient pour chaque ticket suspect)
const SRC = {
  tasmota: { gh: 'arendst/Tasmota' }, esphome: { gh: 'esphome/esphome', ha: 'esphome' }, wled: { gh: 'wled/WLED', ha: 'wled' }, z2m: { gh: 'Koenkk/zigbee2mqtt' },
  zwavejs: { gh: 'zwave-js/zwave-js-ui', ha: 'zwave_js' }, valetudo: { gh: 'Hypfer/Valetudo' }, frigate: { gh: 'blakeblackshear/frigate' }, musicassistant: { gh: 'music-assistant/server' },
  matter: { gh: 'home-assistant-libs/python-matter-server', ha: 'matter' }, homeassistant: { gh: 'home-assistant/core' }, jellyfin: { gh: 'jellyfin/jellyfin', ha: 'jellyfin' },
  kodi: { gh: 'xbmc/xbmc', ha: 'kodi' }, lms: { gh: 'LMS-Community/slimserver', ha: 'squeezebox' }, deconz: { gh: 'dresden-elektronik/deconz-rest-plugin', ha: 'deconz' },
  hue: { ha: 'hue' }, shelly: { ha: 'shelly' }, tapo: { ha: 'tplink' }, kasa: { ha: 'tplink' }, govee: { ha: 'govee_light_local' }, nanoleaf: { ha: 'nanoleaf' }, yeelight: { ha: 'yeelight' },
  wiz: { ha: 'wiz' }, lifx: { ha: 'lifx' }, elgato: { ha: 'elgato' }, broadlink: { ha: 'broadlink' }, tuya: { ha: 'tuya' }, twinkly: { ha: 'twinkly' }, mystrom: { ha: 'mystrom' },
  daikin: { ha: 'daikin' }, airzone: { ha: 'airzone' }, fibaro: { ha: 'fibaro' }, ecowitt: { ha: 'ecowitt' }, nut: { ha: 'nut' }, ipp: { ha: 'ipp' }, onkyo: { ha: 'onkyo' },
  freebox: { ha: 'freebox' }, nuki: { ha: 'nuki' }, reolink: { ha: 'reolink' }, unifiprotect: { ha: 'unifiprotect' }, samsungtv: { ha: 'samsungtv' }, lgtv: { ha: 'webostv' },
  philipstv: { ha: 'philips_js' }, bravia: { ha: 'braviatv' }, sonos: { ha: 'sonos' }, cast: { ha: 'cast' }, denon: { ha: 'denonavr' }, musiccast: { ha: 'yamaha_musiccast' },
  roku: { ha: 'roku' }, androidtv: { ha: 'androidtv' }, bose: { ha: 'soundtouch' }, tahoma: { ha: 'overkiz' }, dirigera: { ha: 'ikea' },
  melcloud: { ha: 'melcloud', cloud: true }, verisure: { ha: 'verisure', cloud: true }, tado: { ha: 'tado', cloud: true }, netatmo: { ha: 'netatmo', cloud: true },
  cozytouch: { ha: 'overkiz', cloud: true }, husqvarna: { ha: 'husqvarna_automower', cloud: true }, viessmann: { ha: 'vicare', cloud: true }, smartthings: { ha: 'smartthings', cloud: true },
  homeconnect: { ha: 'home_connect', cloud: true }, sensibo: { ha: 'sensibo', cloud: true }, spotify: { ha: 'spotify', cloud: true }, switchbot: { ha: 'switchbot_cloud', cloud: true },
  wallbox: { ha: 'wallbox', cloud: true }, heatzy: { cloud: true }, linky: { cloud: true }, ford: { cloud: true }
};
const ALARM = /stopp?ed working|not working|no longer|broken|fails?|failed|error|unavailable|cannot connect|can't connect|login|auth|401|403|429|api|changed|deprecat|ne fonctionne plus|erreur/i;

module.exports = function veille(DATA, send, readBody, { HUB, NOTIFY, ENGINE, VERSION }) {
  const FILE = path.join(DATA, 'veille.json');
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  C = Object.assign({ cfg: {}, brands: {}, up: {}, events: [] }, C);
  C.cfg = Object.assign({ on: true, delay: 15, notifyDown: true, notifyChange: true, notifyRelease: true, notifyIssues: true, upstream: true, gh: { token: '', repo: '', auto: false } }, C.cfg);
  let dirty = false; const persist = () => { dirty = true; };
  setInterval(() => { if (dirty) { dirty = false; try { fs.writeFileSync(FILE, JSON.stringify(C), { mode: 0o600 }); } catch (e) { } } }, 5000);
  const GH = (process.env.VEILLE_GH || 'https://api.github.com').replace(/\/+$/, '');
  const name = id => { const b = HUB.brand(id); return b ? b.name : id; };
  const ev = (brand, type, text, extra) => { C.events.unshift(Object.assign({ t: Date.now(), brand, type, text }, extra || {})); C.events = C.events.slice(0, 200); persist(); };
  const notify = (title, message, tags) => NOTIFY.notifyRule('brands', { title, message: String(message).slice(0, 300), go: 'veille', tags: tags || ['warning'] }).catch(() => 0);
  if (ENGINE && ENGINE.X && ENGINE.X.EXT) ENGINE.X.EXT.brandWatch = true;   // la « santé de la maison » laisse les pannes de marque à la veille

  /* ---------- relevés : panne, retour, réponse différente ---------- */
  // signature d'une réponse : les types d'appareils et les champs de leur état (sans les valeurs)
  const sigOf = list => [...new Set(list.filter(d => !d.error).map(d => (d.kind || '?') + ':' + Object.keys(d.state || {}).filter(k => d.state[k] !== undefined).sort().join(',')))].sort();
  HUB.onPoll && HUB.onPoll((id, err, list) => {
    if (!C.cfg.on) return;
    const b = C.brands[id] = C.brands[id] || { n: 0, sig: null, okAt: 0, errSince: 0, err: '', down: false };
    b.lastAt = Date.now();
    if (err) { if (!b.errSince) b.errSince = Date.now(); b.err = err; persist(); return; }
    if (b.down) { ev(id, 'up', name(id) + ' refonctionne' + (b.errSince ? ' après ' + Math.round((Date.now() - b.errSince) / 6e4) + ' min' : '')); if (C.cfg.notifyDown) notify('✅ ' + name(id) + ' refonctionne', 'Les appareils ' + name(id) + ' répondent de nouveau.', ['white_check_mark']); }
    b.down = false; b.errSince = 0; b.err = ''; b.okAt = Date.now();
    const sig = sigOf(list), n = list.filter(d => !d.error).length, broken = list.filter(d => d.error);
    if (b.sig) {
      const gone = b.sig.filter(s => !sig.includes(s)), added = sig.filter(s => !b.sig.includes(s));
      // des champs disparus ou plus aucun appareil : l'API de la marque a probablement changé
      const lost = gone.filter(g => { const [k, f] = g.split(':'), now = sig.find(s => s.startsWith(k + ':')); return !now || (f && f.split(',').some(x => !now.split(':')[1].split(',').includes(x))); });
      const key = n === 0 ? 'vide' : lost.join(';');
      // un champ qui manque une fois (mesure absente, appareil éteint) n'est pas un changement : il faut 3 relevés de suite
      if (((b.n > 0 && n === 0) || lost.length) && (b.pend && b.pend.key === key ? ++b.pend.n : (b.pend = { key, n: 1 }).n) < 3) { b.partial = broken.length > 0; persist(); return; }
      b.pend = null;
      if ((b.n > 0 && n === 0) || lost.length) {
        const txt = n === 0 ? 'plus aucun appareil (il y en avait ' + b.n + ')' : 'champs disparus : ' + lost.join(' ; ');
        ev(id, 'change', name(id) + ' : réponse différente — ' + txt, { before: b.sig, after: sig });
        if (C.cfg.notifyChange) notify('⚠️ ' + name(id) + ' a changé', txt + '. Une mise à jour de la marque a peut-être modifié son API.');
        if (C.cfg.gh.auto) ticket(id, 'change', txt).catch(() => { });
      } else if (added.length) ev(id, 'info', name(id) + ' : nouveaux champs (' + added.join(' ; ') + ')');
    }
    if (broken.length && !b.partial) ev(id, 'partial', name(id) + ' : ' + broken.length + ' appareil(s) en erreur — ' + broken[0].error);
    b.partial = broken.length > 0; b.sig = sig; b.n = n; persist();
  });
  // toutes les minutes : les marques reliées sont relues (même si aucun écran n'est ouvert), les pannes qui durent sont signalées
  async function tick() {
    if (!C.cfg.on) return;
    const used = HUB.configured();
    await Promise.all(used.map(id => HUB.states(id).catch(() => { })));
    for (const id of used) {
      const b = C.brands[id]; if (!b || !b.errSince || b.down) continue;
      if (Date.now() - b.errSince >= (+C.cfg.delay || 15) * 6e4) {
        b.down = true; persist();
        ev(id, 'down', name(id) + ' ne répond plus : ' + b.err);
        if (C.cfg.notifyDown) notify('🔴 ' + name(id) + ' en panne', 'Depuis ' + (+C.cfg.delay || 15) + ' min : ' + b.err);
        if (C.cfg.gh.auto) ticket(id, 'down', b.err).catch(() => { });
      }
    }
  }
  setTimeout(() => { tick(); setInterval(tick, 6e4); }, 30000);

  /* ---------- nouvelles des marques : versions publiées, tickets Home Assistant ---------- */
  const H = () => Object.assign({ 'User-Agent': 'beta-home', Accept: 'application/vnd.github+json' }, C.cfg.gh.token ? { Authorization: 'Bearer ' + C.cfg.gh.token } : {});
  const ghGet = async p => { const r = await request(GH + p, { headers: H(), raw: true, timeout: 15000 }); if (r.status !== 200) throw new Error('GitHub ' + r.status + (r.status === 403 ? ' (quota : ajoutez un jeton GitHub)' : '')); return r.json(); };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function upstream(only) {
    const used = only ? [only] : HUB.configured(), week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), done = new Set();
    for (const id of used) {
      const s = SRC[id]; if (!s) continue;
      const u = C.up[id] = C.up[id] || {}; u.at = Date.now();
      if (s.gh) try {
        const r = await ghGet('/repos/' + s.gh + '/releases/latest'), tag = r.tag_name;
        if (u.tag && u.tag !== tag) { ev(id, 'release', name(id) + ' : nouvelle version ' + tag, { url: r.html_url }); if (C.cfg.notifyRelease) notify('🆕 ' + name(id) + ' ' + tag, 'Nouvelle version publiée. Vérifiez que tout marche après la mise à jour.', ['new']); }
        Object.assign(u, { tag, date: r.published_at, url: r.html_url, notes: String(r.body || '').replace(/\r/g, '').slice(0, 600), err: '' });
      } catch (e) { u.err = e.message; }
      if (s.ha && !done.has(s.ha)) {
        done.add(s.ha);
        try {
          await pause(only ? 0 : 7000);   // recherche GitHub : 10 requêtes par minute sans jeton
          const r = await ghGet('/search/issues?q=' + encodeURIComponent('repo:home-assistant/core is:issue label:"integration: ' + s.ha + '" created:>=' + week) + '&sort=created&order=desc&per_page=10');
          const items = (r.items || []).map(x => ({ n: x.number, title: x.title, url: x.html_url, at: x.created_at, open: x.state === 'open', alarm: ALARM.test(x.title) }));
          const seen = new Set(u.issues ? u.issues.map(x => x.n) : []), fresh = u.issues ? items.filter(x => !seen.has(x.n) && x.alarm) : [];
          fresh.forEach(x => ev(id, 'issue', name(id) + ' (Home Assistant) : ' + x.title, { url: x.url }));
          if (fresh.length && C.cfg.notifyIssues && s.cloud) notify('👀 ' + name(id) + ' : signal d’alerte', fresh[0].title + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ')' : '') + ' — signalé par les utilisateurs de Home Assistant.', ['eyes']);
          Object.assign(u, { ha: s.ha, issues: items, total: r.total_count || items.length, herr: '' });
          used.filter(x => SRC[x] && SRC[x].ha === s.ha && x !== id).forEach(x => { C.up[x] = Object.assign(C.up[x] || {}, { ha: s.ha, issues: items, total: u.total, at: Date.now() }); });
        } catch (e) { u.herr = e.message; }
      }
      persist();
    }
    C.upAt = Date.now(); persist();
  }
  // une fois par jour, vers 4 h du matin (et 2 minutes après le démarrage si jamais fait)
  setInterval(() => { const d = new Date(); if (C.cfg.on && C.cfg.upstream && d.getHours() === 4 && Date.now() - (C.upAt || 0) > 20 * 36e5) upstream().catch(() => { }); }, 10 * 6e4);
  setTimeout(() => { if (C.cfg.on && C.cfg.upstream && Date.now() - (C.upAt || 0) > 20 * 36e5) upstream().catch(() => { }); }, 120000);

  /* ---------- rapport pour corriger, ticket GitHub ---------- */
  function report(id) {
    const b = C.brands[id] || {}, u = C.up[id] || {}, d = t => t ? new Date(t).toLocaleString('fr-FR') : '—';
    return ['## ' + name(id) + ' (`' + id + '`)', '', '- Connecteur : `server/hub/' + id + '.js`', '- Serveur Bêta : ' + (VERSION || '?'), '- État : ' + (b.down ? 'EN PANNE depuis ' + d(b.errSince) : b.errSince ? 'erreurs depuis ' + d(b.errSince) : 'OK'),
      '- Dernière lecture réussie : ' + d(b.okAt), '- Erreur : ' + (b.err || '—'), '- Appareils : ' + (b.n || 0), '- Champs reçus : ' + ((b.sig || []).join(' ; ') || '—'),
      u.tag ? '- Dernière version du projet : ' + u.tag + ' (' + d(u.date) + ') ' + (u.url || '') : '', (u.issues || []).length ? '- Tickets Home Assistant « ' + u.ha + ' » cette semaine :\n' + u.issues.slice(0, 5).map(x => '  - ' + x.title + ' ' + x.url).join('\n') : '',
      '', '### Derniers évènements', ...C.events.filter(e => e.brand === id).slice(0, 10).map(e => '- ' + d(e.t) + ' — ' + e.text)].filter(x => x !== '').join('\n');
  }
  async function ticket(id, why, detail) {
    const g = C.cfg.gh; if (!g.token || !g.repo) throw new Error('jeton ou dépôt GitHub manquant');
    const b = C.brands[id] = C.brands[id] || {};
    if (b.issue && Date.now() - b.issue.at < 7 * 864e5) return b.issue;   // pas deux tickets la même semaine
    const r = await request(GH + '/repos/' + g.repo + '/issues', { headers: H(), body: { title: 'Marque ' + name(id) + ' : ' + (why === 'down' ? 'en panne' : why === 'change' ? 'réponse différente' : 'à vérifier') + ' — ' + String(detail || '').slice(0, 80), body: report(id) + '\n\n_Ticket créé par la veille des marques de Bêta home._', labels: ['marque'] }, raw: true, timeout: 15000 });
    const j = r.json() || {};
    if (r.status >= 300) throw new Error('GitHub ' + r.status + ' : ' + (j.message || ''));
    b.issue = { at: Date.now(), url: j.html_url, n: j.number }; ev(id, 'ticket', 'Ticket GitHub créé : #' + j.number, { url: j.html_url }); persist();
    return b.issue;
  }

  /* ---------- API ---------- */
  const view = () => {
    const used = HUB.configured();
    return {
      cfg: Object.assign({}, C.cfg, { gh: { repo: C.cfg.gh.repo, auto: C.cfg.gh.auto, token: C.cfg.gh.token ? '••••' : '' } }),
      brands: used.map(id => { const b = C.brands[id] || {}, u = C.up[id] || {}; return { id, name: name(id), src: SRC[id] || {}, ok: !b.errSince, down: !!b.down, err: b.err || '', errSince: b.errSince || 0, okAt: b.okAt || 0, lastAt: b.lastAt || 0, n: b.n || 0, sig: b.sig || [], partial: !!b.partial, issue: b.issue || null, up: { tag: u.tag, date: u.date, url: u.url, notes: u.notes, err: u.err || u.herr || '', ha: u.ha, issues: u.issues || [], total: u.total || 0, at: u.at || 0 } }; }),
      events: C.events.slice(0, 60), upAt: C.upAt || 0
    };
  };
  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === '/api/veille' && m === 'GET') return send(res, 200, view());
    if (p === '/api/veille' && m === 'PUT') {
      const b = await readBody(req) || {};
      ['on', 'notifyDown', 'notifyChange', 'notifyRelease', 'notifyIssues', 'upstream'].forEach(k => { if (k in b) C.cfg[k] = !!b[k]; });
      if ('delay' in b) C.cfg.delay = Math.max(2, Math.min(240, +b.delay || 15));
      if (b.gh && typeof b.gh === 'object') { if (typeof b.gh.repo === 'string') C.cfg.gh.repo = b.gh.repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, ''); if ('auto' in b.gh) C.cfg.gh.auto = !!b.gh.auto; if (typeof b.gh.token === 'string' && b.gh.token !== '••••') C.cfg.gh.token = b.gh.token.trim(); }
      persist(); return send(res, 200, view());
    }
    if (p === '/api/veille/check' && m === 'POST') { const b = await readBody(req) || {}; await upstream(b.brand || null); return send(res, 200, view()); }
    if (p === '/api/veille/report' && m === 'GET') return send(res, 200, { text: report(url.searchParams.get('brand') || '') });
    if (p === '/api/veille/ticket' && m === 'POST') { const b = await readBody(req) || {}; try { return send(res, 200, await ticket(b.brand, 'manual', (C.brands[b.brand] || {}).err || 'vérification')); } catch (e) { return send(res, 400, { error: e.message }); } }
    return false;
  }
  return { api, report, _test: { sigOf, tick, upstream, C, ticket } };
};
