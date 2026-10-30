// Serveur Bêta 7.14 — la vie de la maison, sur le NAS :
// - réseau : nouvel appareil inconnu, coupures internet, débit qui chute ; Wi-Fi invités (QR code, coupure auto) ;
//   contrôle parental (Internet coupé par horaire ou en pause pour les appareils d'un enfant — Bbox)
// - réveil en douceur : lumières et volets progressifs, radio et météo sur la tablette de la chambre
// - modes (cinéma, repas, invités) : ne pas déranger, Wi-Fi invités, musique
// - conseiller Tempo : la veille d'un jour rouge, quoi décaler ; appareils coupés en heures pleines rouges / en heures pleines
// - tableau du matin : météo, trajets (bouchons sur l'A35), bus/tram CTS et TER, poubelles, rappels
// - interphone : annonces vers une tablette ou toutes ; rappels d'entretien de la maison ; tableau d'administration
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = function extra(DATA, send, readBody, M) {
  const { HUB, NOTIFY, ENGINE, PLUS, LOGS, MODS } = M, X = ENGINE.X, E = X.C, P = PLUS ? PLUS.C : null;
  const FILE = path.join(DATA, 'extra.json');
  const DEF = {
    net: { known: {}, watch: true, outages: [], newDevs: [] },
    guest: { ssid: '', pass: '', main: { ssid: '', pass: '' }, hours: 4, offAt: 0 },
    kids: [],          // { id, name, macs:[], sched:[{days,from,to}], pause:0 }
    wakes: [],         // { id, name, on, time, days, ramp, lights:[], covers:[], tablet:'', radio:'', say:true, who }
    dnd: 0, shift: [], advice: true,
    commute: [],       // { id, who, name, to, lat, lon }
    traffic: { tomtom: '' }, transit: { cts: '', ctsStops: [], sncf: '', sncfStops: [] },
    tablets: {},       // ip Fully → { name, room }
    reminders: []      // { id, name, every (mois), last (AAAA-MM-JJ), icon, notified }
  };
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  Object.keys(DEF).forEach(k => { C[k] = DEF[k] && typeof DEF[k] === 'object' && !Array.isArray(DEF[k]) ? Object.assign({}, DEF[k], C[k]) : C[k] !== undefined ? C[k] : DEF[k]; });
  let pT = 0; const persist = () => { clearTimeout(pT); pT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(C, null, 1), { mode: 0o600 }, () => { }), 300); };
  const kind = id => (E.devices[id] || {}).kind || '', dname = id => (E.devices[id] || {}).name || id;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const BOXES = ['bbox', 'deco', 'freebox'].filter(b => HUB.brand(b));
  const boxes = () => BOXES.filter(b => HUB.configured().includes(b));
  const inSpan = (t, from, to) => from <= to ? t >= from && t < to : t >= from || t < to;
  const on = m => !(P && (P.off || []).includes(m));   // modules coupés dans Paramètres › Modules

  /* ======================= 3. réseau : inconnus, coupures, débit ======================= */
  const NET = { online: null, since: Date.now(), info: {}, last: 0 };
  const WANF = path.join(X.HDIR, '_wan.jsonl');
  async function internet() { try { const r = await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(6000) }); return r.ok; } catch (e) { try { const r = await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(6000) }); return r.status === 204; } catch (x) { return false; } } }
  async function netTick() {
    for (const b of boxes()) {
      let i; try { i = await HUB.brand(b).info(HUB.cfg(b)); } catch (e) { continue; }
      NET.info[b] = { at: Date.now(), wan: (i.box || {}).wan || {} };
      const known = C.net.known[b] = C.net.known[b] || {}, seed = !Object.keys(known).length;
      (i.clients || []).forEach(cl => {
        if (!cl.mac || known[cl.mac]) { if (known[cl.mac] && cl.online) known[cl.mac].seen = Date.now(); return; }
        known[cl.mac] = { name: cl.name, first: Date.now(), seen: Date.now() };
        if (seed || !C.net.watch) return;
        C.net.newDevs.unshift({ t: Date.now(), box: b, mac: cl.mac, name: cl.name, ip: cl.ip, link: cl.link }); C.net.newDevs.length = Math.min(C.net.newDevs.length, 30);
        X.note('Nouvel appareil sur le réseau : ' + cl.name + ' (' + cl.ip + ')', 'wifi');
        NOTIFY.notifyRule('network', { title: 'Nouvel appareil sur le réseau', message: (cl.name || cl.mac) + ' — ' + (cl.ip || '') + ' · ' + (cl.link === 'wifi' ? 'Wi-Fi ' + (cl.band || '') : 'câble'), go: 'reseau', urgent: 1, tags: ['satellite'] });
      });
      persist();
    }
    // internet : coupure et retour (la notification part au retour, quand elle peut passer)
    const on = await internet(), now = Date.now(), w = (Object.values(NET.info)[0] || {}).wan || {};
    fs.appendFile(WANF, JSON.stringify([Math.round(now / 1000), on ? 1 : 0, w.down != null ? w.down : null, w.up != null ? w.up : null, w.maxDown || w.syncDown || null]) + '\n', () => { });
    if (NET.online !== null && on !== NET.online) {
      if (!on) { C.net.outages.unshift({ start: now, end: 0 }); X.note('Internet coupé', 'wifi'); }
      else { const o = C.net.outages[0]; if (o && !o.end) { o.end = now; const min = Math.max(1, Math.round((o.end - o.start) / 6e4)); X.note('Internet revenu après ' + min + ' min', 'wifi'); if (min >= 2) NOTIFY.notifyRule('network', { title: 'Internet était coupé', message: 'Coupure de ' + min + ' min (' + new Date(o.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' – ' + new Date(o.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ').', go: 'reseau', tags: ['globe_with_meridians'] }); } }
      C.net.outages.length = Math.min(C.net.outages.length, 100); persist();
    }
    if (on !== NET.online) NET.since = now; NET.online = on; NET.last = now;
    // débit maximum (synchro) qui s'effondre par rapport à la médiane de la semaine
    const cur = w.maxDown || w.syncDown;
    if (cur && new Date().getMinutes() === 0) {
      const v = wanHist(7 * 864e5).map(x => x[4]).filter(Boolean).sort((a, b) => a - b), med = v[Math.floor(v.length / 2)];
      if (v.length > 50 && cur < med * 0.5 && C.net.slowDay !== X.ymd(new Date())) { C.net.slowDay = X.ymd(new Date()); NOTIFY.notifyRule('network', { title: 'Débit internet en chute', message: 'Débit maximum ' + cur + ' Mb/s au lieu de ' + med + ' Mb/s habituellement. Redémarrer la box peut aider.', go: 'reseau', tags: ['turtle'] }); }
    }
  }
  function wanHist(span) { try { const from = (Date.now() - span) / 1000; return fs.readFileSync(WANF, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x[0] >= from); } catch (e) { return []; } }
  setInterval(() => { if (on('reseau')) netTick().catch(e => console.warn('réseau : ' + e.message)); }, 60000); setTimeout(() => netTick().catch(() => { }), 15000);
  setInterval(() => { try { const l = wanHist(31 * 864e5); fs.writeFileSync(WANF, l.map(x => JSON.stringify(x)).join('\n') + (l.length ? '\n' : '')); } catch (e) { } }, 24 * 36e5);

  /* ======================= 1. Wi-Fi invités ======================= */
  const bbox = () => boxes().includes('bbox') && HUB.cfg('bbox').password ? HUB.brand('bbox') : null;
  async function guestInfo() {
    const b = bbox(); let box = null;
    if (b) { try { box = await b.guest(HUB.cfg('bbox')); } catch (e) { box = { err: e.message }; } }
    return { ssid: C.guest.ssid || (box && box.ssid) || '', pass: C.guest.pass || (box && box.pass) || '', on: box && !box.err ? box.on : null, can: !!b, err: box && box.err, offAt: C.guest.offAt, hours: C.guest.hours, main: C.guest.main };
  }
  async function guestSet(on, hours) {
    const b = bbox(); if (!b) throw new Error('le Wi-Fi invités se commande avec la Bbox (mot de passe admin dans Marques › Bbox)');
    await b.guestSet(HUB.cfg('bbox'), on);
    C.guest.offAt = on && +hours ? Date.now() + +hours * 36e5 : 0; persist();
    X.note('Wi-Fi invités ' + (on ? 'allumé' + (C.guest.offAt ? ' jusqu’à ' + X.hm(new Date(C.guest.offAt)) : '') : 'coupé'), 'wifi');
  }

  /* ======================= 2. contrôle parental (Bbox) ======================= */
  const kidBlocked = {};
  function kidWant(k, d) { if (k.pause > Date.now()) return true; const t = X.hm(d); return (k.sched || []).some(p => (!p.days || !p.days.length || p.days.includes(d.getDay())) && inSpan(t, p.from, p.to)); }
  async function kidsTick(d) {
    const b = bbox(); if (!b || !C.kids.length) return;
    for (const k of C.kids.filter(x => x.on !== false)) {
      const want = kidWant(k, d);
      for (const mac of k.macs || []) {
        if (kidBlocked[mac] === want) continue;
        try { await b.block(HUB.cfg('bbox'), mac, want); kidBlocked[mac] = want; X.note('Internet ' + (want ? 'coupé' : 'rendu') + ' : ' + k.name + ' (' + mac + ')', 'lock'); }
        catch (e) { X.note('⚠ Contrôle parental ' + k.name + ' : ' + e.message, 'alert'); kidBlocked[mac] = want; }
      }
    }
  }

  /* ======================= 4. réveil en douceur ======================= */
  const running = {};
  async function weatherLine() {
    const h = X.home(); try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + h.lat + '&longitude=' + h.lon + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=Europe%2FParis', { signal: AbortSignal.timeout(10000) });
      const j = await r.json(), c = j.current || {}, dd = j.daily || {}, rain = (dd.precipitation_probability_max || [])[0];
      return { now: Math.round(c.temperature_2m), max: Math.round((dd.temperature_2m_max || [])[0]), min: Math.round((dd.temperature_2m_min || [])[0]), rain, code: c.weather_code, text: 'Il fait ' + Math.round(c.temperature_2m) + ' degrés, ' + Math.round((dd.temperature_2m_max || [])[0]) + ' au plus fort de la journée' + (rain >= 50 ? ', avec ' + rain + ' % de risque de pluie : prenez un parapluie' : '') + '.' };
    } catch (e) { return null; }
  }
  async function greeting(who) {
    const w = await weatherLine(), tr = (await X.trashDays(1)).map(e => e.name), tp = X.S.tempo;
    return ['Bonjour' + (who ? ' ' + who : '') + ' !', w ? w.text : '', tp && tp.today === 'rouge' ? 'Attention, jour rouge Tempo : électricité très chère jusqu’à 22 heures.' : tp && tp.today === 'blanc' ? 'Jour blanc Tempo.' : '', tr.length ? 'Ce soir, on sort : ' + tr.join(', ') + '.' : ''].filter(Boolean).join(' ');
  }
  async function wakeRun(w, by) {
    if (running[w.id]) return; running[w.id] = true;
    const steps = Math.max(1, +w.ramp || 15); X.note('Réveil « ' + w.name + ' »' + (by ? ' (' + by + ')' : ''), 'sun');
    try {
      for (let i = 1; i <= steps && running[w.id]; i++) {
        const k = i / steps;
        (w.lights || []).forEach(id => X.command(id, { on: true, bri: Math.max(1, Math.round(100 * k * k)), ct: Math.round(2200 + 2300 * k) }).catch(() => { }));
        (w.covers || []).forEach(id => X.command(id, { pos: Math.round(100 * k) }).catch(() => { }));
        if (i < steps) await new Promise(r => setTimeout(r, 6e4));
      }
      if (!running[w.id]) return;
      if (w.tablet && HUB.configured().includes('fully')) {
        if (w.radio) await HUB.command('fully', w.tablet, { on: true, sound: w.radio }).catch(() => { });
        if (w.say !== false) { const g = await greeting(w.who); await HUB.command('fully', w.tablet, { on: true, say: g }).catch(() => { }); X.emit({ type: 'say', text: g, to: [(C.tablets[w.tablet] || {}).name].filter(Boolean) }); }
      } else if (w.say !== false) X.emit({ type: 'say', text: await greeting(w.who) });
      X.emit({ type: 'wake', id: w.id, name: w.name });
    } finally { delete running[w.id]; }
  }
  function wakeTick(d) {
    C.wakes.filter(w => w.on !== false && w.time).forEach(w => {
      const start = new Date(d); start.setHours(+w.time.slice(0, 2), +w.time.slice(3, 5), 0, 0); start.setTime(+start - (+w.ramp || 15) * 6e4);
      if (X.hm(start) === X.hm(d) && (!w.days || !w.days.length || w.days.includes(new Date(+start + (+w.ramp || 15) * 6e4).getDay()))) wakeRun(w, 'programmé');
    });
  }

  /* ======================= 5. modes : ne pas déranger, Wi-Fi invités, musique ======================= */
  const dndOn = () => C.dnd > Date.now();
  const nr0 = NOTIFY.notifyRule;
  NOTIFY.notifyRule = (rule, o) => dndOn() && !(o && o.critical) && !['alarm', 'leak', 'doorbell'].includes(rule) ? Promise.resolve(0) : nr0(rule, o);
  function modeRun(sc) { const m = sc.mode || {}; if (+m.dnd) { C.dnd = Date.now() + +m.dnd * 36e5; persist(); X.emit({ type: 'dnd', until: C.dnd }); } if (m.guest) guestSet(true, C.guest.hours).catch(() => { }); if (m.say) X.say(m.say); if (m.radio && m.tablet) HUB.command('fully', m.tablet, { sound: m.radio }).catch(() => { }); }
  if (PLUS) { X.EXT.onScene = X.EXT.onScene || []; X.EXT.onScene.push(modeRun); }

  /* ======================= 7. conseiller Tempo et appareils décalés ======================= */
  X.EXT.tempoAdvice = !!C.advice;
  X.EXT.listen.push(ev => { if (ev.type === 'tempo' && ev.color === 'rouge' && C.advice) tempoAdvice().catch(() => { }); });
  async function tempoAdvice() {
    const lines = [];
    if (P) {
      (P.heat.zones || []).filter(z => z.on !== false && +z.tempoRed).forEach(z => lines.push('🌡 ' + z.name + ' : ' + z.tempoRed + ' °C de 6 h à 22 h'));
      try { const e = PLUS.energy(8), devs = Object.keys(e.devices).map(id => Object.assign({ id }, e.devices[id])).filter(d => d.kwh >= 1).sort((a, b) => b.kwh - a.kwh).slice(0, 3); devs.forEach(d => lines.push('⏰ ' + d.name + ' (' + d.kwh.toFixed(1).replace('.', ',') + ' kWh cette semaine) : après 22 h ou après-demain')); } catch (e) { }
    }
    C.shift.filter(s => s.mode === 'red').forEach(s => lines.push('🔌 ' + dname(s.dev) + ' coupé automatiquement de 6 h à 22 h'));
    lines.push('🚗 Recharge de la voiture et machines : la nuit (22 h – 6 h)');
    await NOTIFY.notifyRule('tempo', { title: 'Demain : jour ROUGE Tempo', message: 'Électricité 4 fois plus chère de 6 h à 22 h.\n' + lines.join('\n'), urgent: 1, go: 'energie', tags: ['red_circle'] });
  }
  const shiftLast = {};
  function shiftTick(d) {
    if (!C.shift.length) return;
    const T = P ? P.tariff : { mode: 'tempo', hcFrom: '22:00', hcTo: '06:00' }, t = X.hm(d), tp = X.S.tempo || {}, red = tp.today === 'rouge' && t >= '06:00' && t < '22:00';
    const hc = T.mode === 'hphc' ? inSpan(t, T.hcFrom, T.hcTo) : inSpan(t, '22:00', '06:00');
    const taken = new Set((X.EXT.claims || []).flatMap(f => { try { return f(); } catch (e) { return []; } }).map(x => x.dev));
    C.shift.forEach(s => {
      if (!E.devices[s.dev] || taken.has(s.dev)) return;   // déjà piloté par le chauffage, l'arrosage ou la recharge
      const on = s.mode === 'red' ? !red : hc;
      if (shiftLast[s.dev] === on) return; shiftLast[s.dev] = on;
      X.command(s.dev, { on }).then(() => X.note((on ? 'Rallumé : ' : 'Coupé (heures ' + (s.mode === 'red' ? 'pleines rouges' : 'pleines') + ') : ') + dname(s.dev), 'boltPlain')).catch(() => { });
    });
  }

  /* ======================= 9-10. trajets et transports ======================= */
  let trCache = { at: 0, list: [] }, tpCache = { at: 0, list: [] };
  async function geocode(q) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'beta-home/1.0 (domotique)' }, signal: AbortSignal.timeout(10000) });
    const j = await r.json(); if (!j[0]) throw new Error('adresse introuvable : ' + q); return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name.split(',').slice(0, 3).join(',') };
  }
  async function traffic() {
    if (Date.now() - trCache.at < 4 * 6e4) return trCache.list;
    const h = X.home(), out = [];
    for (const c of C.commute.filter(x => x.lat)) {
      try {
        if (C.traffic.tomtom) {
          const r = await (await fetch('https://api.tomtom.com/routing/1/calculateRoute/' + h.lat + ',' + h.lon + ':' + c.lat + ',' + c.lon + '/json?traffic=true&travelMode=car&key=' + encodeURIComponent(C.traffic.tomtom), { signal: AbortSignal.timeout(10000) })).json();
          const s = r.routes[0].summary; out.push({ id: c.id, who: c.who, name: c.name, min: Math.round(s.travelTimeInSeconds / 60), normal: Math.round((s.noTrafficTravelTimeInSeconds || s.travelTimeInSeconds) / 60), delay: Math.round((s.trafficDelayInSeconds || 0) / 60), km: Math.round(s.lengthInMeters / 100) / 10, live: true });
        } else {
          const r = await (await fetch('https://router.project-osrm.org/route/v1/driving/' + h.lon + ',' + h.lat + ';' + c.lon + ',' + c.lat + '?overview=false', { signal: AbortSignal.timeout(10000) })).json();
          const s = r.routes[0]; out.push({ id: c.id, who: c.who, name: c.name, min: Math.round(s.duration / 60), normal: Math.round(s.duration / 60), delay: 0, km: Math.round(s.distance / 100) / 10, live: false });
        }
      } catch (e) { out.push({ id: c.id, who: c.who, name: c.name, err: e.message }); }
    }
    trCache = { at: Date.now(), list: out }; return out;
  }
  const b64 = s => Buffer.from(s + ':').toString('base64');
  async function transit() {
    if (Date.now() - tpCache.at < 45000) return tpCache.list;
    const out = [], T = C.transit;
    for (const s of T.cts ? T.ctsStops : []) {
      try {
        const j = await (await fetch('https://api.cts-strasbourg.eu/v1/siri/2.0/stop-monitoring?MonitoringRef=' + encodeURIComponent(s.ref) + '&MaximumStopVisits=6', { headers: { Authorization: 'Basic ' + b64(T.cts) }, signal: AbortSignal.timeout(10000) })).json();
        const v = ((((j.ServiceDelivery || {}).StopMonitoringDelivery || [])[0] || {}).MonitoredStopVisit) || [];
        v.forEach(x => { const m = x.MonitoredVehicleJourney || {}, c = m.MonitoredCall || {}; out.push({ src: 'CTS', stop: s.name, line: m.PublishedLineName || m.LineRef, dir: m.DestinationName, at: Date.parse(c.ExpectedDepartureTime || c.ExpectedArrivalTime), mode: /tram/i.test(m.VehicleMode || '') ? 'tram' : 'bus' }); });
      } catch (e) { out.push({ src: 'CTS', stop: s.name, err: e.message }); }
    }
    for (const s of T.sncf ? T.sncfStops : []) {
      try {
        const j = await (await fetch('https://api.sncf.com/v1/coverage/sncf/stop_areas/' + encodeURIComponent(s.id) + '/departures?count=6&data_freshness=realtime', { headers: { Authorization: 'Basic ' + b64(T.sncf) }, signal: AbortSignal.timeout(10000) })).json();
        const dt = v => v ? Date.parse(v.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3T$4:$5:$6')) : null;
        (j.departures || []).forEach(x => { const di = x.display_informations || {}, sd = x.stop_date_time || {}, a = dt(sd.departure_date_time), b0 = dt(sd.base_departure_date_time); out.push({ src: 'SNCF', stop: s.name, line: (di.commercial_mode || 'TER') + ' ' + (di.headsign || ''), dir: di.direction, at: a, late: a && b0 ? Math.round((a - b0) / 6e4) : 0, mode: 'train' }); });
      } catch (e) { out.push({ src: 'SNCF', stop: s.name, err: e.message }); }
    }
    out.sort((a, b) => (a.at || 9e15) - (b.at || 9e15));
    tpCache = { at: Date.now(), list: out }; return out;
  }
  async function nearStops(src) {
    const h = X.home(), T = C.transit;
    if (src === 'cts') { const j = await (await fetch('https://api.cts-strasbourg.eu/v1/siri/2.0/stoppoints-discovery?latitude=' + h.lat + '&longitude=' + h.lon + '&distance=2500', { headers: { Authorization: 'Basic ' + b64(T.cts) }, signal: AbortSignal.timeout(10000) })).json(); return (((j.StopPointsDelivery || {}).AnnotatedStopPointRef) || []).map(s => ({ ref: s.StopPointRef, name: s.StopName + (s.Lines ? ' (' + [].concat(s.Lines).map(l => l.LineRef || l).slice(0, 4).join(', ') + ')' : '') })).slice(0, 30); }
    const j = await (await fetch('https://api.sncf.com/v1/coverage/sncf/coord/' + h.lon + ';' + h.lat + '/places_nearby?type[]=stop_area&distance=6000&count=15', { headers: { Authorization: 'Basic ' + b64(T.sncf) }, signal: AbortSignal.timeout(10000) })).json();
    return (j.places_nearby || []).map(p => ({ id: p.id, name: p.name }));
  }

  /* ======================= 11. interphone ======================= */
  async function tabletsList() { if (!HUB.configured().includes('fully')) return []; const s = (await HUB.states('fully')).s || {}; return Object.keys(s).map(ip => Object.assign({ ip, online: !!s[ip] }, C.tablets[ip] || { name: 'Tablette ' + ip.split('.').pop(), room: '' })); }
  async function announce(b) {
    const text = String(b.text || '').trim().slice(0, 300); if (!text) throw new Error('message vide');
    const all = await tabletsList(), to = b.to === 'all' || !b.to || !b.to.length ? all.map(t => t.ip) : [].concat(b.to);
    await Promise.all(to.map(ip => HUB.command('fully', ip, Object.assign({ on: true, say: text }, b.chime ? { sound: b.chime } : {})).catch(() => { })));
    X.emit({ type: 'say', text, to: b.to === 'all' || !b.to || !b.to.length ? [] : to.map(ip => (C.tablets[ip] || {}).name).filter(Boolean), from: b.by || '' });
    X.note('Interphone' + (b.by ? ' (' + b.by + ')' : '') + ' : « ' + text + ' »', 'mic');
    return to.length;
  }

  /* ======================= 12. rappels d'entretien ======================= */
  const nextDue = r => { if (!r.last) return X.ymd(new Date()); const d = new Date(r.last + 'T12:00:00'), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + (+r.every || 12)); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return X.ymd(d); };   // 31 janvier + 1 mois = 28 février
  function remindTick() {
    const today = X.ymd(new Date()), due = C.reminders.filter(r => r.on !== false && nextDue(r) <= today && r.notified !== nextDue(r));
    if (!due.length) return;
    due.forEach(r => { r.notified = nextDue(r); }); persist();
    NOTIFY.notifyRule('reminder', { title: 'À faire dans la maison', message: due.map(r => '• ' + r.name).join('\n'), go: 'listes', tags: ['wrench'] });
  }

  /* ======================= boucle ======================= */
  X.EXT.tick.push(({ now, t, minute }) => {
    if (!minute) return;
    if (C.guest.offAt && Date.now() >= C.guest.offAt) { C.guest.offAt = 0; persist(); guestSet(false).catch(() => { }); }
    if (on('reseau')) kidsTick(now).catch(() => { });
    if (on('reveil')) wakeTick(now);
    if (on('energie')) shiftTick(now);
    if (on('rappels') && t === '10:00') remindTick();
  });

  /* ======================= 14. administration ======================= */
  function dirSize(d) { let n = 0, f = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const s = dirSize(p); n += s.bytes; f += s.files; } else { n += fs.statSync(p).size; f++; } } } catch (e) { } return { bytes: n, files: f }; }
  function admin() {
    let disk = null; try { const s = fs.statfsSync(DATA); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch (e) { }
    const sub = {}; ['history', 'backups', 'store'].forEach(k => { sub[k] = dirSize(path.join(DATA, k)); });
    const hub = HUB.configured().map(id => { const c = HUB.cfg(id); return { id, name: (HUB.brand(id) || {}).name || id, status: c.status || '', info: c.info || '' }; });
    return { version: process.env.BETA_SHA || 'dev', node: process.version, uptime: Math.round(process.uptime()), started: Date.now() - Math.round(process.uptime() * 1000), mem: process.memoryUsage().rss, sysmem: { total: os.totalmem(), free: os.freemem() }, load: os.loadavg(), cpus: os.cpus().length, host: os.hostname(), disk, data: dirSize(DATA), sub, modules: typeof MODS === 'function' ? MODS() : MODS, off: process.env.BETA_OFF || '', hub, logs: (LOGS || []).slice(-80).reverse(), internet: { online: NET.online, since: NET.since } };
  }

  /* ======================= API ======================= */
  const view = () => Object.assign({}, C, { traffic: { tomtom: C.traffic.tomtom ? '••••' : '' }, transit: Object.assign({}, C.transit, { cts: C.transit.cts ? '••••' : '', sncf: C.transit.sncf ? '••••' : '' }), net: undefined, guest: Object.assign({}, C.guest, { pass: C.guest.pass ? '••••' : '', main: { ssid: C.guest.main.ssid, pass: C.guest.main.pass ? '••••' : '' } }) });
  async function api(req, res, url, w) {
    const p = url.pathname, m = req.method;
    if (p === '/api/extra' && m === 'GET') return send(res, 200, Object.assign(view(), { state: { dnd: C.dnd, net: { online: NET.online, since: NET.since, outages: C.net.outages.slice(0, 20), newDevs: C.net.newDevs.slice(0, 15), watch: C.net.watch }, kids: C.kids.map(k => ({ id: k.id, blocked: kidWant(k, new Date()) })), bbox: !!bbox() } }));
    if (p === '/api/extra' && m === 'PUT') {
      const b = await readBody(req) || {};
      ['kids', 'wakes', 'shift', 'commute', 'reminders'].forEach(k => { if (Array.isArray(b[k])) C[k] = b[k]; });
      if (b.tablets) C.tablets = b.tablets; if (b.advice !== undefined) { C.advice = !!b.advice; X.EXT.tempoAdvice = C.advice; }
      if (b.netWatch !== undefined) C.net.watch = !!b.netWatch;
      if (b.guest) { ['ssid', 'hours'].forEach(k => { if (b.guest[k] !== undefined) C.guest[k] = b.guest[k]; }); if (b.guest.pass && b.guest.pass !== '••••') C.guest.pass = b.guest.pass; if (b.guest.pass === '') C.guest.pass = ''; if (b.guest.main) { C.guest.main.ssid = b.guest.main.ssid || ''; if (b.guest.main.pass !== '••••') C.guest.main.pass = b.guest.main.pass || ''; } }
      if (b.traffic && b.traffic.tomtom !== '••••') C.traffic.tomtom = String(b.traffic.tomtom || '').trim();
      if (b.transit) { ['cts', 'sncf'].forEach(k => { if (b.transit[k] !== undefined && b.transit[k] !== '••••') C.transit[k] = String(b.transit[k]).trim(); }); ['ctsStops', 'sncfStops'].forEach(k => { if (Array.isArray(b.transit[k])) C.transit[k] = b.transit[k]; }); tpCache.at = 0; }
      for (const c of C.commute) if (c.to && !c.lat) { try { Object.assign(c, await geocode(c.to)); } catch (e) { c.err = e.message; } }
      trCache.at = 0; persist(); return send(res, 200, view());
    }
    if (p === '/api/extra/guest' && m === 'GET') return send(res, 200, await guestInfo());
    if (p === '/api/extra/guest' && m === 'POST') { const b = await readBody(req) || {}; try { await guestSet(!!b.on, b.hours != null ? b.hours : C.guest.hours); return send(res, 200, await guestInfo()); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/extra/kid' && m === 'POST') { const b = await readBody(req) || {}, k = C.kids.find(x => x.id === b.id); if (!k) return send(res, 404, { error: 'profil inconnu' }); k.pause = b.pause ? Date.now() + (+b.minutes || 60) * 6e4 : 0; persist(); await kidsTick(new Date()); return send(res, 200, { ok: true, pause: k.pause }); }
    if (p === '/api/extra/net/known' && m === 'POST') { const b = await readBody(req) || {}; C.net.newDevs = C.net.newDevs.filter(x => x.mac !== b.mac); persist(); return send(res, 200, { ok: true }); }
    if (p === '/api/extra/net/history' && m === 'GET') { const l = wanHist(Math.min(+url.searchParams.get('days') || 1, 31) * 864e5), day = 864e5; const up = l.length ? Math.round(l.filter(x => x[1]).length / l.length * 1000) / 10 : null; return send(res, 200, { points: l.filter((x, i) => i % Math.max(1, Math.ceil(l.length / 300)) === 0), uptime: up, outages: C.net.outages.filter(o => o.start > Date.now() - 7 * day) }); }
    if (p === '/api/extra/wake' && m === 'POST') { const b = await readBody(req) || {}, wk = C.wakes.find(x => x.id === b.id) || C.wakes[0]; if (!wk) return send(res, 404, { error: 'aucun réveil' }); if (b.stop) { delete running[wk.id]; return send(res, 200, { ok: true }); } wakeRun(wk, b.by || 'manuel'); return send(res, 200, { ok: true }); }
    if (p === '/api/extra/mode' && m === 'POST') { const b = await readBody(req) || {}, sc = P && (P.scenes || []).find(x => x.id === b.id); if (!sc) return send(res, 404, { error: 'scène inconnue' }); modeRun(sc); return send(res, 200, { ok: true, dnd: C.dnd }); }
    if (p === '/api/extra/dnd' && m === 'POST') { const b = await readBody(req) || {}; C.dnd = +b.hours ? Date.now() + +b.hours * 36e5 : 0; persist(); X.emit({ type: 'dnd', until: C.dnd }); return send(res, 200, { dnd: C.dnd }); }
    if (p === '/api/extra/morning' && m === 'GET') { const [tr, tp, wl] = await Promise.all([traffic(), transit(), weatherLine()]); const today = X.ymd(new Date()); return send(res, 200, { traffic: tr, transit: tp.filter(x => x.err || x.at > Date.now() - 60000).slice(0, 12), weather: wl, trash: (await X.trashDays(2)), tempo: X.S.tempo, reminders: C.reminders.filter(r => r.on !== false && nextDue(r) <= today).map(r => r.name), dnd: C.dnd }); }
    if (p === '/api/extra/transit/near' && m === 'GET') { try { return send(res, 200, await nearStops(url.searchParams.get('src') === 'sncf' ? 'sncf' : 'cts')); } catch (e) { return send(res, 502, { error: e.message }); } }
    if (p === '/api/extra/tablets' && m === 'GET') return send(res, 200, await tabletsList());
    if (p === '/api/extra/announce' && m === 'POST') { const b = await readBody(req) || {}; try { const n = await announce(Object.assign({ by: w && w.name }, b)); return send(res, 200, { ok: true, n }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/extra/reminder/done' && m === 'POST') { const b = await readBody(req) || {}, r = C.reminders.find(x => x.id === b.id); if (!r) return send(res, 404, { error: 'rappel inconnu' }); r.last = b.date || X.ymd(new Date()); r.notified = ''; persist(); return send(res, 200, { reminders: C.reminders.map(x => Object.assign({ next: nextDue(x) }, x)) }); }
    if (p === '/api/extra/reminders' && m === 'GET') return send(res, 200, C.reminders.map(x => Object.assign({ next: nextDue(x) }, x)));
    if (p === '/api/extra/admin' && m === 'GET') return send(res, 200, admin());
    return false;
  }
  // Siri : « réveille-moi en douceur », « ne pas déranger », « annonce à la cuisine »
  X.EXT.quick = (what, q) => {
    if (what === 'wake') { const wk = C.wakes.find(x => x.id === q('id')) || C.wakes.find(x => !q('who') || x.who === q('who')) || C.wakes[0]; if (!wk) throw new Error('aucun réveil configuré'); wakeRun(wk, 'Siri'); return { ok: true, say: 'Réveil en douceur lancé.' }; }
    if (what === 'announce') { announce({ text: q('text'), to: q('to') ? Object.keys(C.tablets).filter(ip => (C.tablets[ip].name || '').toLowerCase().includes(q('to').toLowerCase()) || (C.tablets[ip].room || '').toLowerCase().includes(q('to').toLowerCase())) : 'all', by: 'Siri' }); return { ok: true, say: 'Annonce envoyée.' }; }
    if (what === 'dnd') { C.dnd = Date.now() + (+q('hours') || 2) * 36e5; persist(); return { ok: true, say: 'Ne pas déranger pendant ' + (+q('hours') || 2) + ' heures.' }; }
    if (what === 'guest') { guestSet(q('on') !== '0', C.guest.hours).catch(() => { }); return { ok: true, say: 'Wi-Fi invités ' + (q('on') !== '0' ? 'allumé.' : 'coupé.') }; }
    return null;
  };
  return { api, _test: { kidWant, nextDue, greeting, guestInfo, C, admin, NET } };
};
