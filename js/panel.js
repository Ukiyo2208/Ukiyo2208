/* Bêta home — panneaux flottants « ⋯ » : tous les réglages d'un appareil, historique, graphique des capteurs.
   Les panneaux restent ouverts quand on change de page et se déplacent au doigt. */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev } = B, HA = B.HA;
  const fmt = v => typeof v === 'number' ? String(Math.round(v * 10) / 10).replace('.', ',') : (v == null ? '—' : v);

  /* ---------- Home Assistant : commandes et états des réglages avancés ---------- */
  const HVAC = { Arrêt: 'off', Auto: 'auto', 'Chaud/froid': 'heat_cool', Chaud: 'heat', Froid: 'cool', Sec: 'dry', Ventilation: 'fan_only' }, HVACR = Object.fromEntries(Object.entries(HVAC).map(([a, b]) => [b, a]));
  const PRESET = { Aucun: 'none', Éco: 'eco', Confort: 'comfort', Absent: 'away', Boost: 'boost', Sommeil: 'sleep', Activité: 'activity', Maison: 'home' }, PRESETR = Object.fromEntries(Object.entries(PRESET).map(([a, b]) => [b, a]));
  B.HVAC = HVAC; B.PRESET = PRESET;
  const ALARMSVC = { away: 'alarm_arm_away', night: 'alarm_arm_night', home: 'alarm_arm_home', disarmed: 'alarm_disarm' };
  const push0 = HA.push.bind(HA);
  HA.push = function (id, patch) {
    if (!this.enabled()) return;
    const d = DATA.DEVICES[id], e = this.entity(id); if (!d || !e) return;
    const dom = e.split('.')[0], st = dev(id), c = (s, data) => this.call(dom === 'script' && s === 'turn_on' ? 'script' : s.includes('.') ? s.split('.')[0] : dom, s.includes('.') ? s.split('.')[1] : s, Object.assign({ entity_id: e }, data || {}));
    if (d.type === 'light' && ('bri' in patch || 'ct' in patch || 'effect' in patch)) return c('light.turn_on', Object.assign({}, 'bri' in patch ? { brightness_pct: patch.bri } : {}, 'ct' in patch ? { color_temp_kelvin: patch.ct } : {}, 'effect' in patch && patch.effect !== 'Aucun' ? { effect: patch.effect } : {}));
    if (d.type === 'cover' && 'tilt' in patch) return c('cover.set_cover_tilt_position', { tilt_position: patch.tilt });
    if (d.type === 'clim') {
      if ('hvac' in patch) return c('climate.set_hvac_mode', { hvac_mode: HVAC[patch.hvac] || 'auto' });
      if ('preset' in patch) return c('climate.set_preset_mode', { preset_mode: PRESET[patch.preset] || String(patch.preset).toLowerCase() });
      if ('hum' in patch) return c('climate.set_humidity', { humidity: patch.hum });
      if ('fanm' in patch) return c('climate.set_fan_mode', { fan_mode: String(patch.fanm).toLowerCase() });
      if ('swing' in patch) return c('climate.set_swing_mode', { swing_mode: patch.swing ? 'on' : 'off' });
      if (patch.on === false) return c('climate.turn_off');
    }
    if (d.type === 'media') {
      if ('vol' in patch) return c('media_player.volume_set', { volume_level: patch.vol / 100 });
      if ('mute' in patch) return c('media_player.volume_mute', { is_volume_muted: !!patch.mute });
      if ('src' in patch) return c('media_player.select_source', { source: patch.src });
      if ('cmd' in patch) return c('media_player.' + patch.cmd);
      if ('on' in patch) return c('media_player.' + (patch.on ? 'turn_on' : 'turn_off'));
    }
    if (d.type === 'fan') {
      if ('pct' in patch) return c('fan.set_percentage', { percentage: patch.pct });
      if ('osc' in patch) return c('fan.oscillate', { oscillating: !!patch.osc });
      if ('on' in patch) return c('fan.' + (patch.on ? 'turn_on' : 'turn_off'));
    }
    if (d.type === 'valve' && 'on' in patch) return dom === 'valve' ? c('valve.' + (patch.on ? 'open_valve' : 'close_valve')) : c('homeassistant.' + (patch.on ? 'turn_on' : 'turn_off'));
    if (d.type === 'lock' && 'locked' in patch) return c('lock.' + (patch.locked ? 'lock' : 'unlock'));
    if (d.type === 'alarm' && 'mode' in patch) return c('alarm_control_panel.' + ALARMSVC[patch.mode], st.code ? { code: st.code } : {});
    if (d.type === 'heater') {
      if ('temp' in patch) return c(dom === 'climate' ? 'climate.set_temperature' : 'water_heater.set_temperature', { temperature: patch.temp });
      if ('mode' in patch && dom === 'water_heater') return c('water_heater.set_operation_mode', { operation_mode: ({ 'Éco': 'eco', Confort: 'performance', Boost: 'high_demand', Vacances: 'off' })[patch.mode] || 'eco' });
    }
    if (d.type === 'vacuum') {
      if ('power' in patch) return c('vacuum.set_fan_speed', { fan_speed: patch.power });
      if (patch.cmd === 'pause') return c('vacuum.pause');
    }
    if (d.type === 'scene' && patch.run) return c(dom === 'script' ? 'script.turn_on' : 'scene.turn_on');
    if (['sensor', 'binary'].includes(d.type)) return;
    if (Object.keys(patch).every(k => ['offAt', 'min', 'prog', 'amps', 'cmode', 'fav', 'code', 'trans', 'dir', 'mop', 'favs'].includes(k))) return;
    return push0(id, patch);
  };
  const apply0 = HA.applyDev.bind(HA);
  HA.applyDev = function (id, s) {
    if (!s) return;
    const d = DATA.DEVICES[id], cur = dev(id), a = s.attributes || {}, p = {};
    switch (d.type) {
      case 'sensor': { const v = parseFloat(s.state); p.val = isNaN(v) ? s.state : v; if (a.unit_of_measurement) p.unit = a.unit_of_measurement; break; }
      case 'binary': p.on = s.state === 'on'; break;
      case 'media': p.on = !['off', 'standby', 'unavailable', 'unknown'].includes(s.state); if (a.volume_level != null) p.vol = Math.round(a.volume_level * 100); if (a.source) p.src = a.source; p.title = a.media_title || ''; if (a.source_list) p.srcs = a.source_list; break;
      case 'fan': p.on = s.state === 'on'; if (a.percentage != null) p.pct = a.percentage; if (a.oscillating != null) p.osc = a.oscillating; break;
      case 'valve': p.on = ['open', 'on', 'opening'].includes(s.state); break;
      case 'lock': p.locked = s.state === 'locked'; break;
      case 'alarm': p.mode = ({ armed_away: 'away', armed_night: 'night', armed_home: 'home', disarmed: 'disarmed', triggered: 'triggered' })[s.state] || s.state; break;
      case 'heater': p.on = s.state !== 'off'; if (a.temperature != null) p.temp = a.temperature; break;
      case 'scene': return;
      default:
        apply0(id, s);
        if (d.type === 'light') { if (a.brightness != null) p.bri = Math.round(a.brightness / 2.55); if (a.color_temp_kelvin) p.ct = a.color_temp_kelvin; if (a.effect) p.effect = a.effect; }
        if (d.type === 'cover' && a.current_tilt_position != null) p.tilt = a.current_tilt_position;
        if (d.type === 'clim') {
          if (HVACR[s.state]) p.hvac = HVACR[s.state]; if (a.fan_mode) p.fanm = a.fan_mode; if (a.current_temperature != null) p.cur = a.current_temperature;
          if (a.hvac_modes) p.modes = a.hvac_modes.map(m => HVACR[m]).filter(Boolean); if (a.preset_modes) p.presets = a.preset_modes.map(m => PRESETR[m] || m); if (a.preset_mode) p.preset = PRESETR[a.preset_mode] || a.preset_mode;
          if (a.fan_modes) p.fanms = a.fan_modes; if (a.swing_modes) p.swings = a.swing_modes; if (a.hvac_action) p.action = a.hvac_action;
          if (a.min_temp != null) p.min = a.min_temp; if (a.max_temp != null) p.max = a.max_temp; if (a.target_temp_step) p.step = a.target_temp_step;
          if (a.current_humidity != null) p.curhum = a.current_humidity; if (a.humidity != null) p.hum = a.humidity;
        }
        if (d.type === 'light') { if (a.effect_list) p.effects = a.effect_list; if (a.min_color_temp_kelvin) p.kmin = a.min_color_temp_kelvin; if (a.max_color_temp_kelvin) p.kmax = a.max_color_temp_kelvin; if (a.supported_color_modes) p.cmodes = a.supported_color_modes; }
    }
    if (Object.keys(p).some(k => JSON.stringify(cur[k]) !== JSON.stringify(p[k]))) { B.src = 'ha'; setDev(id, p, { silent: true }); B.src = null; }
  };
  /* alarme Verisure : l'état de l'alarme de la maison suit l'appareil « alarme » */
  B.on('dev', ({ id, patch }) => { const d = DATA.DEVICES[id]; if (d && d.type === 'alarm' && 'mode' in patch) { S.alarm = patch.mode !== 'disarmed'; B.emit('house'); } });
  /* minuteries : extinction programmée */
  setInterval(() => { const now = Date.now(); Object.keys(S.dev).forEach(id => { const st = S.dev[id]; if (st.offAt && st.offAt <= now) { B.src = 'timer'; setDev(id, { on: false, offAt: null }); B.src = null; B.toast('Minuterie : « ' + ((DATA.DEVICES[id] || {}).name || id) + ' » éteint', 'history'); } }); }, 10000);

  /* ---------- contenu du panneau selon le type ---------- */
  const sw = (id, on, k) => '<button class="sw' + (on ? ' on' : '') + '" data-act="' + (k ? 'pset' : 'toggle') + '" data-id="' + id + '"' + (k ? ' data-k="' + k + '" data-v="' + !on + '"' : '') + ' role="switch" aria-checked="' + !!on + '"></button>';
  const row = (label, ctl) => '<div class="prow"><span>' + label + '</span>' + ctl + '</div>';
  const range = (id, k, v, min, max, step, unit) => '<div class="prange"><input type="range" class="range thin" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + v + '" style="--p:' + ((v - min) / (max - min) * 100) + '%" data-id="' + id + '" data-k="' + k + '" data-u="' + (unit || '') + '" data-input="prangeL" data-change="prangeC"><b>' + fmt(+v) + (unit || '') + '</b></div>';
  const chips = (id, k, cur, list) => '<div class="pchips">' + list.map(x => { const v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<button class="cat' + (String(cur) === String(v) ? ' on' : '') + '" data-act="pset" data-id="' + id + '" data-k="' + k + '" data-v="' + esc(v) + '">' + esc(l) + '</button>'; }).join('') + '</div>';
  const timer = (id, st) => row('Minuterie', '<div class="pchips">' + [15, 30, 60, 120].map(m => '<button class="cat" data-act="ptimer" data-id="' + id + '" data-v="' + m + '">' + (m < 60 ? m + ' min' : m / 60 + ' h') + '</button>').join('') + (st.offAt ? '<button class="cat on" data-act="ptimer" data-id="' + id + '" data-v="0">Arrêt dans ' + Math.max(1, Math.round((st.offAt - Date.now()) / 6e4)) + ' min ✕</button>' : '') + '</div>');
  const SW = ['#ffb35c', '#ff9a4a', '#fff2d6', '#ffffff', '#ff4f6d', '#ff5fae', '#c25bff', '#7a6bff', '#2f7dff', '#2ed3ff', '#22e3a4', '#b8ff4a'];
  function controls(id) {
    const d = DATA.DEVICES[id], st = dev(id), k = B.kindOf(d);
    switch (d.type) {
      case 'light': return row('Allumé', sw(id, st.on)) + row('Luminosité', range(id, 'bri', st.bri || 80, 1, 100, 1, ' %')) +
        (d.def.rgb ? '<div class="prow col"><span>Couleur</span><div class="pcol">' + SW.map(c => '<button style="--c:' + c + '" class="' + (c === st.color ? 'sel' : '') + '" data-act="pset" data-id="' + id + '" data-k="color" data-v="' + c + '" aria-label="' + c + '"></button>').join('') + '<input type="color" value="' + (st.color || '#ffb35c') + '" data-id="' + id + '" data-change="pcolor" aria-label="Couleur libre"></div></div>' : '') +
        row('Blanc chaud ↔ froid', range(id, 'ct', st.ct || 3000, 2200, 6500, 100, ' K')) +
        row('Effet', chips(id, 'effect', st.effect || 'Aucun', ['Aucun', 'Respiration', 'Bougie', 'Arc-en-ciel', 'Néon'])) +
        row('Transition', chips(id, 'trans', st.trans || 1, [[0, 'Instant'], [1, '1 s'], [3, '3 s'], [10, '10 s']]));
      case 'group': return row('Allumé', sw(id, st.on)) + row('Lampes allumées', range(id, 'lit', st.lit || st.n, 0, st.n || 4, 1, ' / ' + (st.n || 4)));
      case 'cover': return row('Position', range(id, 'pos', st.pos || 0, 0, 100, 5, ' %')) +
        '<div class="prow"><span>Commandes</span><div class="row" style="gap:6px">' + [['up', 'chevU'], ['stop', 'stop'], ['down', 'chevD']].map(b => '<button class="sq' + (b[0] === 'stop' ? ' stopb' : '') + '" data-act="cover" data-id="' + id + '" data-arg="' + b[0] + '" aria-label="' + b[0] + '">' + ico(b[1]) + '</button>').join('') + '</div></div>' +
        (k === 'cover' ? row('Inclinaison des lames', range(id, 'tilt', st.tilt == null ? 50 : st.tilt, 0, 100, 5, ' %')) : '') +
        row('Position favorite', chips(id, 'pos', '', [[30, '30 %'], [50, 'Mi-hauteur'], [80, '80 %']]));
      case 'clim': return row('Marche', sw(id, st.on)) +
        '<div class="prow"><span>Consigne</span><div class="row" style="gap:8px"><button class="sq" data-act="clim" data-id="' + id + '" data-arg="-0.5" aria-label="Moins">' + ico('minus') + '</button><b class="pbig">' + fmt(st.temp) + ' °C</b><button class="sq" data-act="clim" data-id="' + id + '" data-arg="0.5" aria-label="Plus">' + ico('plus') + '</button></div></div>' +
        (st.cur != null ? row('Température de la pièce', '<b>' + fmt(st.cur) + ' °C</b>') : '') +
        row('Mode', chips(id, 'hvac', st.hvac || st.mode || 'Auto', ['Auto', 'Chaud', 'Froid', 'Sec', 'Ventilation'])) +
        row('Ventilation', chips(id, 'fanm', st.fanm || 'Auto', ['Auto', 'Silence', '1', '2', '3', 'Turbo'])) +
        row('Oscillation', sw(id, st.swing, 'swing')) + timer(id, st);
      case 'media': { const srcs = st.srcs || (k === 'speaker' ? ['Bluetooth', 'AirPlay', 'Spotify', 'Radio', 'Optique'] : ['HDMI 1', 'HDMI 2', 'HDMI 3', 'TNT', 'Netflix', 'YouTube', 'Plex', 'Disney+']);
        return row('Allumé', sw(id, st.on)) + row('Volume', range(id, 'vol', st.vol || 0, 0, 100, 1, ' %')) + row('Muet', sw(id, st.mute, 'mute')) +
          '<div class="prow col"><span>Source</span>' + chips(id, 'src', st.src, srcs) + '</div>' +
          '<div class="prow"><span>Lecture' + (st.title ? ' · ' + esc(st.title) : '') + '</span><div class="transport" style="gap:14px">' + [['media_previous_track', 'prev'], ['media_play_pause', 'play'], ['media_next_track', 'next']].map(b => '<button data-act="pmedia" data-id="' + id + '" data-v="' + b[0] + '" aria-label="' + b[1] + '">' + ico(b[1]) + '</button>').join('') + '</div></div>' + timer(id, st); }
      case 'power': case 'charger': case 'sprinkler':
        return row('Allumé', sw(id, st.on)) + (k === 'computer' ? '<p class="pnote">Allumage à distance par Wake-on-LAN (bouton ou script Home Assistant), extinction par un script sur le PC.</p>' : '') +
          (id === 'ext.borne' ? row('Intensité', range(id, 'amps', st.amps || 16, 6, 32, 1, ' A')) + row('Recharge', chips(id, 'cmode', st.cmode || 'Immédiate', ['Immédiate', 'Heures creuses', 'Solaire'])) : '') +
          (d.type === 'sprinkler' ? row('Durée', chips(id, 'min', st.min || 10, [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']])) : '') +
          row('Consommation', '<b>' + (st.on ? WATT(d) + ' W' : '0 W') + '</b>') + timer(id, st);
      case 'app': return row('En marche', sw(id, st.on)) + row('Programme', chips(id, 'prog', st.prog, d.id === 'rdc.cuisine.dish' ? ['Éco 50°', 'Intensif 70°', 'Rapide 45°', 'Verres 40°'] : ['Coton 40°', 'Coton 60°', 'Synthétique', 'Rapide 30 min', 'Délicat', 'Essorage', 'Normal'])) + timer(id, st);
      case 'fan': return row('Allumé', sw(id, st.on)) + row('Vitesse', range(id, 'pct', st.pct || 50, 0, 100, 10, ' %')) + row('Oscillation', sw(id, st.osc, 'osc')) + row('Sens', chips(id, 'dir', st.dir || 'forward', [['forward', 'Été'], ['reverse', 'Hiver']])) + timer(id, st);
      case 'valve': return row('Ouverte', sw(id, st.on)) + row('Durée', chips(id, 'min', st.min || 10, [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']])) + timer(id, st);
      case 'lock': return '<div class="pbigstate ' + (st.locked ? 'ok' : 'warn') + '">' + ico(st.locked ? 'lock' : 'unlock') + (st.locked ? 'Verrouillée' : 'Déverrouillée') + '</div>' +
        '<div class="row" style="gap:8px;justify-content:center"><button class="btn pri" data-act="pset" data-id="' + id + '" data-k="locked" data-v="true">' + ico('lock') + 'Verrouiller</button><button class="btn" data-act="pset" data-id="' + id + '" data-k="locked" data-v="false">' + ico('unlock') + 'Déverrouiller</button></div>';
      case 'alarm': return '<div class="pbigstate ' + (st.mode === 'disarmed' ? 'warn' : st.mode === 'triggered' ? 'bad' : 'ok') + '">' + ico('shieldCheck') + ({ disarmed: 'Désarmée', away: 'Armée · absent', night: 'Armée · nuit', home: 'Armée · présence', triggered: 'ALARME DÉCLENCHÉE' })[st.mode] + '</div>' +
        chips(id, 'mode', st.mode, [['away', 'Absent'], ['night', 'Nuit'], ['home', 'Présence'], ['disarmed', 'Désarmer']]) +
        '<label class="field" style="margin-top:10px">Code (si votre alarme l’exige)<input type="password" inputmode="numeric" value="' + esc(st.code || '') + '" data-id="' + id + '" data-k="code" data-change="pfield"></label><p class="pnote">Verisure : via l’intégration Verisure de Home Assistant. L’alarme reste maîtresse ; Bêta home envoie seulement les ordres.</p>';
      case 'heater': return row('Marche', sw(id, st.on)) + row('Température', range(id, 'temp', st.temp || 55, 35, 70, 1, ' °C')) + row('Mode', chips(id, 'mode', st.mode, ['Éco', 'Confort', 'Boost', 'Vacances'])) + timer(id, st);
      case 'vacuum': return '<div class="prow"><span>' + ({ docked: 'À la base', cleaning: 'Nettoyage en cours', returning: 'Retour à la base', zone: 'Nettoyage de zone' })[st.status] + ' · ' + (st.bat || 0) + ' %</span><div class="row" style="gap:6px"><button class="sq" data-act="pset" data-id="' + id + '" data-k="status" data-v="cleaning" aria-label="Démarrer">' + ico('play') + '</button><button class="sq" data-act="pset" data-id="' + id + '" data-k="cmd" data-v="pause" aria-label="Pause">' + ico('pause') + '</button><button class="sq" data-act="pset" data-id="' + id + '" data-k="status" data-v="returning" aria-label="Base">' + ico('baseHome') + '</button></div></div>' +
        row('Puissance', chips(id, 'power', st.power || 'Standard', ['Silencieux', 'Standard', 'Turbo', 'Max'])) + row('Serpillière', sw(id, st.mop, 'mop')) +
        '<div class="prow col"><span>Nettoyer une pièce</span><div class="pchips">' + (B.roomsList('rdc') || []).filter(r => r.name !== 'Aspirateur robot').map(r => '<button class="cat" data-act="pset" data-id="' + id + '" data-k="status" data-v="zone">' + esc(r.label) + '</button>').join('') + '</div></div>';
      case 'mower': return row(st.status === 'mowing' ? 'Tonte en cours' : 'À la base · ' + (st.bat || 0) + ' %', '<div class="row" style="gap:6px"><button class="sq" data-act="pset" data-id="' + id + '" data-k="status" data-v="mowing" aria-label="Tondre">' + ico('play') + '</button><button class="sq" data-act="pset" data-id="' + id + '" data-k="status" data-v="docked" aria-label="Base">' + ico('baseHome') + '</button></div>') +
        row('Hauteur de coupe', range(id, 'cut', st.cut || 40, 20, 70, 5, ' mm'));
      case 'sensor': return '<div class="pbigval">' + fmt(st.val) + '<small>' + esc(st.unit || '') + '</small></div><div class="pchart" data-chart="' + id + '">' + chart(id) + '</div>';
      case 'binary': return '<div class="pbigstate ' + (st.on ? (k === 'leak' ? 'bad' : 'warn') : 'ok') + '">' + ico(B.iconOf(d)) + esc(B.stateText(d, st)) + '</div>';
      case 'scene': return '<button class="btn pri" style="width:100%" data-act="pscene" data-id="' + id + '">' + ico('play') + 'Lancer « ' + esc(d.name) + ' »</button>';
      default: return row('Allumé', sw(id, st.on));
    }
  }
  const WATT = d => ({ light: d.def.rgb ? 12 : 9, group: 30, clim: 900, media: 120, power: /ordi/i.test(d.name) ? 150 : /tv/i.test(d.name) ? 110 : /ampli|marantz/i.test(d.name) ? 80 : 60, app: 800, charger: 7400, fan: 40, heater: 2000, valve: 5, sprinkler: 5 })[d.type] || 10;
  B.WATT = WATT;

  /* ---------- graphique 24 h des capteurs (Home Assistant si relié, sinon exemple) ---------- */
  const series = {};
  function demoSeries(d) {
    const k = B.kindOf(d), now = Date.now(), out = [];
    for (let i = 48; i >= 0; i--) { const t = now - i * 18e5, h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const v = k === 'temp' ? 20.5 + 1.6 * Math.sin((h - 9) / 24 * 2 * Math.PI) : k === 'hum' ? 50 + 8 * Math.sin((h - 3) / 24 * 2 * Math.PI) : k === 'co2' ? 480 + (h > 18 || h < 7 ? 380 : 90) * Math.abs(Math.sin(h)) : 300 + (h > 18 && h < 23 ? 1500 : h > 7 && h < 9 ? 900 : 150) * (0.7 + 0.3 * Math.sin(h * 3));
      out.push([t, v]); }
    return out;
  }
  async function loadSeries(id) {
    const e = HA.entity(id); if (!HA.online || !e) return;
    try { const start = new Date(Date.now() - 864e5).toISOString(); const h = await HA.req('/api/history/period/' + start + '?minimal_response&no_attributes&filter_entity_id=' + e);
      series[id] = { t: Date.now(), pts: (h[0] || []).map(p => [new Date(p.last_changed).getTime(), parseFloat(p.state)]).filter(p => !isNaN(p[1])) }; refresh(id); } catch (err) { }
  }
  function chart(id) {
    const d = DATA.DEVICES[id], cached = series[id];
    if (HA.online && HA.entity(id) && (!cached || Date.now() - cached.t > 3e5)) loadSeries(id);
    const pts = cached && cached.pts.length > 1 ? cached.pts : demoSeries(d), W = 300, H = 90;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0], vs = pts.map(p => p[1]), mn = Math.min(...vs), mx = Math.max(...vs), sp = (mx - mn) || 1;
    const xy = p => ((p[0] - t0) / (t1 - t0) * W).toFixed(1) + ',' + (H - 6 - (p[1] - mn) / sp * (H - 14)).toFixed(1);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%" role="img" aria-label="Évolution sur 24 heures"><defs><linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fd3ff" stop-opacity=".45"/><stop offset="1" stop-color="#2fd3ff" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M0,' + H + ' L' + pts.map(xy).join(' L') + ' L' + W + ',' + H + 'Z" fill="url(#pcg)"/><polyline points="' + pts.map(xy).join(' ') + '" fill="none" stroke="#2fd3ff" stroke-width="2"/></svg>' +
      '<div class="row legend" style="justify-content:space-between"><span>24 h · min ' + fmt(mn) + '</span><span>max ' + fmt(mx) + '</span><span>' + (cached ? 'Home Assistant' : 'exemple') + '</span></div>';
  }

  /* ---------- historique du jour (journal) ---------- */
  function history(id) {
    const J = B.Journal; if (!J) return '';
    const d = DATA.DEVICES[id], today = J.forDev(id, 1), st = dev(id);
    let onMs = 0, last = null;
    today.slice().reverse().forEach(e => { if (e.a === 'on') last = e.t; if (e.a === 'off' && last) { onMs += e.t - last; last = null; } });
    if (last && (st.on || d.type === 'light')) onMs += Date.now() - last;
    const h = onMs / 36e5;
    return '<div class="phist"><b>' + ico('history') + 'Aujourd’hui</b><div class="pk"><span><b>' + today.length + '</b>actions</span>' + (['sensor', 'binary', 'scene', 'lock', 'alarm'].includes(d.type) ? '' : '<span><b>' + fmt(h) + ' h</b>allumé</span><span><b>' + fmt(h * WATT(d) / 1000) + '</b>kWh</span>') + '</div>' +
      (today.length ? '<div class="plog">' + today.slice(0, 5).map(e => '<div><span>' + new Date(e.t).toTimeString().slice(0, 5) + '</span><span>' + esc(e.txt) + '</span><span class="muted">' + esc(e.un || '') + '</span></div>').join('') + '</div>' : '<p class="muted" style="margin:6px 0 0;font-size:12.5px">Aucune action aujourd’hui.</p>') + '</div>';
  }

  /* ---------- fenêtres flottantes ---------- */
  const open = [];
  let z = 90;
  function body(id) {
    const d = DATA.DEVICES[id], lk = B.canUse && !B.canUse(id), ent = HA.entity(id);
    return (lk ? '<div class="plock">' + ico('lock') + 'Accès réservé : vous pouvez consulter, pas commander.</div>' : '') + '<div class="pctl' + (lk ? ' ro' : '') + '">' + controls(id) + '</div>' + history(id) +
      '<div class="pfoot"><span class="muted">' + (ent ? ico('homeFill') + esc(ent) : 'Non relié à Home Assistant') + '</span>' + (B.isAdmin && B.isAdmin() ? '<button class="btn sm" data-act="pdevEdit" data-id="' + id + '">' + ico('edit') + 'Modifier</button>' : '') + '</div>';
  }
  function refresh(id) {
    document.querySelectorAll('.fpanel[data-pid="' + id + '"] .fpb').forEach(b => { const y = b.scrollTop; b.innerHTML = body(id); b.scrollTop = y; });
    document.querySelectorAll('.fpanel[data-pid="' + id + '"] .fph small').forEach(s => s.textContent = B.stateText(DATA.DEVICES[id], dev(id)) || '');
  }
  function openPanel(id) {
    const d = DATA.DEVICES[id]; if (!d) return;
    let p = document.querySelector('.fpanel[data-pid="' + id + '"]');
    if (p) { p.style.zIndex = ++z; p.classList.remove('min'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); return; }
    if (open.length >= 3) close(open[0]);
    p = document.createElement('div');
    p.className = 'fpanel card'; p.dataset.pid = id; p.style.zIndex = ++z;
    const n = open.length, W = Math.min(360, window.innerWidth - 24);
    p.style.width = W + 'px'; p.style.left = Math.max(12, window.innerWidth - W - 24 - n * 28) + 'px'; p.style.top = (80 + n * 34) + 'px';
    p.innerHTML = '<div class="fph"><span class="bdg" style="--g1:#2fd3ff;--g2:#7a5bff;--s:34px">' + ico(B.iconOf(d)) + '</span><div class="ft"><b>' + esc(d.name) + '</b><span>' + esc(d.room) + ' · <small>' + esc(B.stateText(d, dev(id)) || '') + '</small></span></div><button data-act="pmin" aria-label="Réduire">' + ico('minus') + '</button><button data-act="pclose" aria-label="Fermer">' + ico('x') + '</button></div><div class="fpb scroll">' + body(id) + '</div>';
    document.body.appendChild(p);
    open.push(id);
    drag(p);
  }
  function close(id) { const i = open.indexOf(id); if (i >= 0) open.splice(i, 1); const p = document.querySelector('.fpanel[data-pid="' + id + '"]'); if (p) p.remove(); }
  function drag(p) {
    const h = p.querySelector('.fph');
    let sx, sy, ox, oy, on = false;
    h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; on = true; sx = e.clientX; sy = e.clientY; ox = p.offsetLeft; oy = p.offsetTop; p.style.zIndex = ++z; h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointermove', e => { if (!on) return; p.style.left = Math.max(-p.offsetWidth + 80, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px'; p.style.top = Math.max(0, Math.min(window.innerHeight - 50, oy + e.clientY - sy)) + 'px'; });
    h.addEventListener('pointerup', () => { on = false; });
    p.addEventListener('pointerdown', () => { p.style.zIndex = ++z; });
  }
  B.panel = { open: openPanel, close, refresh, drag, controls, history, range, bump: () => ++z };
  B.act('panel', (el, e) => { e.stopPropagation(); openPanel(el.dataset.id); });
  B.act('pclose', el => close(el.closest('.fpanel').dataset.pid));
  B.act('pmin', el => el.closest('.fpanel').classList.toggle('min'));
  B.on('dev', ({ id }) => { if (open.includes(id)) refresh(id); });
  window.addEventListener('hashchange', () => setTimeout(() => open.forEach(refresh), 50));

  /* ---------- actions des contrôles ---------- */
  const parse = v => v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(v) ? +v : v;
  B.act('pset', el => { const id = el.dataset.id, k = el.dataset.k, v = parse(el.dataset.v); const p = { [k]: v }; if (k === 'pos') { B.src = 'ui'; } if (['bri', 'ct', 'effect', 'color'].includes(k)) p.on = true; if (k === 'status' && v === 'zone') B.toast('Nettoyage de « ' + el.textContent + ' »', 'robotFill'); setDev(id, p); });
  B.act('prangeL', el => { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); el.nextElementSibling.textContent = fmt(+el.value) + (el.dataset.u || ''); });
  B.act('prangeC', el => { const p = { [el.dataset.k]: +el.value }; if (el.dataset.k === 'bri') p.on = +el.value > 0; if (el.dataset.k === 'vol' || el.dataset.k === 'pct') p.on = true; setDev(el.dataset.id, p); });
  B.act('pcolor', el => setDev(el.dataset.id, { on: true, color: el.value }));
  B.act('pfield', el => { dev(el.dataset.id)[el.dataset.k] = el.value; B.save(); });
  B.act('ptimer', el => { const m = +el.dataset.v; setDev(el.dataset.id, m ? { on: true, offAt: Date.now() + m * 6e4 } : { offAt: null }); if (m) B.toast('Arrêt automatique dans ' + (m < 60 ? m + ' min' : m / 60 + ' h'), 'history'); });
  B.act('pmedia', el => { const id = el.dataset.id; HA.push(id, { cmd: el.dataset.v }); if (B.fire) B.fire('dev', { id, patch: { cmd: el.dataset.v } }); });
  B.act('pdevEdit', el => {
    const id = el.dataset.id, d = DATA.DEVICES[id], C = S.custom, cd = C.devices.find(x => x.id === id);
    B.modal('<h2>' + ico('edit') + 'Modifier « ' + esc(d.name) + ' »</h2><form data-submit="pdevSave" data-arg="' + id + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="field">Nom affiché<input name="name" value="' + esc(d.name) + '" required></label>' +
      '<div class="grid3 pplace"><label class="field">Affiché comme' + B.devKindSel(B.kindOf(d), 'name="kind"') + '</label><label class="field">Étage<select name="floor" data-change="pdevFloor">' + B.floors(true).map(x => '<option value="' + x.id + '"' + (x.id === B.floorOf(id) ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label><label class="field">Pièce<select name="room">' + B.devRoomOpts(B.floorOf(id), d.room) + '</select></label></div>' +
      '<label class="field">Entité Home Assistant<input name="ha" value="' + esc(HA.entity(id)) + '" list="haents3" spellcheck="false"><datalist id="haents3">' + Object.keys(HA.states || {}).slice(0, 600).map(e => '<option value="' + esc(e) + '">').join('') + '</datalist></label>' +
      '<div class="row" style="justify-content:space-between;flex-wrap:wrap">' + (cd ? '<button type="button" class="btn dan" data-act="devDel" data-arg="' + id + '">' + ico('trash') + 'Supprimer</button>' : '<button type="button" class="btn" data-act="devHide2" data-arg="' + id + '">' + ico('x') + 'Masquer cet appareil</button>') +
      '<span class="row"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></span></div></form>', 'sm');
  });
  B.act('pdevSave', el => {
    const id = el.dataset.arg, f = new FormData(el), C = S.custom, cd = C.devices.find(x => x.id === id), name = String(f.get('name')).trim(), ha = String(f.get('ha')).trim();
    if (cd) { cd.name = name; cd.ha = ha; } else { C.devNames[id] = name; S.settings.haMap = Object.assign({}, S.settings.haMap, { [id]: ha || '-' }); }
    const fl = String(f.get('floor')); let room = String(f.get('room')); if (room === '__new') room = B.devNewRoom(fl);
    const d0 = DATA.DEVICES[id], pl = {}; if (f.get('kind') !== B.kindOf(d0)) pl.kind = String(f.get('kind')); if (room && (room !== d0.room || fl !== B.floorOf(id))) Object.assign(pl, { floor: fl, room });
    if (Object.keys(pl).length) B.devPlace(id, pl);
    B.registerCustom(); B.save(); B.closeModal(); refresh(id); B.show(); B.toast('Appareil mis à jour', 'check');
  });
  B.act('pdevFloor', el => { const r = el.form.room; r.innerHTML = B.devRoomOpts(el.value, ''); });
  B.act('devHide2', el => { S.custom.hidden[el.dataset.arg] = true; B.save(); B.closeModal(); close(el.dataset.arg); B.show(); B.toast('Appareil masqué (réaffichable dans Gérer › Appareils)', 'x'); });
})();
