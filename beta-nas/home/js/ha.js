/* Bêta home — Home Assistant : temps réel (WebSocket), assistant d'association, caméras en direct, énergie réelle,
   pièces et appareils personnalisés. Tout reste facultatif : sans Home Assistant, la maison fonctionne en démo. */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev } = B, HA = B.HA;

  /* ---------- petit bus d'événements ---------- */
  const BUS = {};
  B.on = (n, fn) => (BUS[n] = BUS[n] || []).push(fn);
  B.fire = (n, d) => (BUS[n] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });

  if (!S.custom) S.custom = { rooms: [], devices: [], hidden: {} };

  /* ---------- états & application aux appareils ---------- */
  HA.states = {};
  const camEntity = cid => (S.settings.haMap && S.settings.haMap[cid]) || (DATA.CAMS[cid] && DATA.CAMS[cid].ha) || '';
  HA.camEntity = camEntity;
  HA.applyDev = function (id, s) {
    if (!s) return;
    const d = DATA.DEVICES[id], cur = dev(id), p = {};
    if (d.type === 'cover') { const pos = s.attributes.current_position; p.pos = pos != null ? pos : (s.state === 'open' ? 100 : 0); }
    else if (d.type === 'clim') { p.on = s.state !== 'off'; if (s.attributes.temperature != null) p.temp = s.attributes.temperature; }
    else if (d.type === 'vacuum') { p.status = s.state === 'cleaning' ? 'cleaning' : s.state === 'returning' ? 'returning' : 'docked'; if (s.attributes.battery_level != null) p.bat = s.attributes.battery_level; }
    else if (d.type === 'mower') { p.status = s.state === 'mowing' ? 'mowing' : 'docked'; }
    else {
      p.on = ['on', 'playing', 'heat', 'open', 'charging', 'cool', 'auto', 'heat_cool'].includes(s.state);
      if (d.type === 'light' && s.attributes.rgb_color && cur.rgb) p.color = '#' + s.attributes.rgb_color.map(v => ('0' + v.toString(16)).slice(-2)).join('');
    }
    if (Object.keys(p).some(k => cur[k] !== p[k])) { B.src = 'ha'; setDev(id, p, { silent: true }); B.src = null; }
  };
  HA.camUrl = function (cid, stream) {
    const e = camEntity(cid), s = this.states[e]; if (!s) return '';
    const base = this.cfg().url, tok = s.attributes.access_token;
    if (!tok) return s.attributes.entity_picture ? base + s.attributes.entity_picture : '';
    return base + '/api/camera_proxy' + (stream ? '_stream' : '') + '/' + e + '?token=' + tok + (stream ? '' : '&t=' + Math.floor(Date.now() / 10000));
  };
  HA.applyAll = function () {
    for (const id in DATA.DEVICES) this.applyDev(id, this.states[this.entity(id)]);
    for (const cid in DATA.CAMS) { const u = this.camUrl(cid); if (u) { B.camState(cid).live = u; B.emit('cam:' + cid); } }
    B.emit('energy'); B.emit('ha');
  };
  HA.sync = async function () {
    if (!this.enabled() || this.wsOk) return;
    try {
      const list = await this.req('/api/states');
      this.states = {}; list.forEach(s => this.states[s.entity_id] = s);
      this.online = true; this.lastError = '';
      this.applyAll();
      if (!this.ws) this.connect();
    } catch (e) { this.online = false; this.lastError = e.message === 'Failed to fetch' ? 'injoignable ou CORS' : e.message; B.emit('ha'); }
  };

  /* ---------- temps réel : WebSocket Home Assistant ---------- */
  HA.connect = function () {
    if (!this.enabled() || this.ws) return;
    const c = this.cfg();
    let ws;
    try { ws = new WebSocket(c.url.replace(/^http/i, 'ws') + '/api/websocket'); } catch (e) { return; }
    this.ws = ws; this.wsId = 1; this.wsWait = {};
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: c.token }));
      else if (m.type === 'auth_ok') { this.wsOk = true; this.online = true; this.wsSend({ type: 'subscribe_events', event_type: 'state_changed' }).catch(() => { }); B.emit('ha'); }
      else if (m.type === 'auth_invalid') { this.lastError = 'jeton refusé'; ws.close(); }
      else if (m.type === 'event' && m.event && m.event.event_type === 'state_changed') { const d = m.event.data; this.onChange(d.entity_id, d.old_state, d.new_state); }
      else if (m.type === 'result' && this.wsWait[m.id]) { const w = this.wsWait[m.id]; delete this.wsWait[m.id]; m.success ? w.res(m.result) : w.rej(new Error((m.error && m.error.message) || 'erreur')); }
    };
    ws.onclose = () => { this.ws = null; this.wsOk = false; B.emit('ha'); setTimeout(() => { if (this.enabled()) { this.sync(); } }, 5000); };
  };
  HA.wsSend = function (msg) {
    return new Promise((res, rej) => {
      if (!this.ws || !this.wsOk) return rej(new Error('pas de connexion temps réel'));
      const id = ++this.wsId; msg.id = id; this.wsWait[id] = { res, rej };
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => { if (this.wsWait[id]) { delete this.wsWait[id]; rej(new Error('délai dépassé')); } }, 15000);
    });
  };
  HA.onChange = function (eid, old, s) {
    if (!s) return;
    this.states[eid] = s;
    B.fire('state', { eid, s, old });
    for (const id in DATA.DEVICES) if (this.entity(id) === eid) this.applyDev(id, s);
    for (const cid in DATA.CAMS) if (camEntity(cid) === eid) { B.camState(cid).live = this.camUrl(cid); B.emit('cam:' + cid); }
    const st = S.settings;
    // sonnette : capteur binaire qui passe à « on » ou entité « event.* » qui change
    if (st.haDoorbell === eid && ((s.state === 'on' && (!old || old.state !== 'on')) || (eid.startsWith('event.') && old && old.state !== s.state))) B.fire('doorbell', eid);
    // détecteurs de mouvement liés aux caméras
    Object.keys(st.haMotion || {}).forEach(cid => { if (st.haMotion[cid] === eid && s.state === 'on' && (!old || old.state !== 'on')) B.fire('motion', cid); });
    if (Object.values(st.haEnergy || {}).includes(eid)) B.emit('energy');
    if (st.haAlert === eid) B.emit('weather');
  };
  // rafraîchit les images des caméras toutes les 10 s quand Home Assistant est relié
  setInterval(() => { if (HA.online) for (const cid in DATA.CAMS) { const u = HA.camUrl(cid); if (u) { B.camState(cid).live = u; B.emit('cam:' + cid); } } }, 10000);

  /* événements caméra → interface */
  B.on('motion', cid => { B.camState(cid).ev = { type: 'motion', ago: 0 }; B.save(); B.emit('cam:' + cid); B.emit('house'); });

  /* ---------- assistant d'association ---------- */
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const STOP = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'l', 'd', 'et', 'eclairage', 'lumiere', 'light', 'switch', 'the']);
  const toks = s => norm(s).split(' ').filter(t => t && !STOP.has(t));
  const DOMS = { light: ['light', 'switch'], group: ['light', 'switch'], cover: ['cover'], clim: ['climate'], power: ['media_player', 'switch', 'remote'], app: ['switch', 'binary_sensor', 'sensor'], vacuum: ['vacuum'], mower: ['lawn_mower', 'vacuum', 'switch'], sprinkler: ['switch', 'valve'], charger: ['switch', 'sensor'] };
  function score(want, ent, cur) {
    const a = toks(want), b = new Set(toks(ent.name + ' ' + ent.id.split('.')[1].replace(/_/g, ' ')));
    let sc = 0; a.forEach(t => { if (b.has(t)) sc += 2; else if ([...b].some(x => x.length > 3 && (x.startsWith(t.slice(0, 4)) || t.startsWith(x.slice(0, 4))))) sc += 1; });
    if (ent.id === cur) sc += .5;
    return sc;
  }
  function candidates(ents, doms, want, cur) {
    return ents.filter(e => doms.includes(e.dom)).map(e => Object.assign({ sc: score(want, e, cur) }, e)).sort((x, y) => y.sc - x.sc || (doms.indexOf(x.dom) - doms.indexOf(y.dom)));
  }
  function select(name, list, cur, best) {
    const has = list.some(e => e.id === cur);
    return '<select name="' + esc(name) + '" data-best="' + esc(best || '') + '"><option value="">— non relié —</option>' + (cur && !has ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (introuvable)</option>' : '') +
      list.slice(0, 40).map(e => '<option value="' + esc(e.id) + '"' + (e.id === cur ? ' selected' : '') + '>' + esc(e.name) + ' · ' + esc(e.id) + '</option>').join('') + '</select>';
  }
  HA.wizard = async function () {
    if (!this.enabled()) return B.toast('Renseignez d’abord l’adresse et le jeton de Home Assistant', 'info');
    B.modal('<h2>' + ico('homeFill') + 'Relier les appareils</h2><p class="muted">Lecture de vos appareils Home Assistant…</p>', 'wide');
    let list;
    try { list = await this.req('/api/states'); } catch (e) { B.closeModal(); return B.toast('Home Assistant ne répond pas (' + (e.message === 'Failed to fetch' ? 'réseau ou CORS' : e.message) + ')', 'info'); }
    list.forEach(s => this.states[s.entity_id] = s);
    const ents = list.map(s => ({ id: s.entity_id, dom: s.entity_id.split('.')[0], name: s.attributes.friendly_name || s.entity_id, unit: s.attributes.unit_of_measurement || '', dc: s.attributes.device_class || '' }));
    const map = S.settings.haMap || {};
    const rows = Object.values(DATA.DEVICES).filter(d => !S.custom.hidden[d.id]).map(d => {
      const cur = map[d.id] || (this.states[d.ha] ? d.ha : ''), c = candidates(ents, DOMS[d.type] || ['switch'], d.room + ' ' + d.name, cur);
      return '<label class="field wz"><span>' + esc(d.room) + ' · <b>' + esc(d.name) + '</b></span>' + select(d.id, c, cur, c[0] && c[0].sc >= 2 ? c[0].id : '') + '</label>';
    }).join('');
    const camRows = Object.keys(DATA.CAMS).map(cid => {
      const c = DATA.CAMS[cid], cur = map[cid] || (this.states[c.ha] ? c.ha : ''), cc = candidates(ents, ['camera'], c.name, cur);
      const mcur = (S.settings.haMotion || {})[cid] || '', mc = candidates(ents.filter(e => e.dom === 'binary_sensor' && /motion|occupancy|presence|mouvement/.test(e.dc + ' ' + norm(e.name) + e.id)), ['binary_sensor'], c.name + ' mouvement', mcur);
      return '<label class="field wz"><span>Caméra · <b>' + esc(c.name) + '</b></span>' + select(cid, cc, cur, cc[0] && cc[0].sc >= 2 ? cc[0].id : '') + '</label>' +
        '<label class="field wz"><span>Détecteur de mouvement · ' + esc(c.name) + '</span>' + select('motion:' + cid, mc, mcur, mc[0] && mc[0].sc >= 2 ? mc[0].id : '') + '</label>';
    }).join('');
    const sens = (re, units) => ents.filter(e => e.dom === 'sensor' && (units ? units.includes(e.unit) : true) && (!re || re.test(norm(e.name) + ' ' + e.id + ' ' + e.dc)));
    const en = S.settings.haEnergy || {};
    const pick = (k, label, list, want) => { const c = list.map(e => Object.assign({ sc: score(want, e, en[k]) }, e)).sort((a, b) => b.sc - a.sc); return '<label class="field wz"><span>' + label + '</span>' + select('energy:' + k, c, en[k] || '', c[0] && c[0].sc >= 2 ? c[0].id : '') + '</label>'; };
    const bell = ents.filter(e => (e.dom === 'binary_sensor' || e.dom === 'event') && /sonnette|doorbell|ring|bell|carillon/.test(norm(e.name) + e.id + e.dc));
    const alerts = ents.filter(e => e.dom === 'sensor' && /alert|vigilance|weather_alert/.test(e.id + norm(e.name)));
    B.modal('<h2>' + ico('homeFill') + 'Relier les appareils à Home Assistant</h2><p class="muted" style="margin:-6px 0 12px;font-size:13px">' + list.length + ' entités trouvées. « Associer automatiquement » choisit l’entité au nom le plus proche ; vérifiez puis enregistrez.</p>' +
      '<form data-submit="haWizardSave"><div class="wzgrid scroll">' +
      '<h4>Appareils</h4>' + rows + '<h4>Caméras</h4>' + camRows +
      '<h4>Sonnette</h4><label class="field wz"><span>Capteur ou événement de la sonnette</span>' + select('doorbell', bell.length ? bell : ents.filter(e => e.dom === 'binary_sensor' || e.dom === 'event'), S.settings.haDoorbell || '', bell[0] ? bell[0].id : '') + '</label>' +
      '<h4>Énergie</h4>' + pick('cons', 'Consommation de la maison (W)', sens(null, ['W', 'kW']), 'consommation maison puissance power house') + pick('solar', 'Production solaire (W)', sens(null, ['W', 'kW']), 'solaire production pv solar onduleur') +
      pick('battery', 'Batterie (%)', sens(/batt/, ['%']), 'batterie battery soc') + pick('consTotal', 'Énergie consommée (kWh, compteur)', sens(null, ['kWh', 'Wh']), 'linky consommation energie total import') + pick('solarTotal', 'Énergie produite (kWh, compteur)', sens(null, ['kWh', 'Wh']), 'solaire production energie total pv') +
      '<h4>Météo-France</h4><label class="field wz"><span>Vigilance (intégration Météo-France)</span>' + select('alert', alerts, S.settings.haAlert || '', alerts[0] ? alerts[0].id : '') + '</label>' +
      '</div><div class="row" style="justify-content:space-between;margin-top:14px;flex-wrap:wrap"><button type="button" class="btn" data-act="haWizardAuto">' + ico('sparkle') + 'Associer automatiquement</button><span class="row"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></span></div></form>', 'wide');
  };
  B.act('haWizard', () => HA.wizard());
  B.act('haWizardAuto', el => {
    let n = 0;
    el.closest('form').querySelectorAll('select[data-best]').forEach(s => { if (!s.value && s.dataset.best) { s.value = s.dataset.best; n++; } });
    B.toast(n ? n + ' association' + (n > 1 ? 's' : '') + ' proposée' + (n > 1 ? 's' : '') + ' — vérifiez puis enregistrez' : 'Rien de plus à associer automatiquement', 'sparkle');
  });
  B.act('haWizardSave', el => {
    const f = new FormData(el), map = {}, motion = {}, energy = {};
    for (const [k, v] of f.entries()) {
      if (k.startsWith('motion:')) { if (v) motion[k.slice(7)] = v; }
      else if (k.startsWith('energy:')) { if (v) energy[k.slice(7)] = v; }
      else if (k === 'doorbell') S.settings.haDoorbell = v;
      else if (k === 'alert') S.settings.haAlert = v;
      else map[k] = v || '-';
    }
    S.settings.haMap = map; S.settings.haMotion = motion; S.settings.haEnergy = energy;
    B.save(); B.closeModal(); HA.applyAll(); B.toast('Appareils reliés à Home Assistant', 'check');
  });
  // « - » = volontairement non relié
  const ent0 = HA.entity.bind(HA);
  HA.entity = id => { const v = ent0(id); return v === '-' ? '' : v; };

  /* ---------- énergie : valeurs réelles si les capteurs sont reliés ---------- */
  const E = {
    cache: {},
    real() { const e = S.settings.haEnergy || {}; return HA.online && !!(e.cons || e.solar); },
    num(k) { const e = (S.settings.haEnergy || {})[k], s = e && HA.states[e]; if (!s || isNaN(parseFloat(s.state))) return null; const v = parseFloat(s.state), u = s.attributes.unit_of_measurement; return u === 'W' || u === 'Wh' ? v / 1000 : v; },
    live() {
      const h = B.house(), r = this.real();
      const cons = r && this.num('cons') != null ? this.num('cons') : h.kw;
      const solar = r && this.num('solar') != null ? this.num('solar') : B.solarNow();
      const bat = r && this.num('battery') != null ? this.num('battery') : 76;
      return { cons, solar, bat, real: r };
    },
    demoDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5), k = d.getDate() * 7 + d.getMonth() * 3; out.push({ d, prod: 8 + (k % 11) + 6 * Math.sin(d.getDate() / 3), cons: 11 + (k % 7) + 2 * Math.cos(d.getDate() / 2) }); } return out; },
    async load(view) {
      const key = view, e = S.settings.haEnergy || {};
      if (!this.real()) return;
      try {
        if (view === 'jour') {
          const start = new Date(); start.setHours(0, 0, 0, 0);
          const ids = [e.cons, e.solar].filter(Boolean).join(',');
          const h = await HA.req('/api/history/period/' + start.toISOString() + '?minimal_response&no_attributes&filter_entity_id=' + ids);
          const hourly = id => { const arr = Array(24).fill(null), cnt = Array(24).fill(0), ser = h.find(x => x[0] && x[0].entity_id === id) || []; const unitW = (HA.states[id] && HA.states[id].attributes.unit_of_measurement) === 'W'; ser.forEach(p => { const v = parseFloat(p.state); if (isNaN(v)) return; const i = new Date(p.last_changed).getHours(); arr[i] = (arr[i] || 0) + (unitW ? v / 1000 : v); cnt[i]++; }); return arr.map((v, i) => cnt[i] ? v / cnt[i] : null); };
          this.cache.jour = { cons: e.cons ? hourly(e.cons) : null, prod: e.solar ? hourly(e.solar) : null };
        } else {
          const n = view === 'semaine' ? 7 : 30, start = new Date(Date.now() - (n - 1) * 864e5); start.setHours(0, 0, 0, 0);
          const ids = [e.consTotal, e.solarTotal].filter(Boolean);
          if (!ids.length) return;
          const r = await HA.wsSend({ type: 'recorder/statistics_during_period', start_time: start.toISOString(), period: 'day', statistic_ids: ids, types: ['change'], units: { energy: 'kWh' } });
          const days = []; for (let i = 0; i < n; i++) days.push({ d: new Date(+start + i * 864e5), prod: 0, cons: 0 });
          const put = (id, k) => (r[id] || []).forEach(p => { const d = new Date(p.start), i = Math.round((d - start) / 864e5); if (days[i]) days[i][k] = p.change || 0; });
          if (e.consTotal) put(e.consTotal, 'cons'); if (e.solarTotal) put(e.solarTotal, 'prod');
          this.cache[key] = days;
        }
        B.emit('energy');
      } catch (err) { this.cache.err = err.message; B.emit('energy'); }
    }
  };
  B.Energy = E;

  /* ---------- vigilance météo officielle (via l'intégration Météo-France de Home Assistant) ---------- */
  B.haAlert = () => {
    const id = S.settings.haAlert, s = id && HA.states[id];
    if (!s) return null;
    const lvl = String(s.state).toLowerCase();
    if (/vert|green|aucune|unknown|unavailable/.test(lvl)) return null;
    const kinds = Object.keys(s.attributes).filter(k => /^(vent|pluie|orages|neige|canicule|grand|inondation|vagues|avalanches)/i.test(k) && !/vert/i.test(String(s.attributes[k])));
    return { level: lvl, text: 'Vigilance ' + s.state + (kinds.length ? ' : ' + kinds.map(k => k + ' (' + s.attributes[k] + ')').join(', ') : ''), official: true };
  };
})();
