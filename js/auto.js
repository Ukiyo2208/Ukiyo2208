/* Bêta OS — routines (Je pars, Je rentre, Bonne nuit, Réveil) et automatismes simples « Quand… alors… ».
   Ils s'exécutent tant que Bêta OS est ouvert (tablette murale). */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev, T, RENDER, box, F, WX } = B;
  const A = 'assets/', BG = A + 'bg/generic.jpg';

  if (!S.routines) S.routines = [
    { id: 'depart', name: 'Je pars', icon: 'door', a: { lights: 'off', ext: 'off', covers: 'close', alarm: 'on', clim: 'off', chauffage: 'Éco', music: 'stop', vacuum: true } },
    { id: 'retour', name: 'Je rentre', icon: 'homeFill', a: { lights: 'accueil', alarm: 'off', chauffage: 'Confort', music: 'play' } },
    { id: 'nuit', name: 'Bonne nuit', icon: 'moon', a: { lights: 'off', ext: 'off', covers: 'close', alarm: 'on', chauffage: 'Éco', music: 'stop' } },
    { id: 'reveil', name: 'Réveil', icon: 'sun2', time: '07:00', days: [1, 2, 3, 4, 5], sched: false, a: { covers: 'open', chauffage: 'Confort', music: 'radio', radio: 'r-fip' } }
  ];
  if (!S.autos) S.autos = [
    { id: 'a1', on: true, trig: { type: 'sunset', v: 0 }, act: { type: 'ext', v: 'on' } },
    { id: 'a2', on: true, trig: { type: 'doorbell' }, act: { type: 'camera', v: 'cam.sonnette' } },
    { id: 'a3', on: true, trig: { type: 'rain', v: 60 }, act: { type: 'arroOff' } },
    { id: 'a4', on: true, trig: { type: 'motion', v: 'cam.cour', night: true }, act: { type: 'light', v: 'ext.cour' } },
    { id: 'a5', on: false, trig: { type: 'time', v: '23:30' }, act: { type: 'routine', v: 'nuit' } }
  ];
  if (!S.autoRuns) S.autoRuns = {};

  /* ---------- routines ---------- */
  const all = (...t) => Object.keys(DATA.DEVICES).filter(id => t.includes(DATA.DEVICES[id].type) && !S.custom.hidden[id]);
  const OPT = {
    lights: [['', 'Ne rien changer'], ['off', 'Tout éteindre (intérieur)'], ['accueil', 'Allumer entrée, salon et cuisine'], ['ambiance', 'Lumières d’ambiance']],
    ext: [['', 'Ne rien changer'], ['off', 'Éteindre l’extérieur'], ['on', 'Allumer l’extérieur']],
    covers: [['', 'Ne rien changer'], ['close', 'Fermer tous les volets'], ['open', 'Ouvrir tous les volets']],
    alarm: [['', 'Ne rien changer'], ['on', 'Activer l’alarme'], ['off', 'Désactiver l’alarme']],
    clim: [['', 'Ne rien changer'], ['off', 'Couper les climatisations']],
    chauffage: [['', 'Ne rien changer'], ['Confort', 'Chauffage confort'], ['Éco', 'Chauffage éco'], ['Hors-gel', 'Hors-gel']],
    music: [['', 'Ne rien changer'], ['stop', 'Couper la musique'], ['play', 'Reprendre la musique'], ['radio', 'Lancer une radio']]
  };
  const LABEL = { lights: 'Lumières', ext: 'Extérieur', covers: 'Volets', alarm: 'Alarme', clim: 'Clim', chauffage: 'Chauffage', music: 'Musique' };
  function summary(r) {
    const a = r.a, out = [];
    Object.keys(OPT).forEach(k => { if (a[k]) { const o = OPT[k].find(x => x[0] === a[k]); out.push(o ? o[1] + (k === 'music' && a[k] === 'radio' ? ' (' + ((DATA.RADIOS.find(x => x.id === a.radio) || {}).name || 'radio') + ')' : '') : ''); } });
    if (a.vacuum) out.push('Lancer l’aspirateur');
    return out.filter(Boolean);
  }
  function runRoutine(id, quiet) {
    const r = S.routines.find(x => x.id === id); if (!r) return;
    const a = r.a;
    if (a.lights === 'off') all('light', 'group').filter(i => !i.startsWith('ext.')).forEach(i => setDev(i, { on: false }));
    if (a.lights === 'accueil') ['rdc.entree.light', 'rdc.salon.light', 'rdc.cuisine.applique'].forEach(i => DATA.DEVICES[i] && setDev(i, { on: true }));
    if (a.lights === 'ambiance') all('light').filter(i => /amb|Applique/i.test(DATA.DEVICES[i].name) || DATA.DEVICES[i].def.rgb).forEach(i => setDev(i, Object.assign({ on: true }, DATA.DEVICES[i].def.rgb ? { color: '#ff9a4a' } : {})));
    if (a.ext) all('light', 'group').filter(i => i.startsWith('ext.')).forEach(i => setDev(i, { on: a.ext === 'on' }));
    if (a.covers) all('cover').filter(i => i !== 'rdc.garage.door' && i !== 'ext.store').forEach(i => setDev(i, { pos: a.covers === 'open' ? 100 : 0 }));
    if (a.alarm) { S.alarm = a.alarm === 'on'; B.emit('house'); }
    if (a.clim === 'off') all('clim').filter(i => i !== 'home.chauffage').forEach(i => setDev(i, { on: false }));
    if (a.chauffage) setDev('home.chauffage', { on: true, mode: a.chauffage, temp: { Confort: 21.5, 'Éco': 19, 'Hors-gel': 8 }[a.chauffage] });
    if (a.music === 'stop' && B.Music.playing) B.Music.pause();
    if (a.music === 'play') B.Music.resume();
    if (a.music === 'radio') B.Music.play(a.radio || 'r-fip');
    if (a.vacuum) setDev('rdc.robot', { status: 'cleaning' });
    B.save();
    if (B.fx) B.fx.sound('chime');
    if (!quiet) B.toast(r.name + ' : c’est fait (' + summary(r).length + ' action' + (summary(r).length > 1 ? 's' : '') + ')', r.icon);
  }
  B.runRoutine = runRoutine;
  B.act('routine', el => runRoutine(el.dataset.arg));

  /* ---------- automatismes ---------- */
  const TRIG = { time: 'À une heure précise', sunset: 'Au coucher du soleil', sunrise: 'Au lever du soleil', doorbell: 'Quand on sonne', motion: 'Mouvement détecté par une caméra', rain: 'Pluie annoncée pendant l’arrosage' };
  const ACTS = { routine: 'Lancer une routine', ext: 'Éclairage extérieur', light: 'Allumer une lumière', camera: 'Afficher une caméra', arroOff: 'Couper l’arrosage', notify: 'M’envoyer une notification', scene: 'Action rapide' };
  const sentence = a => {
    const t = a.trig, c = a.act;
    const when = t.type === 'time' ? 'À ' + t.v : t.type === 'sunset' ? 'Au coucher du soleil' + (t.v ? ' (' + (t.v > 0 ? '+' : '') + t.v + ' min)' : '') : t.type === 'sunrise' ? 'Au lever du soleil' + (t.v ? ' (' + (t.v > 0 ? '+' : '') + t.v + ' min)' : '') : t.type === 'doorbell' ? 'Quand on sonne' : t.type === 'motion' ? 'Mouvement « ' + ((DATA.CAMS[t.v] || {}).name || 'caméra') + ' »' + (t.night ? ' la nuit' : '') : 'S’il va pleuvoir (≥ ' + t.v + ' %)';
    const what = c.type === 'routine' ? 'routine « ' + ((S.routines.find(r => r.id === c.v) || {}).name || '?') + ' »' : c.type === 'ext' ? (c.v === 'on' ? 'allumer' : 'éteindre') + ' l’extérieur' : c.type === 'light' ? 'allumer « ' + ((DATA.DEVICES[c.v] || {}).room || '') + ' · ' + ((DATA.DEVICES[c.v] || {}).name || '?') + ' »' : c.type === 'camera' ? 'afficher « ' + ((DATA.CAMS[c.v] || {}).name || 'caméra') + ' »' : c.type === 'arroOff' ? 'couper l’arrosage' : c.type === 'scene' ? ((B.SCENES[c.v] || {}).label || 'action').toLowerCase() : 'notification « ' + (c.v || '') + ' »';
    return when + ' → ' + what;
  };
  function doAct(a) {
    const c = a.act;
    if (c.type === 'routine') runRoutine(c.v, true);
    else if (c.type === 'ext') all('light', 'group').filter(i => i.startsWith('ext.')).forEach(i => setDev(i, { on: c.v === 'on' }));
    else if (c.type === 'light') setDev(c.v, { on: true });
    else if (c.type === 'camera') { const el = document.createElement('i'); el.dataset.id = c.v; B.ACT.cam(el); }
    else if (c.type === 'arroOff') { if (dev('ext.arrosage').on) setDev('ext.arrosage', { on: false }); }
    else if (c.type === 'scene' && B.SCENES[c.v]) B.SCENES[c.v].run();
    B.notify({ badge: 'edit', title: 'Automatisme', text: esc(sentence(a)), ttl: 8000 });
    S.autoRuns[a.id] = Date.now(); B.save(); B.emit('autos');
  }
  const hm = d => F.time(d);
  const today = () => F.ymd(new Date());
  function tick() {
    const now = new Date(), t = hm(now), day = now.getDay();
    // routines programmées (réveil…)
    S.routines.forEach(r => { if (r.sched && r.time === t && (!r.days || r.days.includes(day)) && S.autoRuns['r:' + r.id] !== today()) { S.autoRuns['r:' + r.id] = today(); runRoutine(r.id); } });
    S.autos.forEach(a => {
      if (!a.on) return;
      const tr = a.trig;
      let target = null;
      if (tr.type === 'time') target = tr.v;
      if (tr.type === 'sunset' && WX.sun) target = hm(new Date(+WX.sun.set + (tr.v || 0) * 6e4));
      if (tr.type === 'sunrise' && WX.sun) target = hm(new Date(+WX.sun.rise + (tr.v || 0) * 6e4));
      if (target && target === t && S.autoRuns[a.id + ':d'] !== today()) { S.autoRuns[a.id + ':d'] = today(); doAct(a); }
    });
  }
  setInterval(tick, 20000);
  // pluie annoncée pendant l'arrosage
  function rainCheck() {
    const a = S.autos.find(x => x.on && x.trig.type === 'rain');
    if (!a || !dev('ext.arrosage').on) return;
    const r = B.rainSoon(3);
    if (r.prob >= a.trig.v || r.mm >= 1) {
      setDev('ext.arrosage', { on: false });
      B.notify({ badge: 'weather', title: 'Arrosage annulé', text: 'Il va pleuvoir : ' + r.prob + ' % dans les 3 h (' + r.mm.toFixed(1).replace('.', ',') + ' mm). Pas besoin d’arroser !', actions: [['Arroser quand même', 'arroForce', '', '']], ttl: 15000 });
      S.autoRuns[a.id] = Date.now(); B.save();
    }
  }
  B.act('arroForce', el => { S.arroForce = Date.now(); setDev('ext.arrosage', { on: true }); el.closest('.notify').remove(); });
  B.on('dev', d => { if (d.id === 'ext.arrosage' && d.patch.on && !(S.arroForce && Date.now() - S.arroForce < 6e4)) setTimeout(rainCheck, 300); });
  B.on('weather', rainCheck);
  B.on('doorbell', () => {
    B.camState('cam.sonnette').ev = { type: 'person', ago: 0 }; B.emit('cam:cam.sonnette');
    if (B.fx) B.fx.sound('dingdong');
    const a = S.autos.find(x => x.on && x.trig.type === 'doorbell');
    if (a) doAct(a); else B.notify({ badge: 'cam', title: 'On sonne à la porte', text: 'Quelqu’un est devant la sonnette.', actions: [['Voir', 'cam', 'cam.sonnette', 'pri']] });
  });
  B.on('motion', cid => {
    S.autos.filter(a => a.on && a.trig.type === 'motion' && a.trig.v === cid).forEach(a => { if (!a.trig.night || B.isNight()) doAct(a); });
  });
  B.act('testDoorbell', () => B.fire('doorbell', 'test'));

  /* ---------- page Routines & automatismes ---------- */
  RENDER.rlist = () => '<div class="rtn scroll">' + S.routines.map(r => '<div class="tile rcard"><span class="bdg" style="--g1:#7a5bff;--g2:#2fb6ff;--s:46px">' + ico(r.icon) + '</span>' +
    '<div class="rt"><b>' + esc(r.name) + (r.sched ? ' <span class="tag2">' + ico('calendar') + r.time + ' · ' + daysTxt(r.days) + '</span>' : '') + '</b><small>' + (summary(r).join(' · ') || 'Aucune action') + '</small></div>' +
    '<div class="row"><button class="btn sm" data-act="routineEdit" data-arg="' + r.id + '">' + ico('edit') + '</button><button class="btn pri" data-act="routine" data-arg="' + r.id + '">' + ico('play') + 'Lancer</button></div></div>').join('') + '</div>';
  RENDER.alist = () => '<div class="list scroll" style="flex:1">' + S.autos.map(a => '<div class="li auto"><span class="ic">' + ico({ time: 'calendar', sunset: 'moon', sunrise: 'sun2', doorbell: 'bellFill', motion: 'walk', rain: 'rain' }[a.trig.type] || 'sparkle') + '</span>' +
    '<div><b>' + esc(sentence(a)) + '</b><small>' + (S.autoRuns[a.id] ? 'Dernière fois : ' + new Date(S.autoRuns[a.id]).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Pas encore déclenché') + '</small></div>' +
    '<div class="row" style="gap:6px"><button class="sw sm' + (a.on ? ' on' : '') + '" data-act="autoToggle" data-arg="' + a.id + '" role="switch" aria-label="Activer"></button><button class="sq" data-act="autoEdit" data-arg="' + a.id + '" aria-label="Modifier">' + ico('edit') + '</button><button class="sq" data-act="autoDel" data-arg="' + a.id + '" aria-label="Supprimer">' + ico('trash') + '</button></div></div>').join('') + '</div>' +
    '<div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn pri" data-act="autoEdit">' + ico('plus') + 'Nouvel automatisme</button><button class="btn" data-act="testDoorbell">' + ico('bellFill') + 'Tester la sonnette</button></div>' +
    '<p class="muted" style="font-size:12px;margin:10px 0 0;line-height:1.45">Ces automatismes tournent tant que Bêta OS est ouvert (idéal sur la tablette murale). Pour qu’ils fonctionnent même tablette éteinte, recréez-les dans Home Assistant.</p>';
  const DN = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  function daysTxt(d) { if (!d || d.length === 7) return 'tous les jours'; if (d.join() === '1,2,3,4,5') return 'en semaine'; if (d.join() === '0,6') return 'le week-end'; return d.map(i => DN[i]).join(' '); }
  B.act('autoToggle', el => { const a = S.autos.find(x => x.id === el.dataset.arg); a.on = !a.on; B.save(); B.emit('autos'); });
  B.act('autoDel', el => { S.autos = S.autos.filter(x => x.id !== el.dataset.arg); B.save(); B.emit('autos'); });
  B.act('routineEdit', el => {
    const r = S.routines.find(x => x.id === el.dataset.arg), a = r.a;
    const sel = (k) => '<label class="field">' + LABEL[k] + '<select name="' + k + '">' + OPT[k].map(o => '<option value="' + o[0] + '"' + ((a[k] || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    B.modal('<h2>' + ico(r.icon) + 'Routine « ' + esc(r.name) + ' »</h2><form data-submit="routineSave" data-arg="' + r.id + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2">' + Object.keys(OPT).map(sel).join('') + '<label class="field">Radio<select name="radio">' + DATA.RADIOS.map(x => '<option value="' + x.id + '"' + (a.radio === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label></div>' +
      '<label class="row" style="gap:10px;font-size:14px"><input type="checkbox" name="vacuum"' + (a.vacuum ? ' checked' : '') + '> Lancer l’aspirateur robot</label>' +
      '<div class="tile" style="padding:12px;display:flex;flex-wrap:wrap;gap:12px;align-items:center"><label class="row" style="gap:10px;font-size:14px"><input type="checkbox" name="sched"' + (r.sched ? ' checked' : '') + '> Programmer à</label><input type="time" name="time" value="' + (r.time || '07:00') + '" class="search" style="flex:0 0 120px">' +
      '<div class="row" style="gap:4px">' + [1, 2, 3, 4, 5, 6, 0].map(i => '<label class="dayck"><input type="checkbox" name="d' + i + '"' + ((r.days || [1, 2, 3, 4, 5]).includes(i) ? ' checked' : '') + ' hidden><span>' + DN[i] + '</span></label>').join('') + '</div></div>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>');
  });
  B.act('routineSave', el => {
    const r = S.routines.find(x => x.id === el.dataset.arg), f = new FormData(el);
    Object.keys(OPT).forEach(k => r.a[k] = f.get(k) || ''); r.a.radio = f.get('radio'); r.a.vacuum = !!f.get('vacuum');
    r.sched = !!f.get('sched'); r.time = f.get('time') || '07:00'; r.days = [0, 1, 2, 3, 4, 5, 6].filter(i => f.get('d' + i));
    B.save(); B.closeModal(); B.emit('autos'); B.toast('Routine enregistrée', 'check');
  });
  B.act('autoEdit', el => {
    const a = S.autos.find(x => x.id === el.dataset.arg) || { id: 'a' + Date.now(), on: true, trig: { type: 'time', v: '19:00' }, act: { type: 'routine', v: 'nuit' } };
    const o = (obj, cur) => Object.keys(obj).map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + obj[k] + '</option>').join('');
    B.modal('<h2>' + ico('sparkle') + 'Automatisme</h2><form data-submit="autoSave" data-arg="' + a.id + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="field">Quand…<select name="tt" data-change="autoForm">' + o(TRIG, a.trig.type) + '</select></label>' +
      '<label class="field" data-show="time">Heure<input type="time" name="time" value="' + (a.trig.type === 'time' ? a.trig.v : '19:00') + '"></label>' +
      '<label class="field" data-show="sunset sunrise">Décalage (minutes)<input type="number" name="off" step="5" value="' + (/sun/.test(a.trig.type) ? a.trig.v || 0 : 0) + '"></label>' +
      '<label class="field" data-show="motion">Caméra<select name="cam">' + Object.keys(DATA.CAMS).map(k => '<option value="' + k + '"' + (a.trig.v === k ? ' selected' : '') + '>' + esc(DATA.CAMS[k].name) + '</option>').join('') + '</select></label>' +
      '<label class="field" data-show="rain">Probabilité de pluie (%)<input type="number" name="prob" min="10" max="100" step="5" value="' + (a.trig.type === 'rain' ? a.trig.v : 60) + '"></label>' +
      '<label class="row" data-show="motion" style="gap:8px;font-size:14px"><input type="checkbox" name="night"' + (a.trig.night ? ' checked' : '') + '> seulement la nuit</label></div>' +
      '<div class="grid2"><label class="field">Alors…<select name="at" data-change="autoForm">' + o(ACTS, a.act.type) + '</select></label>' +
      '<label class="field" data-show2="routine">Routine<select name="routine">' + S.routines.map(r => '<option value="' + r.id + '"' + (a.act.v === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label>' +
      '<label class="field" data-show2="ext">Extérieur<select name="ext"><option value="on"' + (a.act.v === 'on' ? ' selected' : '') + '>Allumer</option><option value="off"' + (a.act.v === 'off' ? ' selected' : '') + '>Éteindre</option></select></label>' +
      '<label class="field" data-show2="light">Lumière<select name="light">' + all('light', 'group').map(k => '<option value="' + k + '"' + (a.act.v === k ? ' selected' : '') + '>' + esc(DATA.DEVICES[k].room + ' · ' + DATA.DEVICES[k].name) + '</option>').join('') + '</select></label>' +
      '<label class="field" data-show2="camera">Caméra<select name="camera">' + Object.keys(DATA.CAMS).map(k => '<option value="' + k + '"' + (a.act.v === k ? ' selected' : '') + '>' + esc(DATA.CAMS[k].name) + '</option>').join('') + '</select></label>' +
      '<label class="field" data-show2="scene">Action<select name="scene">' + Object.keys(B.SCENES).map(k => '<option value="' + k + '"' + (a.act.v === k ? ' selected' : '') + '>' + esc(B.SCENES[k].label) + '</option>').join('') + '</select></label>' +
      '<label class="field" data-show2="notify">Message<input name="msg" value="' + esc(a.act.type === 'notify' ? a.act.v : '') + '" placeholder="Pensez à sortir les poubelles"></label></div>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>');
    autoForm(document.querySelector('[data-submit="autoSave"]'));
  });
  function autoForm(f) {
    const tt = f.tt.value, at = f.at.value;
    f.querySelectorAll('[data-show]').forEach(e => e.hidden = !e.dataset.show.split(' ').includes(tt));
    f.querySelectorAll('[data-show2]').forEach(e => e.hidden = e.dataset.show2 !== at);
  }
  B.act('autoForm', el => autoForm(el.form));
  B.act('autoSave', el => {
    const f = new FormData(el), tt = f.get('tt'), at = f.get('at');
    const trig = { type: tt, v: tt === 'time' ? f.get('time') : /sun/.test(tt) ? +f.get('off') || 0 : tt === 'motion' ? f.get('cam') : tt === 'rain' ? +f.get('prob') || 60 : '' };
    if (tt === 'motion') trig.night = !!f.get('night');
    const act = { type: at, v: at === 'routine' ? f.get('routine') : at === 'ext' ? f.get('ext') : at === 'light' ? f.get('light') : at === 'camera' ? f.get('camera') : at === 'scene' ? f.get('scene') : at === 'notify' ? f.get('msg') : '' };
    const i = S.autos.findIndex(x => x.id === el.dataset.arg), a = { id: el.dataset.arg, on: true, trig, act };
    if (i >= 0) S.autos[i] = a; else S.autos.push(a);
    B.save(); B.closeModal(); B.emit('autos'); B.toast('Automatisme enregistré', 'sparkle');
  });

  B.route('routines', { title: 'Routines', bg: BG, render: () => B.side('routines') + B.header({ id: 'routines', title: 'Routines', sub: 'Scénarios et automatismes de la maison', icon: 'sparkle', info: { t: 'infobox', keys: ['autos', 'weather'], items: () => {
    const nx = S.routines.filter(r => r.sched).map(r => r.time).sort()[0];
    return [{ icon: 'sparkle', v: S.routines.length, l: 'Routines', cls: 'c' }, { icon: 'calendar', v: nx || '—', l: 'Programmée' }, { icon: 'shieldCheck', v: S.autos.filter(a => a.on).length + '/' + S.autos.length, l: 'Automatismes', cls: 'g' }, { icon: 'moon', v: WX.sun ? F.time(WX.sun.set) : '—', l: 'Coucher du soleil', cls: 'y' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 760, 1012]) + '">' + B.whead('power', 'Routines') + T({ t: 'rlist', keys: ['autos'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([770, 235, 1522, 1012]) + '">' + B.whead('edit', 'Automatismes « Quand… alors… »') + T({ t: 'alist', keys: ['autos'] }) + '</section>' });
})();
