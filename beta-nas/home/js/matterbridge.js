/* Bêta home 7.7 / 7.10 — Alexa (pont Matter) et app Maison d'Apple (pont HomeKit), sans Home Assistant ni abonnement.
   Les deux ponts tournent dans le même conteneur du NAS (dossier bridge/). Pour chaque appareil relié en direct,
   routine (« Alexa, allume Soirée ciné », « Dis Siri, Soirée ciné ») ou déclencheur (sonnette, mode absent),
   on coche « Alexa » et/ou « Maison ». */
(function () {
  const B = window.BOS, { S, DATA, esc } = B;
  const M = { items: null, status: null, err: '' };
  const srv = () => B.Server && B.Server.ok();
  const TRIGGERS = [['sonnette', 'Sonnette', 'S’ouvre 8 s quand on sonne'], ['absent', 'Mode absent', 'Ouvert tant que la maison est en absence']];
  const OK_KINDS = ['light', 'rgb', 'plug', 'power', 'computer', 'cover', 'awning', 'garage', 'fan', 'valve', 'tv', 'speaker', 'clim', 'app', 'door', 'motion', 'leak', 'temp', 'hum', 'co2', 'lock'];
  const hubDevs = () => Object.keys(S.settings.hubMap || {}).filter(id => !(B.brandOff && B.brandOff(S.settings.hubMap[id].brand))).map(id => { const d = DATA.DEVICES[id]; return d && Object.assign({ id, k: B.kindOf ? B.kindOf(d) : d.type }, d); }).filter(d => d && OK_KINDS.includes(d.k));
  async function load() {
    if (!srv()) return;
    try { const r = await B.Server.req('/api/bridge'); M.items = r.items || []; M.status = r.status; M.err = ''; } catch (e) { M.err = e.message; }
  }
  const item = key => (M.items || []).find(i => i.key === key);
  const has = (key, to) => { const i = item(key); return !!i && !!i[to]; };
  const short = s => String(s).slice(0, 32);
  // nom donné à Alexa : on ajoute la pièce quand deux appareils portent le même nom (« Éclairage — Chambre 1 »)
  const alexaName = d => { const same = hubDevs().filter(x => x.name === d.name).length > 1; return short(same && d.room ? d.name + ' ' + d.room : d.name); };
  function body() {
    const st = M.status, on = st && !st.offline;
    const hk = st && st.hk, hkOn = hk && !st.offline;
    const head = !srv() ? '<p class="warn">Reliez d’abord le serveur Bêta (Connexions).</p>' : (st && st.matterErr && hkOn ? '' : 
      '<div class="mbstat ' + (on ? 'ok' : 'off') + '">' + ico(on ? 'check' : 'info') + '<div><b>' + (on ? 'Pont Matter en marche' + (st.commissioned ? ' · relié' + (st.fabrics && st.fabrics.length ? ' à ' + esc(st.fabrics.join(', ')) : '') : ' · pas encore appairé') : st ? 'Pont Matter arrêté' : 'Pont Matter pas encore installé') + '</b>' +
        '<small>' + (on ? st.devices + ' appareil(s) partagé(s)' : 'Lancez le conteneur « matter-bridge » du docker-compose (dossier bridge/).') + '</small></div>' +
        (on && st.manual ? '<div class="mbcode"><small>Code Alexa (Matter)</small><b class="sel">' + esc(String(st.manual).replace(/(\d{4})(\d{3})(\d{4})/, '$1-$2-$3')) + '</b></div>' : '') + '</div>') +
      (hkOn ? '<div class="mbstat ok hk">' + ico('homeFill') + '<div><b>Pont Maison (HomeKit) en marche' + (hk.paired ? ' · relié à l’app Maison' : ' · pas encore appairé') + '</b><small>' + hk.devices + ' appareil(s) dans Maison' + (st.matterErr ? ' · Matter indisponible : ' + esc(st.matterErr) : '') + '</small></div><div class="mbcode"><small>Code Maison</small><b class="sel">' + esc(hk.pin) + '</b></div></div>' : '');
    const box = (x, to, lbl, dis) => '<label class="mbto' + (dis ? ' dis' : '') + '" title="' + (dis ? 'Non partagé avec Alexa par sécurité' : lbl) + '"><input type="checkbox" data-change="mbPick" data-arg="' + esc(x.key) + '|' + to + '"' + (has(x.key, to) ? ' checked' : '') + (dis ? ' disabled' : '') + '>' + lbl + '</label>';
    const rows = (list, kind) => list.map(x => '<div class="mbrow"><span><b>' + esc(x.name) + '</b><small>' + esc(x.sub) + '</small></span>' + box(x, 'matter', 'Alexa', x.lock) + box(x, 'homekit', 'Maison') + '</div>').join('') || '<p class="muted mbnone">' + kind + '</p>';
    const devs = hubDevs().map(d => ({ key: 'd:' + d.id, name: alexaName(d), lock: d.k === 'lock', sub: (B.KIND && B.KIND[d.k] ? B.KIND[d.k][0] : d.k) + (d.room ? ' · ' + d.room : '') }));
    const routs = (S.routines || []).map(r => ({ key: 'b:' + r.id, name: r.name, sub: 'Bouton : « Alexa, allume ' + r.name + ' » · « Dis Siri, ' + r.name + ' »' }));
    const trigs = TRIGGERS.map(t => ({ key: 't:' + t[0], name: t[1], sub: 'Capteur d’ouverture · ' + t[2] }));
    return head + '<div class="mbgrid">' +
      '<section><h4>' + ico('homeFill') + 'Appareils partagés</h4><div class="mblist">' + rows(devs, 'Reliez d’abord des appareils dans Marques (Shelly, Hue, Zigbee2MQTT…).') + '</div></section>' +
      '<section><h4>' + ico('sparkle') + 'Routines Bêta</h4><div class="mblist">' + rows(routs, 'Aucune routine.') + '</div>' +
      '<h4 style="margin-top:14px">' + ico('bellFill') + 'Déclencheurs (automatisations)</h4><div class="mblist">' + rows(trigs, '') + '</div></section></div>' +
      '<ol class="steps mbsteps"><li><b>Maison (iPhone)</b> : app Maison › <b>+</b> › Ajouter un accessoire › Plus d’options › « Bêta home » › saisissez le <b>code Maison</b>. Les appareils cochés « Maison » apparaissent, utilisables avec Siri et dans les automatisations.</li><li><b>Alexa</b> : appli Alexa › <b>+</b> › Ajouter un appareil › <b>Matter</b> › « Oui » au QR code › <b>Essayer autrement</b> › saisissez le code d’appairage ci-dessus.</li><li>Les appareils cochés apparaissent dans Alexa (ajoutez-en d’autres ici : ils arrivent tout seuls).</li><li>Routines Alexa : « Quand Sonnette s’ouvre » → annonce sur les Echo ; « Alexa, bonne nuit » → allume le bouton « Bonne nuit ».</li></ol>' +
      '<p class="muted mbnote">' + ico('info') + 'Pas de caméras : Alexa n’accepte pas encore les caméras en Matter (elles restent sur HomeKit et dans Bêta home). Les caméras passent déjà par leur propre pont HomeKit (Découvrir). Serrures : seulement dans Maison (l’iPhone demande Face ID pour ouvrir). Le code Alexa fonctionne aussi pour Google Home.</p>';
  }
  async function open() { await load(); B.modal('<h2>' + ico('link') + 'Alexa et Maison</h2>' + body(), 'wide mbmodal'); }
  const redraw = () => { const m = document.querySelector('.mbmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button><h2>' + ico('link') + 'Alexa et Maison</h2>' + body(); m.scrollTop = sc; } };
  function itemOf(key) {
    const [t, id] = [key[0], key.slice(2)];
    if (t === 'd') { const d = DATA.DEVICES[id], r = (S.settings.hubMap || {})[id]; return d && r && { key, name: alexaName(Object.assign({ id }, d)), type: 'device', kind: B.kindOf ? B.kindOf(d) : d.type, brand: r.brand, id: r.id, room: d.room || '' }; }
    if (t === 'b') { const r = (S.routines || []).find(x => x.id === id); return r && { key, name: short(r.name), type: 'button', id }; }
    if (t === 't') { const g = TRIGGERS.find(x => x[0] === id); return g && { key, name: short(g[1]), type: 'trigger', id }; }
  }
  B.act('mbOpen', open);
  B.act('mbPick', async el => {
    const [key, to] = el.dataset.arg.split('|'), cur = item(key), list = (M.items || []).filter(i => i.key !== key);
    const it = Object.assign({ matter: false, homekit: false }, cur || itemOf(key), { [to]: el.checked });
    if (it.matter || it.homekit) list.push(it);
    const who = to === 'homekit' ? 'Maison' : 'Alexa';
    try { M.items = (await B.Server.req('/api/bridge', { items: list }, 'PUT')).items; B.toast(el.checked ? 'Partagé avec ' + who : 'Retiré de ' + who, 'link'); }
    catch (e) { el.checked = !el.checked; B.toast('Serveur Bêta : ' + e.message, 'info'); }
    redraw();
  });
  // « Alexa, allume Soirée ciné » : le pont prévient le serveur, l'écran lance la routine
  let evAt = 0;
  setInterval(async () => {
    if (!srv() || document.hidden) return;
    try {
      const r = await B.Server.req('/api/bridge/events?since=' + evAt);
      if (evAt) for (const ev of r.events) { if (ev.type !== 'button' || !B.runRoutine || ev.claimed) continue; const c = await B.Server.post('/api/bridge/claim', { t: ev.t }).catch(() => ({})); if (!c.ok) continue; B.src = 'alexa'; try { B.runRoutine(ev.id); } finally { B.src = null; } }
      evAt = r.now;
    } catch (e) { }
  }, 3000);

  /* ---------- accès : carte dans Connexions ---------- */
  const conn0 = B.RENDER.conn;
  if (conn0) B.RENDER.conn = s => conn0(s).replace('<div class="csave">', '<div class="ccard tile wide2"><div class="cch">' + B.badge('link') + '<div><b>Alexa et Maison (Apple)</b><small>Ponts Matter et HomeKit du NAS, sans Home Assistant ni abonnement · Siri, Alexa, Google Home</small></div></div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm pri" data-act="mbOpen">' + ico('link') + 'Choisir ce qui est partagé</button></div></div><div class="csave">');
})();
