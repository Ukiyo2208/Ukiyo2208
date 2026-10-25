/* Bêta home — panneau de pièce « ⋯ » : toutes les commandes de la pièce, avec des widgets façon Home Assistant
   (cadran de thermostat, roue de couleurs, volet interactif). */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev } = B;
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const ROUTEFLOOR = { exterieur: 'ext', rdc: 'rdc', etage1: 'e1', etage2: 'e2' };
  const curFloor = () => ROUTEFLOOR[B.current] || (String(B.current).startsWith('niveau-') ? B.current.slice(7) : null);

  /* ---------- cadran de thermostat ---------- */
  const MODES = [['Arrêt', 'power'], ['Auto', 'sparkle'], ['Chaud/froid', 'refresh'], ['Chaud', 'flame'], ['Froid', 'snow'], ['Sec', 'drop'], ['Ventilation', 'fan']];
  const MODECOL = { Arrêt: '#6f86ad', Auto: '#22e3a4', 'Chaud/froid': '#c39bff', Chaud: '#ff8a34', Froid: '#2fb6ff', Sec: '#ffd23f', Ventilation: '#8fd0ff' };
  const ACTION = { heating: 'Chauffe', cooling: 'Refroidit', drying: 'Déshumidifie', fan: 'Ventile', idle: 'En attente', off: 'Arrêt' };
  const R = 92, CX = 110, CY = 110, A0 = 135, SWEEP = 270;
  const pt = a => [CX + R * Math.cos(a * Math.PI / 180), CY + R * Math.sin(a * Math.PI / 180)];
  const arc = (a1, a2) => { const [x1, y1] = pt(a1), [x2, y2] = pt(a2); return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' A' + R + ' ' + R + ' 0 ' + (a2 - a1 > 180 ? 1 : 0) + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1); };
  function thermo(id) {
    const st = dev(id), mn = st.min || 16, mx = st.max || 30, t = Math.min(mx, Math.max(mn, +st.temp || 21));
    const mode = st.on === false ? 'Arrêt' : (st.hvac || 'Auto'), col = MODECOL[mode] || '#2fb6ff';
    const a = A0 + (t - mn) / (mx - mn) * SWEEP, [kx, ky] = pt(a);
    const cur = st.cur != null ? st.cur : null;
    const ca = cur != null ? A0 + (Math.min(mx, Math.max(mn, cur)) - mn) / (mx - mn) * SWEEP : null;
    return '<div class="thermo" data-id="' + id + '"><svg viewBox="0 0 220 220" class="tdial" data-id="' + id + '" data-min="' + mn + '" data-max="' + mx + '" data-step="' + (st.step || .5) + '">' +
      '<path d="' + arc(A0, A0 + SWEEP) + '" stroke="rgba(70,110,180,.35)" stroke-width="14" fill="none" stroke-linecap="round"/>' +
      (mode !== 'Arrêt' ? '<path d="' + arc(A0, Math.max(A0 + .1, a)) + '" stroke="' + col + '" stroke-width="14" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 8px ' + col + ')"/>' : '') +
      (ca != null ? '<circle cx="' + pt(ca)[0].toFixed(1) + '" cy="' + pt(ca)[1].toFixed(1) + '" r="4" fill="#fff" opacity=".85"/>' : '') +
      '<circle cx="' + kx.toFixed(1) + '" cy="' + ky.toFixed(1) + '" r="13" fill="#0b1a3e" stroke="#fff" stroke-width="3" class="tknob"/>' +
      '<text x="110" y="92" text-anchor="middle" fill="' + col + '" font-size="13">' + esc(mode === 'Arrêt' ? 'Arrêt' : (ACTION[st.action] || mode)) + '</text>' +
      '<text x="110" y="128" text-anchor="middle" fill="#fff" font-size="40" font-weight="300" class="tval">' + fmt(t) + '<tspan font-size="18" dy="-16">°C</tspan></text>' +
      (cur != null ? '<text x="110" y="152" text-anchor="middle" fill="#9fb4d8" font-size="12">' + ico('therm').length && ('Pièce ' + fmt(cur) + ' °C' + (st.curhum != null ? ' · ' + Math.round(st.curhum) + ' %' : '')) + '</text>' : '') +
      '</svg><div class="tbtns"><button class="sq" data-act="rclim" data-id="' + id + '" data-arg="-1" aria-label="Moins">' + ico('minus') + '</button><button class="sq" data-act="rclim" data-id="' + id + '" data-arg="1" aria-label="Plus">' + ico('plus') + '</button></div></div>';
  }
  function climBody(id) {
    const st = dev(id), mode = st.on === false ? 'Arrêt' : (st.hvac || 'Auto');
    const modes = MODES.filter(m => !st.modes || st.modes.includes(m[0]) || m[0] === 'Arrêt');
    const presets = st.presets || ['Aucun', 'Éco', 'Confort', 'Absent', 'Boost', 'Sommeil'];
    const fans = st.fanms || ['auto', 'low', 'medium', 'high'], FL = { auto: 'Auto', low: 'Faible', medium: 'Moyen', high: 'Fort', quiet: 'Silence', turbo: 'Turbo', Auto: 'Auto' };
    return thermo(id) +
      '<div class="hamodes">' + modes.map(m => '<button class="' + (mode === m[0] ? 'on' : '') + '" style="--c:' + MODECOL[m[0]] + '" data-act="rhvac" data-id="' + id + '" data-arg="' + m[0] + '" title="' + m[0] + '">' + ico(m[1]) + '<span>' + m[0] + '</span></button>').join('') + '</div>' +
      '<div class="prow col"><span>Préréglage</span>' + chips(id, 'preset', st.preset || 'Aucun', presets) + '</div>' +
      '<div class="prow col"><span>Ventilation</span><div class="pchips">' + fans.map(f => '<button class="cat' + (String(st.fanm || 'auto').toLowerCase() === String(f).toLowerCase() ? ' on' : '') + '" data-act="pset" data-id="' + id + '" data-k="fanm" data-v="' + esc(f) + '">' + esc(FL[f] || f) + '</button>').join('') + '</div></div>' +
      '<div class="prow"><span>Oscillation</span><button class="sw' + (st.swing ? ' on' : '') + '" data-act="pset" data-id="' + id + '" data-k="swing" data-v="' + !st.swing + '" role="switch" aria-label="Oscillation"></button></div>' +
      (st.hum != null || st.curhum != null ? '<div class="prow"><span>Humidité cible</span>' + B.panel.range(id, 'hum', st.hum || 50, 30, 70, 5, ' %') + '</div>' : '');
  }
  const chips = (id, k, cur, list) => '<div class="pchips">' + list.map(v => '<button class="cat' + (String(cur) === String(v) ? ' on' : '') + '" data-act="pset" data-id="' + id + '" data-k="' + k + '" data-v="' + esc(v) + '">' + esc(v) + '</button>').join('') + '</div>';

  /* ---------- lumière : intensité, roue de couleurs, blanc ---------- */
  const hex2hsv = h => { const n = parseInt((h || '#ffb35c').slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hu = 0; if (d) hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hu * 60 + 360) % 360, mx ? d / mx : 0, mx]; };
  const hsv2hex = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
  const FAVS = ['#ffb35c', '#fff2d6', '#ff4f6d', '#ff5fae', '#c25bff', '#2f7dff', '#2ed3ff', '#22e3a4'];
  function lightBody(id) {
    const d = DATA.DEVICES[id], st = dev(id), bri = st.on ? (st.bri || 80) : 0, rgb = d.def.rgb, [h, s] = hex2hsv(st.color);
    const kmin = st.kmin || 2200, kmax = st.kmax || 6500, ct = st.ct || 3000;
    const knob = 'left:' + (50 + Math.cos(h * Math.PI / 180) * s * 50) + '%;top:' + (50 + Math.sin(h * Math.PI / 180) * s * 50) + '%';
    return '<div class="lwrap"><div class="lbar" data-id="' + id + '" role="slider" aria-label="Luminosité" aria-valuenow="' + bri + '"><i style="height:' + bri + '%;background:' + (rgb && st.on ? 'linear-gradient(0deg,' + st.color + ',#fff8)' : 'linear-gradient(0deg,#ffb35c,#ffe6b0)') + '"></i><b>' + bri + ' %</b></div>' +
      (rgb ? '<div class="lright"><div class="lwheel" data-id="' + id + '"><span class="lk" style="' + knob + ';background:' + (st.color || '#ffb35c') + '"></span></div>' : '<div class="lright">') +
      '<div class="lct" data-id="' + id + '" data-min="' + kmin + '" data-max="' + kmax + '" style="--p:' + ((ct - kmin) / (kmax - kmin) * 100) + '%" role="slider" aria-label="Température de blanc"><span></span></div><small class="muted">Blanc ' + ct + ' K · ' + (ct < 3300 ? 'chaud' : ct < 4800 ? 'neutre' : 'froid') + '</small>' +
      (rgb ? '<div class="pcol">' + (st.favs || FAVS).map(c => '<button style="--c:' + c + '" class="' + (c === st.color ? 'sel' : '') + '" data-act="pset" data-id="' + id + '" data-k="color" data-v="' + c + '" aria-label="' + c + '"></button>').join('') + '<button class="addfav" data-act="rfav" data-id="' + id + '" aria-label="Ajouter la couleur actuelle aux favoris">' + ico('plus') + '</button></div>' : '') + '</div></div>' +
      '<div class="prow col"><span>Effet</span>' + chips(id, 'effect', st.effect || 'Aucun', st.effects ? ['Aucun'].concat(st.effects) : ['Aucun', 'Respiration', 'Bougie', 'Arc-en-ciel', 'Néon']) + '</div>';
  }

  /* ---------- volet : fenêtre interactive ---------- */
  function coverBody(id) {
    const d = DATA.DEVICES[id], st = dev(id), pos = st.pos || 0, k = B.kindOf(d);
    return '<div class="cwrap"><div class="cwin ' + k + '" data-id="' + id + '" role="slider" aria-label="Position" aria-valuenow="' + pos + '"><i style="height:' + (100 - pos) + '%"></i><b>' + (pos >= 100 ? 'Ouvert' : pos <= 0 ? 'Fermé' : pos + ' %') + '</b></div>' +
      '<div class="cbtns">' + [['up', 'chevU', 'Ouvrir'], ['stop', 'stop', 'Stop'], ['down', 'chevD', 'Fermer']].map(b => '<button class="sq' + (b[0] === 'stop' ? ' stopb' : '') + '" data-act="cover" data-id="' + id + '" data-arg="' + b[0] + '">' + ico(b[1]) + '</button><span>' + b[2] + '</span>').join('') + '</div></div>' +
      (k === 'cover' ? '<div class="prow"><span>Lames</span>' + B.panel.range(id, 'tilt', st.tilt == null ? 50 : st.tilt, 0, 100, 5, ' %') + '</div>' : '');
  }

  /* ---------- sections de la pièce ---------- */
  const open = new Set();
  function quickToggle(d, st) {
    if (['light', 'group', 'power', 'app', 'media', 'fan', 'valve', 'heater', 'charger', 'sprinkler'].includes(d.type)) return '<button class="sw sm' + (st.on ? ' on' : '') + '" data-act="toggle" data-id="' + d.id + '" role="switch" aria-label="Marche/arrêt"></button>';
    if (d.type === 'clim') return '<button class="sw sm' + (st.on ? ' on' : '') + '" data-act="toggle" data-id="' + d.id + '" role="switch" aria-label="Marche/arrêt"></button>';
    if (d.type === 'cover') return '<span class="rpos">' + (st.pos || 0) + ' %</span>';
    if (d.type === 'sensor') return '<b class="rval">' + fmt(+st.val || 0) + ' ' + esc(st.unit || '') + '</b>';
    return '';
  }
  function section(d) {
    const st = dev(d.id), isOpen = open.has(d.id), lk = B.canUse && !B.canUse(d.id);
    const body = !isOpen ? '' : '<div class="rsb' + (lk ? ' ro' : '') + '">' + (lk ? '<div class="plock">' + ico('lock') + 'Accès réservé</div>' : '') +
      (d.type === 'clim' ? climBody(d.id) : d.type === 'light' ? lightBody(d.id) : d.type === 'cover' ? coverBody(d.id) : '<div class="pctl">' + B.panel.controls(d.id) + '</div>') +
      '<div class="rsf"><button class="btn sm" data-act="panel" data-id="' + d.id + '">' + ico('history') + 'Historique & réglages</button></div></div>';
    return '<div class="rsec' + (isOpen ? ' open' : '') + (st.on || (d.type === 'cover' && st.pos > 0) ? ' act' : '') + '" data-sid="' + d.id + '"><div class="rsh" data-act="rsec" data-id="' + d.id + '" role="button" tabindex="0"><span class="gi">' + ico(B.iconOf(d)) + '</span><span class="nm"><b>' + esc(d.name) + '</b><small>' + esc(B.stateText(d, st) || (d.type === 'cover' ? ((st.pos || 0) >= 100 ? 'Ouvert' : (st.pos || 0) <= 0 ? 'Fermé' : st.pos + ' %') : d.type === 'clim' ? (st.on ? fmt(+st.temp) + ' °C · ' + (st.hvac || 'Auto') : 'Arrêt') : '')) + '</small></span>' + quickToggle(d, st) + ico('chevD', 'chv') + '</div>' + body + '</div>';
  }
  const panels = {};
  function devsOf(room, fl) { return (B.roomsList(fl, false).find(r => r.name === room) || { devs: [] }).devs; }
  function roomBody(key) {
    const [fl, ...n] = key.split('|'), room = n.join('|'), ds = devsOf(room, fl);
    const has = t => ds.some(d => d.type === t);
    return '<div class="rquick">' + (has('light') || has('group') ? '<button data-act="rall" data-arg="' + esc(key) + '" data-v="on">' + ico('bulbFill') + 'Tout allumer</button><button data-act="rall" data-arg="' + esc(key) + '" data-v="off">' + ico('bulb') + 'Tout éteindre</button>' : '') +
      (has('cover') ? '<button data-act="rall" data-arg="' + esc(key) + '" data-v="open">' + ico('chevU') + 'Volets</button><button data-act="rall" data-arg="' + esc(key) + '" data-v="close">' + ico('chevD') + 'Volets</button>' : '') +
      (has('light') ? '<button data-act="rall" data-arg="' + esc(key) + '" data-v="soir">' + ico('moon') + 'Soirée</button>' : '') + '</div>' +
      (ds.length ? ds.map(section).join('') : '<p class="muted" style="margin:6px 0">Aucun appareil dans cette pièce.' + (B.isAdmin && B.isAdmin() ? ' Ajoutez-en depuis le mode « Modifier » de l’étage.' : '') + '</p>');
  }
  function openRoom(name, fl) {
    fl = fl || curFloor();
    let r = fl && B.roomsList(fl, false).find(x => x.name === name);
    if (!r) for (const f of B.floors(true)) { r = B.roomsList(f.id, false).find(x => x.name === name); if (r) break; }
    if (!r) return B.toast(name + ' : aucun appareil', 'info');
    const key = r.key;
    let p = document.querySelector('.rpanel[data-key="' + CSS.escape(key) + '"]');
    if (p) { p.style.zIndex = B.panel.bump(); return; }
    document.querySelectorAll('.rpanel').forEach(x => x.remove());
    const ds = r.devs; open.clear();
    const first = ds.find(d => ['clim', 'light', 'cover'].includes(d.type)); if (first) open.add(first.id);
    p = document.createElement('div');
    p.className = 'fpanel rpanel card'; p.dataset.key = key; p.style.zIndex = B.panel.bump();
    const W = Math.min(440, window.innerWidth - 24);
    p.style.width = W + 'px'; p.style.left = Math.max(12, window.innerWidth - W - 24) + 'px'; p.style.top = '70px';
    p.innerHTML = '<div class="fph">' + (r.img ? '<img src="' + r.img + '" alt="" class="rimg">' : '<span class="bdg" style="--g1:#2fd3ff;--g2:#7a5bff;--s:38px">' + ico(r.icon) + '</span>') + '<div class="ft"><b>' + esc(r.label) + '</b><span>' + esc((B.floor(r.floor) || {}).name || '') + ' · ' + ds.length + ' appareil' + (ds.length > 1 ? 's' : '') + '</span></div><button data-act="pmin" aria-label="Réduire">' + ico('minus') + '</button><button data-act="rclose" aria-label="Fermer">' + ico('x') + '</button></div><div class="fpb scroll">' + roomBody(key) + '</div>';
    document.body.appendChild(p);
    B.panel.drag(p);
    panels[key] = true;
  }
  B.openRoom = openRoom;
  B.act('roomInfo', el => openRoom(el.dataset.arg, el.dataset.floor));
  B.act('rclose', el => el.closest('.rpanel').remove());
  B.act('rsec', (el, e) => { if (e.target.closest('.sw,button')) return; const id = el.dataset.id; open.has(id) ? open.delete(id) : open.add(id); redraw(id); });
  function redraw(id) {
    document.querySelectorAll('.rpanel [data-sid="' + CSS.escape(id) + '"]').forEach(s => { if (s.querySelector('.dragging')) return; const t = document.createElement('div'); t.innerHTML = section(DATA.DEVICES[id]); s.replaceWith(t.firstElementChild); });
  }
  B.on('dev', ({ id }) => redraw(id));
  B.act('rall', el => {
    const [fl, ...n] = el.dataset.arg.split('|'), ds = devsOf(n.join('|'), fl), v = el.dataset.v;
    ds.forEach(d => {
      if (B.canUse && !B.canUse(d.id)) return;
      if ((d.type === 'light' || d.type === 'group') && (v === 'on' || v === 'off')) setDev(d.id, { on: v === 'on' });
      if (d.type === 'cover' && (v === 'open' || v === 'close') && B.kindOf(d) !== 'garage') setDev(d.id, { pos: v === 'open' ? 100 : 0 });
      if (v === 'soir' && d.type === 'light') setDev(d.id, Object.assign({ on: true, bri: 35 }, d.def.rgb ? { color: '#ff9a4a' } : { ct: 2400 }));
    });
  });
  /* climat */
  B.act('rclim', el => { const id = el.dataset.id, st = dev(id), step = st.step || .5, t = Math.min(st.max || 30, Math.max(st.min || 16, (+st.temp || 21) + step * +el.dataset.arg)); setDev(id, { temp: t, on: st.on === false ? true : st.on }); });
  B.act('rhvac', el => { const v = el.dataset.arg; setDev(el.dataset.id, v === 'Arrêt' ? { on: false, hvac: 'Arrêt' } : { on: true, hvac: v }); });
  B.act('rfav', el => { const id = el.dataset.id, st = dev(id), f = (st.favs || FAVS.slice()).filter(c => c !== st.color); f.unshift(st.color || '#ffb35c'); setDev(id, { favs: f.slice(0, 10) }); B.toast('Couleur ajoutée aux favoris', 'heartFill'); });

  /* ---------- gestes : cadran, barre d'intensité, roue, blanc, volet ---------- */
  let g = null;
  const pos = (e, el) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; };
  function move(e) {
    if (!g) return;
    const el = g.el, id = el.dataset.id, [x, y] = pos(e, el);
    if (g.t === 'dial') {
      let a = Math.atan2(y - .5, x - .5) * 180 / Math.PI; if (a < 0) a += 360; if (a < A0 - 45) a += 360;
      const mn = +el.dataset.min, mx = +el.dataset.max, step = +el.dataset.step, f = Math.min(1, Math.max(0, (a - A0) / SWEEP));
      g.v = Math.round((mn + f * (mx - mn)) / step) * step;
      const tv = el.querySelector('.tval'); if (tv) tv.firstChild.textContent = fmt(g.v);
      const [kx, ky] = pt(A0 + (g.v - mn) / (mx - mn) * SWEEP), k = el.querySelector('.tknob'); if (k) { k.setAttribute('cx', kx); k.setAttribute('cy', ky); }
    } else if (g.t === 'bar') { g.v = Math.max(1, Math.round((1 - Math.min(1, Math.max(0, y))) * 100)); el.querySelector('i').style.height = g.v + '%'; el.querySelector('b').textContent = g.v + ' %'; }
    else if (g.t === 'cover') { g.v = Math.round((1 - Math.min(1, Math.max(0, y))) * 20) * 5; el.querySelector('i').style.height = (100 - g.v) + '%'; el.querySelector('b').textContent = g.v + ' %'; }
    else if (g.t === 'ct') { const f = Math.min(1, Math.max(0, x)); g.v = Math.round((+el.dataset.min + f * (el.dataset.max - el.dataset.min)) / 100) * 100; el.style.setProperty('--p', f * 100 + '%'); }
    else if (g.t === 'wheel') { const dx = x - .5, dy = y - .5, s = Math.min(1, Math.hypot(dx, dy) * 2), h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; g.v = hsv2hex(h, s, 1); const k = el.querySelector('.lk'); k.style.left = (50 + dx / Math.max(.5, Math.hypot(dx, dy)) * Math.min(.5, Math.hypot(dx, dy)) * 100) + '%'; k.style.top = (50 + dy / Math.max(.5, Math.hypot(dx, dy)) * Math.min(.5, Math.hypot(dx, dy)) * 100) + '%'; k.style.background = g.v; }
  }
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.tdial,.lbar,.cwin,.lct,.lwheel'); if (!el || el.closest('.ro')) return;
    if (B.canUse && !B.canUse(el.dataset.id)) return B.toast('Accès réservé', 'lock');
    g = { el, t: el.classList.contains('tdial') ? 'dial' : el.classList.contains('lbar') ? 'bar' : el.classList.contains('cwin') ? 'cover' : el.classList.contains('lct') ? 'ct' : 'wheel' };
    el.classList.add('dragging'); el.setPointerCapture && el.setPointerCapture(e.pointerId); e.preventDefault(); move(e);
  });
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', () => {
    if (!g) return; const { el, t, v } = g, id = el.dataset.id; el.classList.remove('dragging'); g = null; if (v == null) return;
    if (t === 'dial') setDev(id, { temp: v, on: true });
    else if (t === 'bar') setDev(id, { bri: v, on: true });
    else if (t === 'cover') setDev(id, { pos: v });
    else if (t === 'ct') setDev(id, { ct: v, on: true });
    else if (t === 'wheel') setDev(id, { color: v, on: true });
  });
})();
