/* Bêta OS — noyau : état, rendu réactif, scène, routeur, météo, Home Assistant, musique */
(function () {
  const DATA = window.BETA_DATA;
  const KEY = 'betaos.v5';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- dates ---------- */
  const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const F = {
    time: d => pad(d.getHours()) + ':' + pad(d.getMinutes()),
    long: d => JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(),
    short: d => JOURS[d.getDay()].slice(0, 3) + '. ' + d.getDate() + ' ' + ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'][d.getMonth()] + ' ' + d.getFullYear(),
    dayMonth: d => JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()],
    d3: d => JOURS[d.getDay()].slice(0, 3),
    ymd, JOURS, MOIS
  };

  /* ---------- état persistant ---------- */
  function defaultEvents() {
    const t = new Date(), tm = new Date(Date.now() + 864e5);
    return [
      { id: 'e1', date: ymd(t), time: '08:00', dur: 60, title: 'Réunion équipe', color: '#1f7dff' },
      { id: 'e2', date: ymd(t), time: '12:30', dur: 60, title: 'Déjeuner', color: '#ff8a34' },
      { id: 'e3', date: ymd(t), time: '15:00', dur: 60, title: 'Suivi projet', color: '#22d3ee' },
      { id: 'e4', date: ymd(t), time: '19:00', dur: 60, title: 'Sport', color: '#5ee7ff' },
      { id: 'e5', date: ymd(tm), time: '09:30', dur: 60, title: 'Dentiste Léo', color: '#ff5fae' },
      { id: 'e6', date: ymd(tm), time: '18:00', dur: 90, title: 'Réunion parents', color: '#9b6bff' }
    ];
  }
  function defaults() {
    return {
      v: 5,
      user: 'bastien',
      users: JSON.parse(JSON.stringify(DATA.USERS)),
      dev: {},
      cams: {},
      events: defaultEvents(),
      mails: JSON.parse(JSON.stringify(DATA.MAILS)),
      playlists: JSON.parse(JSON.stringify(DATA.PLAYLISTS)),
      favs: ['lofi', 'r-fip'],
      music: { src: 'chill', vol: 50, out: 'tv', zone: 'Suite parentale', zoneVol: 79, power: true, tab: 'plex' },
      plexCat: 'recent',
      chat: [],
      settings: { city: 'Strasbourg', lat: 48.5734, lon: 7.7521, haUrl: '', haToken: '', haMap: {}, plexUrl: 'https://app.plex.tv/desktop', nasUrl: '', guest: true }
    };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
  if (!S || S.v !== 5) S = defaults();
  const base = defaults();
  for (const k in base) if (!(k in S)) S[k] = base[k];
  for (const k in base.settings) if (!(k in S.settings)) S.settings[k] = base.settings[k];
  // migrations légères entre versions
  DATA.MAILS.forEach(dm => { const m = S.mails.find(x => x.id === dm.id); if (m && dm.invite && !m.invite) m.invite = dm.invite; });
  let saveT;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }, 120); }

  function dev(id) {
    const d = DATA.DEVICES[id];
    if (!S.dev[id]) S.dev[id] = Object.assign({}, d ? d.def : {});
    return S.dev[id];
  }
  function setDev(id, patch, opts) {
    Object.assign(dev(id), patch);
    save();
    emit('dev:' + id);
    emit('house');
    if (!(opts && opts.silent)) HA.push(id, patch);
    if (window.BOS && window.BOS.fire) window.BOS.fire('dev', { id, patch, silent: !!(opts && opts.silent) });
  }
  function user(id) {
    const k = id || S.user;
    if (k === 'guest') return { id: 'guest', name: 'Invité', avatar: '', ring: '#93a8cc', bat: 100, place: 'home' };
    return S.users.find(u => u.id === k) || S.users[0];
  }

  /* ---------- rendu réactif : tuiles enregistrées ---------- */
  const REG = new Map();
  let uid = 0;
  const RENDER = {};
  function keysOf(spec) { return spec.keys || (spec.id ? ['dev:' + spec.id] : []); }
  function paint(spec, id) {
    let html = RENDER[spec.t](spec).trim();
    // une tuile doit avoir un seul élément racine pour pouvoir être redessinée : sinon on l'enveloppe
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    if (tpl.content.childNodes.length !== 1 || tpl.content.firstChild.nodeType !== 1) html = '<div class="tw">' + html + '</div>';
    return html.replace(/^<([a-zA-Z0-9]+)/, '<$1 data-tile="' + id + '" data-keys="' + keysOf(spec).join(' ') + '"');
  }
  function T(spec) { const id = 't' + (++uid); REG.set(id, spec); return paint(spec, id); }
  function emit(key) {
    $$('[data-keys~="' + key + '"]').forEach(el => {
      const spec = REG.get(el.dataset.tile);
      if (!spec) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = paint(spec, el.dataset.tile);
      el.replaceWith(tmp.firstElementChild);
    });
  }

  /* ---------- scène : mise à l'échelle ---------- */
  let stageW = 1536, stageH = 1024;
  function fit() {
    const st = $('.stage'); if (!st) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const fluid = vw < 760 || (vh > vw * 1.05 && vw < 1000);
    document.documentElement.classList.toggle('fluid', fluid);
    if (fluid) { st.style.transform = ''; st.style.width = ''; st.style.height = ''; return; }
    st.style.width = stageW + 'px'; st.style.height = stageH + 'px';
    const s = Math.min(vw / stageW, vh / stageH);
    st.style.transform = 'translate(' + ((vw - stageW * s) / 2) + 'px,' + ((vh - stageH * s) / 2) + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));

  /* ---------- routeur ---------- */
  const ROUTES = {};
  let current = null;
  function route(name, def) { ROUTES[name] = def; }
  function go(name) { if (location.hash !== '#' + name) location.hash = name; else show(); }
  function show() {
    let name = (location.hash || '').slice(1) || 'verrou';
    if (!ROUTES[name]) name = 'accueil';
    if (name !== 'verrou' && !sessionStorage.getItem('betaos.unlocked') && !S.settings.skipLock) name = 'verrou';
    const r = ROUTES[name];
    REG.clear(); uid = 0;
    stageW = r.w || 1536; stageH = r.h || 1024;
    const st = $('.stage');
    const bg = 'url("' + new URL(r.bg, location.href).href + '")';
    st.style.setProperty('--bg', bg);
    $('.backdrop').style.setProperty('--bg', bg);
    st.innerHTML = '<div class="page enter">' + r.render() + '</div>';
    document.title = (r.title || 'Bêta OS') + ' · Bêta OS';
    current = name;
    fit();
    if (r.after) r.after();
    st.scrollTop = 0; window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show);

  /* ---------- actions (délégation) ---------- */
  const ACT = {};
  function act(name, fn) { ACT[name] = fn; }
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-input]');
    if (el && ACT[el.dataset.input]) ACT[el.dataset.input](el, e);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && ACT[el.dataset.change]) ACT[el.dataset.change](el, e);
  });
  document.addEventListener('submit', e => {
    const el = e.target.closest('[data-submit]');
    if (el && ACT[el.dataset.submit]) { e.preventDefault(); ACT[el.dataset.submit](el, e); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act]:not(button):not(a):not(input)')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------- toasts, modales, popovers ---------- */
  function toast(msg, icon) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = ico(icon || 'check') + '<span>' + esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(() => t.remove(), 3300);
  }
  function modal(html, cls) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="box card ' + (cls || '') + '" role="dialog" aria-modal="true"><button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + html + '</div>';
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  /* notification avec actions (ex. « Ajouter à l'agenda ») */
  function notify(o) {
    let box = $('.notifs');
    if (!box) { box = document.createElement('div'); box.className = 'notifs'; document.body.appendChild(box); }
    const n = document.createElement('div');
    n.className = 'notify card'; if (o.mail) n.dataset.mail = o.mail;
    n.innerHTML = (window.BOS.badge ? window.BOS.badge(o.badge || 'mail') : '') + '<div class="nt"><b>' + esc(o.title) + '</b><span>' + (o.text || '') + '</span><div class="row">' +
      (o.actions || []).map(a => '<button class="btn sm ' + (a[3] || '') + '" data-act="' + a[1] + '" data-arg="' + esc(a[2] || '') + '">' + esc(a[0]) + '</button>').join('') + '</div></div><button class="x2" data-act="notifyClose" aria-label="Fermer">' + ico('x') + '</button>';
    box.appendChild(n);
    setTimeout(() => n.remove(), o.ttl || 20000);
    return n;
  }
  act('notifyClose', el => { const n = el.closest('.notify'); if (n) n.remove(); });
  function closeModal() { $$('.modal, .pop').forEach(m => m.remove()); }
  act('closeModal', closeModal);
  function popover(anchor, html) {
    $$('.pop').forEach(p => p.remove());
    const p = document.createElement('div');
    p.className = 'pop card';
    p.innerHTML = html;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    const w = p.offsetWidth, h = p.offsetHeight;
    let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let y = r.bottom + 8; if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    p.style.left = x + 'px'; p.style.top = y + 'px';
    setTimeout(() => document.addEventListener('click', function off(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('click', off, true); } }, true));
    return p;
  }

  /* ---------- horloge ---------- */
  function tick() { emit('clock'); }
  let lastMin = -1;
  setInterval(() => { const m = new Date().getMinutes(); if (m !== lastMin) { lastMin = m; tick(); } }, 1000);

  /* ---------- météo (Open-Meteo, sans clé) ---------- */
  const WX = {
    ok: false,
    now: { temp: 12, code: 0, day: 0, wind: 28, rain: 0, uv: 0, feel: 9 },
    days: [{ max: 16, min: 7, code: 0 }, { max: 18, min: 8, code: 0 }, { max: 17, min: 9, code: 0 }, { max: 16, min: 8, code: 2 }],
    t0: new Date(),
    hours: Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.now() + i * 36e5), temp: 12 - Math.sin(i / 4) * 3, prob: i > 14 && i < 19 ? 40 + i : 5, mm: i > 15 && i < 18 ? .6 : 0, gust: 30, code: 0 })),
    sun: (() => { const r = new Date(); r.setHours(7, 52, 0, 0); const s = new Date(); s.setHours(18, 31, 0, 0); return { rise: r, set: s }; })()
  };
  /* alertes calculées d'après les prévisions (la vigilance officielle passe par Home Assistant / Météo-France) */
  function wxAlerts() {
    const out = [], H = WX.hours.slice(0, 24);
    const mx = k => Math.max(...H.map(x => x[k]));
    if (mx('gust') >= 70) out.push({ icon: 'wind', text: 'Rafales jusqu’à ' + Math.round(mx('gust')) + ' km/h' });
    if (mx('mm') >= 4) out.push({ icon: 'rain', text: 'Fortes pluies (' + mx('mm').toFixed(1).replace('.', ',') + ' mm/h)' });
    if (H.some(x => x.code >= 95)) out.push({ icon: 'storm', text: 'Orages prévus' });
    if (mx('temp') >= 33) out.push({ icon: 'sun', text: 'Fortes chaleurs (' + Math.round(mx('temp')) + ' °C)' });
    if (Math.min(...H.map(x => x.temp)) <= 0) out.push({ icon: 'snow', text: 'Gel possible (' + Math.round(Math.min(...H.map(x => x.temp))) + ' °C)' });
    return out;
  }
  function rainSoon(hours) { const H = WX.hours.slice(0, hours || 6); return { prob: Math.max(0, ...H.map(x => x.prob)), mm: H.reduce((a, x) => a + x.mm, 0) }; }
  const WMO = {
    0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante',
    71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige', 80: 'Averses', 81: 'Averses', 82: 'Fortes averses',
    85: 'Averses de neige', 86: 'Averses de neige', 95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle'
  };
  function wxIcon(code, night) {
    if (code === 0 || code === 1) return night ? 'moon' : 'sun';
    if (code === 2) return night ? 'moon' : 'sun';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'snowCloud';
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'cloud';
  }
  function wxText(code) { return WMO[code] || 'Ciel dégagé'; }
  function isNight() { const h = new Date().getHours(); return WX.ok ? !WX.now.day : (h < 7 || h >= 20); }
  async function loadWeather() {
    const s = S.settings;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + s.lat + '&longitude=' + s.lon +
      '&timezone=auto&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,precipitation_probability,uv_index' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,wind_gusts_10m,weather_code&forecast_hours=36' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum&forecast_days=5';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw 0;
      const j = await r.json();
      const c = j.current;
      WX.now = { temp: Math.round(c.temperature_2m), code: c.weather_code, day: c.is_day, wind: Math.round(c.wind_speed_10m), rain: Math.round(c.precipitation_probability || 0), uv: Math.round(c.uv_index || 0), feel: Math.round(c.apparent_temperature) };
      WX.at = Date.now();
      WX.days = j.daily.time.slice(1, 5).map((t, i) => ({ max: Math.round(j.daily.temperature_2m_max[i + 1]), min: Math.round(j.daily.temperature_2m_min[i + 1]), code: j.daily.weather_code[i + 1] }));
      WX.tomorrow = { max: Math.round(j.daily.temperature_2m_max[1]), min: Math.round(j.daily.temperature_2m_min[1]), code: j.daily.weather_code[1] };
      const h = j.hourly, now = Date.now();
      WX.hours = h.time.map((t, i) => ({ t: new Date(t), temp: h.temperature_2m[i], prob: h.precipitation_probability[i] || 0, mm: h.precipitation[i] || 0, gust: h.wind_gusts_10m[i] || 0, code: h.weather_code[i] })).filter(x => +x.t > now - 36e5).slice(0, 24);
      WX.sun = { rise: new Date(j.daily.sunrise[0]), set: new Date(j.daily.sunset[0]) };
      WX.ok = true;
      emit('weather');
      if (window.BOS.fire) window.BOS.fire('weather');
    } catch (e) { WX.ok = false; }
  }
  function uvLabel(u) { return u < 3 ? 'Faible' : u < 6 ? 'Modéré' : u < 8 ? 'Élevé' : 'Très élevé'; }

  /* ---------- Home Assistant (optionnel) ---------- */
  const HA = {
    online: false, lastError: '',
    cfg() { return { url: (S.settings.haUrl || '').replace(/\/+$/, ''), token: S.settings.haToken || '' }; },
    enabled() { const c = this.cfg(); return !!(c.url && c.token); },
    entity(id) { return (S.settings.haMap && S.settings.haMap[id]) || (DATA.DEVICES[id] && DATA.DEVICES[id].ha) || ''; },
    async req(path, body) {
      const c = this.cfg();
      const r = await fetch(c.url + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    async call(domain, service, data) {
      if (!this.enabled()) return;
      try { await this.req('/api/services/' + domain + '/' + service, data); this.online = true; }
      catch (e) { this.online = false; this.lastError = e.message; toast('Home Assistant injoignable : ' + e.message, 'info'); }
    },
    push(id, patch) {
      if (!this.enabled()) return;
      const d = DATA.DEVICES[id], e = this.entity(id);
      if (!d || !e) return;
      const dom = e.split('.')[0];
      const st = dev(id);
      if (d.type === 'cover') {
        if ('moving' in patch && patch.moving === 'stop') return this.call('cover', 'stop_cover', { entity_id: e });
        if ('pos' in patch) return this.call('cover', patch.pos >= 100 ? 'open_cover' : patch.pos <= 0 ? 'close_cover' : 'set_cover_position', patch.pos > 0 && patch.pos < 100 ? { entity_id: e, position: patch.pos } : { entity_id: e });
      }
      if (d.type === 'clim' && 'temp' in patch) return this.call('climate', 'set_temperature', { entity_id: e, temperature: patch.temp });
      if (d.type === 'vacuum' && patch.status) return this.call('vacuum', { cleaning: 'start', returning: 'return_to_base', zone: 'clean_spot', docked: 'return_to_base' }[patch.status] || 'start', { entity_id: e });
      if (d.type === 'mower' && patch.status) return this.call('lawn_mower', patch.status === 'mowing' ? 'start_mowing' : 'dock', { entity_id: e });
      if ('on' in patch || 'color' in patch) {
        if (st.on && dom === 'light' && patch.color) {
          const h = patch.color.replace('#', '');
          return this.call('light', 'turn_on', { entity_id: e, rgb_color: [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)) });
        }
        return this.call('homeassistant', st.on ? 'turn_on' : 'turn_off', { entity_id: e });
      }
    },
    async sync() {
      if (!this.enabled()) return;
      try {
        const list = await this.req('/api/states');
        const byId = {}; list.forEach(s => byId[s.entity_id] = s);
        this.online = true;
        for (const id in DATA.DEVICES) {
          const s = byId[this.entity(id)]; if (!s) continue;
          const d = DATA.DEVICES[id], cur = dev(id), p = {};
          if (d.type === 'cover') { const pos = s.attributes.current_position; p.pos = pos != null ? pos : (s.state === 'open' ? 100 : 0); }
          else if (d.type === 'clim') { p.on = s.state !== 'off'; if (s.attributes.temperature != null) p.temp = s.attributes.temperature; }
          else if (d.type === 'vacuum') { p.status = s.state === 'cleaning' ? 'cleaning' : s.state === 'returning' ? 'returning' : 'docked'; if (s.attributes.battery_level != null) p.bat = s.attributes.battery_level; }
          else if (d.type === 'mower') { p.status = s.state === 'mowing' ? 'mowing' : 'docked'; }
          else p.on = s.state === 'on' || s.state === 'playing' || s.state === 'heat' || s.state === 'open';
          if (Object.keys(p).some(k => cur[k] !== p[k])) setDev(id, p, { silent: true });
        }
        for (const cid in DATA.CAMS) {
          const e = (S.settings.haMap && S.settings.haMap[cid]) || DATA.CAMS[cid].ha;
          const s = byId[e];
          if (s && s.attributes.entity_picture) { S.cams[cid] = Object.assign(S.cams[cid] || {}, { live: this.cfg().url + s.attributes.entity_picture }); emit('cam:' + cid); }
        }
        emit('ha');
      } catch (e) { this.online = false; this.lastError = e.message; emit('ha'); }
    }
  };
  setInterval(() => HA.sync(), 15000);

  window.BOS = { S, DATA, $, $$, esc, F, save, dev, setDev, user, T, RENDER, emit, act, ACT, route, ROUTES, go, show, fit, wxAlerts, rainSoon, toast, notify, modal, closeModal, popover, WX, wxIcon, wxText, isNight, uvLabel, loadWeather, HA, ymd, get current() { return current; } };
})();
