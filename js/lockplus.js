/* Bêta OS 6.3 — écran verrouillé : carte « Maison » intelligente (les alertes d'abord, ce qui est
   normal s'efface) et carte météo complète ; collectes des déchets dans le calendrier. */
(function () {
  const B = window.BOS, { S, DATA, esc, F, RENDER, dev, WX } = B;
  const has = id => !!DATA.DEVICES[id] && !(B.isHidden && B.isHidden(id));
  const nf = (v, d) => Number(v).toFixed(d == null ? 1 : d).replace('.', ',');
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'à l’instant' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  const byType = (...t) => Object.values(DATA.DEVICES).filter(d => t.includes(d.type) && has(d.id));
  const kind = d => B.kindOf ? B.kindOf(d) : d.type;

  /* ---------- électroménager : on retient la fin de cycle ---------- */
  if (!S.appDone) S.appDone = {};
  B.on('dev', ({ id, patch }) => {
    const d = DATA.DEVICES[id]; if (!d || d.type !== 'app' || !('on' in patch)) return;
    if (patch.on) { delete S.appDone[id]; const st = dev(id); if (!st.endAt) st.endAt = Date.now() + (/vaisselle/i.test(d.name) ? 150 : 110) * 6e4; }
    else { S.appDone[id] = Date.now(); dev(id).endAt = null; }
    B.save();
  });

  /* ---------- poubelles : rendez-vous de collecte dans l'agenda ---------- */
  const TRASH = /poubelle|ordure|d[ée]chet|collecte|recycl|tri s[ée]lectif|verre|bio ?d[ée]chet|encombrant/i;
  function trash() {
    const now = new Date(), h = now.getHours(), today = F.ymd(now), tom = F.ymd(new Date(Date.now() + 864e5));
    const ev = S.events.filter(e => TRASH.test(e.title));
    const t = ev.filter(e => e.date === tom), d = ev.filter(e => e.date === today && h < 11);
    if (h >= 16 && t.length) return { lvl: 2, icon: 'trash', l: 'Poubelles', s: 'Sortir la poubelle ce soir', v: 'Ce soir : ' + t.map(e => e.title.replace(/^(collecte|sortir)( de| des| la| le)? /i, '')).join(', '), go: 'calendrier' };
    if (d.length) return { lvl: 2, icon: 'trash', l: 'Collecte ce matin', v: d.map(e => e.title).join(', '), go: 'calendrier' };
    return null;
  }

  /* ---------- lignes de la carte Maison ---------- */
  function rows() {
    const out = [], H = B.house(), L = B.Energy ? B.Energy.live() : { cons: H.kw, solar: 0 };
    const add = r => r && out.push(r);
    // alertes
    if (S.alarm === 'triggered' || byType('alarm').some(d => dev(d.id).mode === 'triggered')) add({ lvl: 3, icon: 'shieldCheck', l: 'Alarme', v: 'DÉCLENCHÉE !', go: 'absence' });
    byType('binary').filter(d => kind(d) === 'leak' && dev(d.id).on).forEach(d => add({ lvl: 3, icon: 'dropFill', l: 'Fuite d’eau', v: d.room, go: 'absence' }));
    if (has('rdc.garage.door') && dev('rdc.garage.door').pos > 0) {
      const j = (S.journal || []).find(e => e.d === 'rdc.garage.door');
      add({ lvl: 2, icon: 'garage', l: 'Garage', v: 'Ouvert' + (j && j.a === 'open' ? ' depuis ' + ago(j.t) : ''), s: 'Garage ouvert' + (j && j.a === 'open' ? ' depuis ' + ago(j.t) : ''), go: 'absence' });
    }
    byType('binary').filter(d => kind(d) === 'door' && dev(d.id).on).forEach(d => add({ lvl: 2, icon: 'door', l: d.name, v: 'Ouverte · ' + d.room, go: 'absence' }));
    byType('lock').filter(d => dev(d.id).locked === false).forEach(d => add({ lvl: 2, icon: 'lock', l: d.name, v: 'Déverrouillée', go: 'absence' }));
    add(trash());
    if (H.motion) add({ lvl: 2, icon: 'cctv', l: 'Caméras', v: H.motion + ' mouvement' + (H.motion > 1 ? 's' : ''), go: 'exterieur' });
    // électroménager
    byType('app').forEach(d => {
      const st = dev(d.id), done = S.appDone[d.id];
      if (st.on) add({ lvl: 1, icon: /vaisselle/i.test(d.name) ? 'dishwasher' : 'washer', l: d.name, v: st.endAt && st.endAt > Date.now() ? 'Fini dans ' + ago(Date.now() * 2 - st.endAt).replace('à l’instant', '1 min') : 'En cours' + (st.prog ? ' · ' + st.prog : ''), go: 'rdc' });
      else if (done && Date.now() - done < 3 * 36e5) add({ lvl: 2, icon: /vaisselle/i.test(d.name) ? 'dishwasher' : 'washer', l: d.name, v: 'Terminé ✓', go: 'rdc', ok: 1 });
    });
    // confort et énergie
    const sens = byType('sensor').map(d => [d, dev(d.id)]), tIn = sens.find(([d, s]) => s.unit === '°C' && !d.id.startsWith('ext.')) || null;
    const ch = has('home.chauffage') ? dev('home.chauffage') : null, clims = byType('clim').filter(d => d.id !== 'home.chauffage' && dev(d.id).on).length;
    add({ lvl: 1, icon: 'therm', l: 'Intérieur', v: (tIn ? nf(tIn[1].val) + ' °C · ' : '') + (clims ? 'Clim ' + clims + ' pièce' + (clims > 1 ? 's' : '') : ch && ch.on ? 'Chauffage ' + (ch.mode || 'Auto') + ' ' + nf(ch.temp) + '°' : 'Chauffage arrêté'), go: 'energie' });
    add({ lvl: 1, icon: 'bolt', l: 'Conso', v: nf(L.cons) + ' kW' + (L.solar > .05 ? ' · ☀ ' + nf(L.solar) : ''), go: 'energie' });
    const hum = sens.find(([d, s]) => s.unit === '%'), co2 = sens.find(([d, s]) => /ppm/i.test(s.unit || ''));
    if (co2) add({ lvl: co2[1].val > 1200 ? 2 : 1, icon: 'wind', l: 'Qualité de l’air', v: Math.round(co2[1].val) + ' ppm' + (co2[1].val > 1200 ? ' · aérez !' : ''), go: 'pieces' });
    else if (hum) add({ lvl: 1, icon: 'drop', l: 'Humidité', v: Math.round(hum[1].val) + ' %', go: 'pieces' });
    // modes
    if (S.away) add({ lvl: 1, icon: 'shieldCheck', l: 'Mode absent', v: 'Activé', go: 'absence', ok: 1 });
    else if (B.nightNow && B.nightNow()) add({ lvl: 1, icon: 'moon', l: 'Mode nuit', v: 'Activé', go: 'parametres', ok: 1 });
    // le reste, seulement s'il reste de la place
    add({ lvl: 0, icon: 'blindsWin', l: 'Ouvertures', v: H.open ? H.open + ' volet' + (H.open > 1 ? 's' : '') + ' ouvert' + (H.open > 1 ? 's' : '') : 'Tout est fermé', go: 'rdc', ok: !H.open });
    add({ lvl: 0, icon: 'bulb', l: 'Éclairages', v: H.on ? H.on + ' allumé' + (H.on > 1 ? 's' : '') : 'Tout est éteint', go: 'pieces' });
    if (B.hasAlarm()) add({ lvl: 0, icon: 'shieldCheck', l: 'Alarme', v: S.alarm ? 'Activée' : 'Désactivée', go: 'absence', ok: !!S.alarm });
    if (B.car && B.car.row) add(B.car.row());
    else if (has('ext.borne')) { const b = dev('ext.borne'); add({ lvl: 0, icon: 'charger', l: 'Voiture', v: b.on ? 'En charge' + (b.car ? ' · ' + b.car + ' %' : '') : 'Borne disponible', go: 'exterieur' }); }
    if (has('ext.tondeuse')) add({ lvl: 0, icon: 'mowerRobot', l: 'Robot tondeuse', v: dev('ext.tondeuse').status === 'mowing' ? 'En tonte' : 'En charge', go: 'exterieur' });
    return out.map((r, i) => Object.assign(r, { i })).sort((a, b) => b.lvl - a.lvl || a.i - b.i);
  }
  RENDER.lkhouse = s => {
    const all = rows(), alerts = all.filter(r => r.lvl >= 2 && !r.ok), max = document.documentElement.classList.contains('fluid') ? 8 : 6;
    const top = alerts.length === 1 ? (alerts[0].s || alerts[0].l + ' : ' + alerts[0].v) : alerts.length ? alerts.length + ' choses à vérifier' : 'Tout est calme';
    const col = alerts.some(r => r.lvl >= 3) ? '#ff3a4c' : alerts.length ? '#ffa23d' : '';
    return '<div class="lk-house lkh2 glass abs" style="' + s.style + '"><div class="h">' + ico('homeFill') + '<b>Maison</b><small><i' + (col ? ' style="background:' + col + ';box-shadow:0 0 8px ' + col + '"' : '') + '></i><span class="ell">' + esc(top) + '</span></small></div>' +
      all.slice(0, max).map(r => '<a href="#" class="r lvl' + r.lvl + (r.ok ? ' ok' : '') + '" data-act="unlockTo" data-arg="' + r.go + '">' + ico(r.icon) + '<span class="l">' + esc(r.l) + '</span><span class="v">' + esc(r.v) + '</span></a>').join('') + '</div>';
  };
  setInterval(() => { if (B.current === 'verrou') B.emit('house'); }, 60000);

  /* ---------- carte météo ---------- */
  const night = t => { const h = t.getHours() + t.getMinutes() / 60, r = WX.sun.rise.getHours() + WX.sun.rise.getMinutes() / 60, st = WX.sun.set.getHours() + WX.sun.set.getMinutes() / 60; return h < r || h >= st; };
  function wxTone() {
    const c = WX.now.code, n = B.isNight(), now = Date.now(), set = +WX.sun.set, rise = +WX.sun.rise;
    if (c >= 95) return 'storm';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c >= 71 && c <= 86) return 'snow';
    if (Math.abs(now - set) < 50 * 6e4 || Math.abs(now - rise) < 40 * 6e4) return 'dusk';
    if (c === 3 || c === 45 || c === 48) return 'cloud';
    return n ? 'night' : 'day';
  }
  function wxAlert() {
    const H = WX.hours, now = Date.now();
    const rainNow = (WX.now.code >= 51 && WX.now.code <= 67) || (WX.now.code >= 80 && WX.now.code <= 82);
    if (!rainNow) { const h = H.find(x => +x.t > now - 30 * 6e4 && +x.t < now + 4 * 36e5 && (x.prob >= 55 || x.mm >= .3)); if (h) { const m = Math.max(5, Math.round((+h.t - now) / 6e4 / 5) * 5); return { icon: 'rain', t: m < 60 ? 'Pluie dans ' + m + ' min' : 'Pluie vers ' + F.time(h.t) + ' (' + h.prob + ' %)' }; } }
    else { const dry = H.find(x => +x.t > now && x.prob < 30 && x.mm < .1); if (dry) return { icon: 'sun', t: 'Fin de la pluie vers ' + F.time(dry.t) }; }
    const a = B.wxAlerts()[0]; if (a) return { icon: a.icon, t: a.text, warn: 1 };
    return null;
  }
  RENDER.lkwx = s => {
    const n = B.isNight(), now = Date.now(), al = wxAlert(), tm = WX.tomorrow || WX.days[0];
    const hrs = WX.hours.filter(x => +x.t > now - 30 * 6e4).slice(0, 6);
    const sunRow = n ? '<div>' + ico('sun') + F.time(WX.sun.rise) + '<small>Lever</small></div>' : '<div>' + ico('moon') + F.time(WX.sun.set) + '<small>Coucher</small></div>';
    return '<div class="lk-wx lkw2 tone-' + wxTone() + ' glass abs" style="' + s.style + '">' +
      '<div class="loc">' + ico('pinFill') + '<b>' + esc(S.settings.city || 'Maison') + '</b><small>' + (WX.at ? 'mis à jour ' + F.time(new Date(WX.at)) : '') + '</small></div>' +
      '<div class="now"><b>' + WX.now.temp + '°</b><div><span class="cond">' + B.wxText(WX.now.code) + '</span><span class="feel">Ressenti ' + (WX.now.feel != null ? WX.now.feel : WX.now.temp) + '°</span></div>' + ico(B.wxIcon(WX.now.code, n), 'big') + '</div>' +
      (al ? '<div class="wal' + (al.warn ? ' warn' : '') + '">' + ico(al.icon) + esc(al.t) + '</div>' : '<div class="wal tm">' + ico(B.wxIcon(tm.code != null ? tm.code : WX.days[0].code, false)) + 'Demain : ' + B.wxText(tm.code != null ? tm.code : WX.days[0].code).toLowerCase() + ', ' + tm.max + '° / ' + tm.min + '°</div>') +
      '<div class="hrs">' + hrs.map((x, i) => '<div' + (i ? '' : ' class="cur"') + '><small>' + (i ? String(x.t.getHours()).padStart(2, '0') + 'h' : 'Maint.') + '</small>' + ico(B.wxIcon(x.code, night(x.t))) + '<b>' + Math.round(x.temp) + '°</b><em' + (x.prob >= 30 ? ' class="r"' : '') + '>' + (x.prob >= 10 ? x.prob + '%' : '') + '</em></div>').join('') + '</div>' +
      '<div class="st">' + sunRow + '<div>' + ico('wind') + WX.now.wind + ' km/h<small>Vent</small></div>' + (n ? '<div>' + ico('dropFill') + WX.now.rain + ' %<small>Pluie</small></div>' : '<div>' + ico('uv') + 'UV ' + WX.now.uv + '<small>' + B.uvLabel(WX.now.uv) + '</small></div>') + '</div></div>';
  };
  /* ---------- collectes des déchets (calendrier) ---------- */
  const KINDS = [['Ordures ménagères', '#8a94a8'], ['Poubelle jaune', '#ffd23f'], ['Verre', '#22e3a4'], ['Biodéchets', '#c08a4a'], ['Papier', '#4aa8ff'], ['Encombrants', '#9b6bff']];
  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  B.act('trashCfg', () => {
    const list = (S.trash || []);
    B.modal('<h2>' + ico('trash') + 'Collectes des déchets</h2>' +
      (list.length ? '<div class="list" style="margin-bottom:12px">' + list.map((t, i) => '<div class="li" style="grid-template-columns:14px 1fr auto"><i style="width:10px;height:10px;border-radius:50%;background:' + t.color + '"></i><div><b>' + esc(t.kind) + '</b><small>' + JOURS[t.wd] + ' · ' + (t.every === 2 ? 'une semaine sur deux' : t.every === 4 ? 'toutes les 4 semaines' : 'chaque semaine') + '</small></div><button class="sq" data-act="trashDel" data-arg="' + i + '" aria-label="Retirer">' + ico('trash') + '</button></div>').join('') + '</div>' : '<p class="muted" style="margin:0 0 12px;font-size:13.5px">Ajoutez vos jours de collecte : ils apparaissent dans l’agenda et, la veille au soir, l’écran verrouillé vous rappelle de sortir la poubelle.</p>') +
      '<form data-submit="trashAdd" style="display:flex;flex-direction:column;gap:12px"><div class="grid2"><label class="field">Type<select name="kind">' + KINDS.map(k => '<option>' + k[0] + '</option>').join('') + '</select></label><label class="field">Jour<select name="wd">' + JOURS.map((j, i) => '<option value="' + i + '">' + j + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="field">Fréquence<select name="every"><option value="1">Chaque semaine</option><option value="2">Une semaine sur deux</option><option value="4">Toutes les 4 semaines</option></select></label><label class="field">Prochaine collecte<input type="date" name="first" value="' + F.ymd(new Date()) + '"></label></div>' +
      '<p class="muted" style="margin:0;font-size:12px">Pour « une semaine sur deux », indiquez la date d’une prochaine collecte : les suivantes sont calculées à partir d’elle.</p>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Fermer</button><button class="btn pri">' + ico('plus') + 'Ajouter</button></div></form>', 'sm');
  });
  function gen(t) {
    S.events = S.events.filter(e => e.trash !== t.id);
    const start = new Date(t.first + 'T06:00'); start.setDate(start.getDate() + ((t.wd + 1) % 7 - start.getDay() + 7) % 7);
    for (let i = 0; i < 60; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i * 7 * t.every);
      if (d - Date.now() > 370 * 864e5) break;
      S.events.push({ id: 'tr' + t.id + '-' + i, trash: t.id, date: F.ymd(d), time: '06:00', dur: 30, title: t.kind, color: t.color });
    }
  }
  B.act('trashAdd', el => {
    const f = new FormData(el), k = KINDS.find(x => x[0] === f.get('kind')) || KINDS[0];
    const t = { id: Date.now().toString(36), kind: k[0], color: k[1], wd: +f.get('wd'), every: +f.get('every') || 1, first: f.get('first') || F.ymd(new Date()) };
    S.trash = (S.trash || []).concat(t); gen(t); B.save(); B.emit('cal'); B.emit('events'); B.emit('house');
    B.toast(t.kind + ' : ' + JOURS[t.wd].toLowerCase() + (t.every === 2 ? ', une semaine sur deux' : '') + ' — ajouté à l’agenda', 'trash'); B.ACT.trashCfg();
  });
  B.act('trashDel', el => { const t = S.trash.splice(+el.dataset.arg, 1)[0]; if (t) S.events = S.events.filter(e => e.trash !== t.id); B.save(); B.emit('cal'); B.emit('events'); B.ACT.trashCfg(); });
  // les collectes sont prolongées automatiquement chaque mois
  (S.trash || []).forEach(t => { const last = S.events.filter(e => e.trash === t.id).pop(); if (!last || new Date(last.date) - Date.now() < 300 * 864e5) gen(t); });
  const grid0 = RENDER.calgrid;
  RENDER.calgrid = s => grid0(s).replace('<button class="btn" data-act="icsUrl">', '<button class="btn" data-act="trashCfg" title="Jours de collecte des poubelles">' + ico('trash') + 'Poubelles</button><button class="btn" data-act="icsUrl">');
})();
