// Serveur Bêta — notifications sans Home Assistant, 24 h/24 (même quand aucun écran n'est allumé).
// - envoi sur les téléphones avec ntfy (appli gratuite iPhone/Android ; serveur ntfy.sh ou le vôtre sur le NAS)
// - surveillance des appareils reliés en direct : sonnette, fuite d'eau, garage resté ouvert, machine terminée,
//   mouvement ou ouverture pendant une absence
// - sonnette : photo de la caméra sur les téléphones, annonce vocale et caméra à l'écran sur les tablettes (Fully Kiosk)
'use strict';
const fs = require('fs'), path = require('path');

const RULES = ['doorbell', 'person', 'garage', 'leak', 'alarm', 'trash', 'appliance', 'weather', 'away', 'presence'];
module.exports = function notify(DATA, send, readBody, HUB, CAMS) {
  const FILE = path.join(DATA, 'notify.json');
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  C = Object.assign({ ntfy: { url: 'https://ntfy.sh', token: '' }, users: {}, rules: {}, watch: [], tablets: { say: true, show: true, text: 'On sonne à la porte', tv: false }, cam: '', away: false, site: '', garageMin: 10 }, C);
  RULES.forEach(r => { C.rules[r] = Object.assign({ on: r !== 'away', who: r === 'away' || r === 'presence' ? 'admins' : 'all' }, C.rules[r]); });
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(C, null, 1), { mode: 0o600 });
  const events = [];   // derniers évènements (sonnette…) lus par les écrans ouverts
  const sent = {};     // anti-rafale : clé → date du dernier envoi
  const hooks = { ring: [] };   // autres modules prévenus (pont Alexa : capteur « sonnette »)

  /* ---------- ntfy ---------- */
  // en-têtes HTTP en ASCII : les accents passent en encodage RFC 2047 (compris par ntfy)
  const hdr = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';
  async function publish(topic, o) {
    const base = String(C.ntfy.url || 'https://ntfy.sh').replace(/\/+$/, ''), auth = C.ntfy.token ? { Authorization: 'Bearer ' + C.ntfy.token } : {};
    const click = o.go && C.site ? C.site.replace(/#.*$/, '') + '#' + o.go : undefined;
    const prio = o.critical ? 5 : o.urgent ? 4 : 3, tags = o.tags || [];
    let r;
    if (o.image) {   // photo jointe : envoyée en pièce jointe (PUT), le texte part dans les en-têtes
      const h = Object.assign({ Title: hdr(o.title), Message: hdr(o.message), Priority: String(prio), Filename: 'camera.jpg' }, auth, tags.length ? { Tags: tags.join(',') } : {}, click ? { Click: click, Actions: 'view, Ouvrir, ' + click } : {});
      r = await fetch(base + '/' + encodeURIComponent(topic), { method: 'PUT', headers: h, body: o.image, signal: AbortSignal.timeout(15000) });
    } else {
      const body = { topic, title: o.title, message: o.message, priority: prio, tags }; if (click) { body.click = click; body.actions = [{ action: 'view', label: 'Ouvrir', url: click }]; }
      r = await fetch(base, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    }
    if (!r.ok) throw new Error('ntfy : HTTP ' + r.status + (r.status === 401 || r.status === 403 ? ' (jeton refusé)' : ''));
  }
  // envoi d'une règle à tous les destinataires concernés ; renvoie le nombre de téléphones prévenus
  async function notifyRule(rule, o) {
    const r = C.rules[rule]; if (!r || !r.on) return 0;
    const to = Object.keys(C.users).filter(id => id !== o.except).map(id => C.users[id]).filter(u => u.topic && (r.who !== 'admins' || u.admin));   // except : la personne concernée
    let n = 0;
    for (const u of to) { try { await publish(u.topic, o); n++; } catch (e) { console.warn('notification ' + rule + ' → ' + u.name + ' : ' + e.message); } }
    return n;
  }
  const once = (key, ms, fn) => { if (Date.now() - (sent[key] || 0) < ms) return; sent[key] = Date.now(); return fn(); };

  /* ---------- sonnette ---------- */
  async function ring(src) {
    if (Date.now() - (sent.ring || 0) < 15000) return { skipped: true };   // un seul appui compte pendant 15 s
    sent.ring = Date.now();
    events.push({ t: Date.now(), type: 'doorbell', cam: C.cam || '', src: src || '' }); while (events.length > 50) events.shift();
    hooks.ring.forEach(f => { try { f(); } catch (e) { } });
    const img = await CAMS.snapshot(C.cam).catch(() => null);
    const tasks = [notifyRule('doorbell', { title: 'Sonnette', message: 'Quelqu’un sonne à la porte', image: img || undefined, go: 'exterieur', urgent: 1, tags: ['bell'] })];
    // tablettes Fully Kiosk : écran allumé, Bêta home au premier plan (il affiche la caméra), annonce vocale
    if (HUB.configured().includes('fully') && (C.tablets.say || C.tablets.show)) {
      const tabs = Object.keys((await HUB.states('fully')).s || {});
      tabs.forEach(ip => tasks.push(HUB.command('fully', ip, Object.assign(C.tablets.show ? { on: true, front: true } : {}, C.tablets.say ? { say: C.tablets.text || 'On sonne à la porte' } : {})).catch(e => console.warn('tablette ' + ip + ' : ' + e.message))));
    }
    // TV LG allumée : petit message à l'écran
    if (C.tablets.tv && HUB.configured().includes('lgtv')) tasks.push(HUB.command('lgtv', 'tv', { say: '🔔 ' + (C.tablets.text || 'On sonne à la porte') }).catch(() => { }));
    const res = await Promise.all(tasks);
    return { phones: res[0], photo: !!img };
  }

  /* ---------- surveillance 24 h/24 des appareils reliés en direct ---------- */
  const prev = {}, since = {};
  async function watch() {
    const list = (C.watch || []).filter(w => w && w.brand && w.id); if (!list.length) return;
    const brands = [...new Set(list.map(w => w.brand))], st = {};
    await Promise.all(brands.map(async b => { try { st[b] = (await HUB.states(b)).s || {}; } catch (e) { st[b] = {}; } }));
    for (const w of list) {
      const s = st[w.brand][w.id]; if (!s) continue;
      const k = w.brand + ':' + w.id, p = prev[k]; prev[k] = Object.assign({}, s);
      if (!p) continue;   // premier passage : on mémorise seulement
      const where = w.name + (w.room ? ' — ' + w.room : '');
      const rose = f => !p[f] && !!s[f];
      if (w.role === 'doorbell' && (rose('on') || (s.pressed && s.pressed !== p.pressed))) ring(where);
      else if (w.kind === 'leak' && rose('on')) once('leak:' + k, 30 * 6e4, () => notifyRule('leak', { title: 'Fuite d’eau !', message: where, critical: 1, go: 'absence', tags: ['droplet', 'warning'] }));
      else if (w.kind === 'alarm' && s.mode === 'triggered' && p.mode !== 'triggered') once('alarm:' + k, 5 * 6e4, () => notifyRule('alarm', { title: 'ALARME DÉCLENCHÉE', message: where + ' — vérifiez les caméras', critical: 1, go: 'exterieur', tags: ['rotating_light'] }));
      else if ((w.kind === 'motion' || w.kind === 'door') && C.away && rose('on')) once('person:' + k, 10 * 6e4, () => notifyRule('person', { title: w.kind === 'door' ? 'Ouverture pendant l’absence' : 'Mouvement pendant l’absence', message: where, urgent: 1, go: 'absence', tags: ['warning'] }));
      else if (w.kind === 'app' && p.on && s.on === false) once('app:' + k, 30 * 6e4, () => notifyRule('appliance', { title: w.name + ' terminé', message: 'Le cycle est fini' + (w.room ? ' (' + w.room + ')' : ''), go: 'accueil', tags: ['white_check_mark'] }));
      // garage / portail resté ouvert
      if (w.role === 'garage' || w.kind === 'garage') {
        const open = s.pos > 0 || (w.kind === 'door' && s.on);
        if (!open) delete since[k]; else { since[k] = since[k] || Date.now(); const min = Math.round((Date.now() - since[k]) / 6e4); if (min >= (C.garageMin || 10)) once('garage:' + k, 30 * 6e4, () => notifyRule('garage', { title: w.name + ' ouvert', message: 'Ouvert depuis ' + min + ' min', urgent: 1, go: 'exterieur', tags: ['door'] })); }
      }
    }
  }
  setInterval(() => watch().catch(e => console.warn('surveillance : ' + e.message)), 5000);

  /* ---------- API ---------- */
  const view = () => Object.assign({}, C, { ntfy: { url: C.ntfy.url, token: C.ntfy.token ? '••••' : '' } });
  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === '/api/notify' && m === 'GET') return send(res, 200, view());
    if (p === '/api/notify' && m === 'PUT') {
      const b = await readBody(req) || {};
      if (b.ntfy) { if (b.ntfy.url) C.ntfy.url = String(b.ntfy.url).trim(); if (b.ntfy.token != null && b.ntfy.token !== '••••') C.ntfy.token = String(b.ntfy.token).trim(); }
      if (b.users && typeof b.users === 'object') C.users = b.users;
      if (b.rules) RULES.forEach(r => { if (b.rules[r]) C.rules[r] = { on: !!b.rules[r].on, who: b.rules[r].who === 'admins' ? 'admins' : 'all' }; });
      if (Array.isArray(b.watch)) C.watch = b.watch.slice(0, 500);
      if (b.tablets) C.tablets = Object.assign(C.tablets, b.tablets);
      ['cam', 'site'].forEach(k => { if (typeof b[k] === 'string') C[k] = b[k]; });
      if (b.garageMin) C.garageMin = Math.max(1, +b.garageMin || 10);
      persist(); return send(res, 200, view());
    }
    // la maison passe en absence (ou revient) : sert aux alertes « mouvement pendant l'absence »
    if (p === '/api/notify/away' && m === 'POST') {
      const b = await readBody(req) || {}, was = C.away; C.away = !!b.away; persist();
      if (was !== C.away) notifyRule('away', { title: C.away ? 'Mode absent activé' : 'Retour à la maison', message: C.away ? 'Maison sécurisée' + (b.by ? ' par ' + b.by : '') : 'Le mode absent est désactivé' + (b.by ? ' par ' + b.by : ''), go: 'absence', tags: ['house'] });
      return send(res, 200, { away: C.away });
    }
    // envoi demandé par un écran (poubelles, météo… calculés dans Bêta home)
    if (p === '/api/notify/send' && m === 'POST') {
      const b = await readBody(req) || {}; if (!RULES.includes(b.rule)) return send(res, 400, { error: 'règle inconnue' });
      const n = await once('send:' + b.rule + ':' + (b.key || b.title), (+b.every || 60) * 1000, () => notifyRule(b.rule, { title: String(b.title || 'Bêta home').slice(0, 120), message: String(b.message || '').slice(0, 500), go: b.go, urgent: b.urgent, critical: b.critical }));
      return send(res, 200, { sent: n || 0 });
    }
    if (p === '/api/notify/test' && m === 'POST') {
      const b = await readBody(req) || {}, u = C.users[b.user]; if (!u || !u.topic) return send(res, 400, { error: 'aucun sujet ntfy pour cet utilisateur' });
      try { await publish(u.topic, { title: 'Bêta home', message: 'Bonjour ' + (u.name || '') + ' ! Les notifications fonctionnent 🎉', go: 'accueil', tags: ['tada'] }); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (p === '/api/notify/ring' && (m === 'POST' || m === 'GET')) return send(res, 200, await ring('test'));
    if (p === '/api/notify/events' && m === 'GET') { const t = +url.searchParams.get('since') || 0; return send(res, 200, { now: Date.now(), away: C.away, events: events.filter(e => e.t > t) }); }
    return false;
  }
  return { api, ring, notifyRule, hooks, isAway: () => !!C.away };
};
