/* Bêta home 7.9 — assistant « plug & play » : le serveur Bêta cherche les appareils du réseau, propose les marques
   trouvées, ne demande que les informations indispensables, connecte, importe les appareils dans leurs pièces,
   ajoute les caméras et masque toutes les autres marques. Lancé à la création (mode « Plug & play ») ou depuis Marques. */
(function () {
  const B = window.BOS, { S, DATA, esc } = B;
  // marques sans signature réseau (comptes en ligne ou logiciels) : proposées en « Vous avez aussi… ? »
  const ASK = ['netatmo', 'tado', 'linky', 'solaire', 'spotify', 'verisure', 'cozytouch', 'wallbox', 'easee', 'ocpp', 'sensibo', 'switchbot', 'govee', 'smartthings', 'homeconnect', 'husqvarna', 'viessmann', 'tuya', 'z2m', 'zwavejs', 'matter', 'musicassistant', 'frigate', 'mqttha', 'androidtv', 'nuki', 'broadlink', 'kasa', 'tapo', 'lifx'];
  const OPT = /option|si protégé|si demandé|pour le wi-fi|pour l’allumer|nom de la tv|^nom$|appareils à suivre/i;
  let P = null;
  const Hub = () => B.Hub, BR = id => Hub().BR(id);

  /* ---------- étapes ---------- */
  function open(o) {
    if (!B.Server.ok()) return B.toast('L’assistant a besoin du serveur Bêta du NAS (Connexions)', 'server');
    P = { step: 'scan', setup: !!(o && o.setup), res: null, found: {}, pick: {}, form: {}, st: {}, cams: [], camOn: true, camUser: 'admin', camPass: '', busy: false };
    paint(); scan();
  }
  async function scan() {
    try { P.res = await Hub().call('/api/discover', { rtsp: true }); }
    catch (e) { P.err = e.message; P.res = { devices: [] }; }
    const f = {};
    (P.res.devices || []).forEach(d => {
      const m = /^brand:(\w+)$/.exec(d.link || ''); if (!m || !BR(m[1])) return;
      const x = f[m[1]] = f[m[1]] || { ips: [], names: [] }; if (!x.ips.includes(d.ip)) { x.ips.push(d.ip); x.names.push(d.name || d.ip); }
    });
    P.found = f; Object.keys(f).forEach(id => { P.pick[id] = true; prefill(id); });
    P.cams = (P.res.devices || []).filter(d => d.type === 'camera' && !(S.netcams || []).some(c => c.ip === d.ip));
    P.step = 'brands'; paint();
  }
  function prefill(id) {
    const b = BR(id), x = P.found[id], f = P.form[id] = P.form[id] || {}, cfg = (Hub().H.list[id] || {}).cfg || {};
    (b.fields || []).forEach(([k]) => { if (cfg[k] != null && cfg[k] !== '' && f[k] == null) f[k] = cfg[k]; });
    if (!x) return;
    if ((b.fields || []).some(q => q[0] === 'hosts') && !f.hosts) f.hosts = x.ips.map((ip, i) => id === 'cast' || id === 'fully' ? ip + ':' + x.names[i] : ip).join(', ');
    if ((b.fields || []).some(q => q[0] === 'host') && !f.host) f.host = x.ips[0];
  }
  // champs à demander : les obligatoires vides, et ceux qu'une action (appairage, code) utilise
  const fieldsOf = b => (b.fields || []).filter(q => !(q[2] && q[2].tmp) || (b.actions && b.actions.length));
  const missing = id => { const b = BR(id), f = P.form[id] || {}; return fieldsOf(b).filter(q => !(q[2] && q[2].tmp) && !OPT.test(q[1]) && !String(f[q[0]] || '').trim()); };
  const isAuto = id => { const b = BR(id); return !b.oauth && !(b.actions && b.actions.length) && !missing(id).length; };

  /* ---------- affichage ---------- */
  function paint() {
    const steps = ['scan', 'brands', 'infos', 'done'], i = steps.indexOf(P.step);
    let h = '';
    if (P.step === 'scan') h = '<div class="pp-scan"><span class="pp-radar">' + ico('search2') + '</span><h3>Recherche de vos appareils…</h3><p class="muted">Le serveur Bêta écoute le réseau de la maison (Bonjour, UPnP, caméras ONVIF, diffusion). Environ 10 secondes.</p></div>';
    if (P.step === 'brands') {
      const ids = Object.keys(P.found), ask = ASK.filter(id => BR(id) && BR(id).ready && !P.found[id]);
      h = '<h3>' + (ids.length ? ids.length + ' marque' + (ids.length > 1 ? 's' : '') + ' trouvée' + (ids.length > 1 ? 's' : '') + ' chez vous' : 'Aucune marque reconnue automatiquement') + '</h3>' +
        (P.err ? '<p class="warn">' + esc(P.err) + '</p>' : '') +
        '<div class="pp-grid">' + ids.map(id => { const b = BR(id), x = P.found[id]; return '<label class="pp-card' + (P.pick[id] ? ' on' : '') + '"><input type="checkbox" data-change="ppPick" data-arg="' + id + '"' + (P.pick[id] ? ' checked' : '') + '><span class="bdg" style="--g1:#2fe0ff;--g2:#1f7dff;--s:40px">' + ico(b.icon) + '</span><span><b>' + esc(b.name) + '</b><small>' + x.ips.length + ' appareil' + (x.ips.length > 1 ? 's' : '') + ' · ' + esc(x.names.slice(0, 3).join(', ')) + (x.names.length > 3 ? '…' : '') + '</small><em>' + (isAuto(id) ? ico('check') + 'Connexion automatique' : ico('edit') + 'Une info à donner') + '</em></span></label>'; }).join('') + '</div>' +
        (P.cams.length ? '<section class="pp-cams"><label class="row" style="gap:10px"><input type="checkbox" data-change="ppCamOn"' + (P.camOn ? ' checked' : '') + '><b>' + ico('camera') + P.cams.length + ' caméra' + (P.cams.length > 1 ? 's' : '') + ' trouvée' + (P.cams.length > 1 ? 's' : '') + '</b><small class="muted">' + esc(P.cams.map(c => c.brand || c.name).slice(0, 4).join(', ')) + '</small></label>' +
          '<div class="grid2"><label class="field">Identifiant des caméras<input data-input="ppCam" data-arg="u" value="' + esc(P.camUser) + '" autocomplete="off"></label><label class="field">Mot de passe des caméras<input type="password" data-input="ppCam" data-arg="p" value="' + esc(P.camPass) + '" autocomplete="off"></label></div><p class="muted pp-note">Le même pour toutes (sinon, ajoutez-les ensuite une par une dans Découvrir). Il reste sur le NAS.</p></section>' : '') +
        '<h4 class="pp-h4">Vous avez aussi… ?</h4><p class="muted pp-note">Ces marques ne se voient pas sur le réseau (compte en ligne, logiciel, clé USB) : touchez celles que vous avez.</p><div class="pp-chips">' +
        ask.map(id => '<button type="button" class="pinc' + (P.pick[id] ? ' on' : '') + '" data-act="ppAsk" data-arg="' + id + '">' + ico(BR(id).icon) + esc(BR(id).name) + '</button>').join('') + '</div>';
    }
    if (P.step === 'infos') {
      const ids = Object.keys(P.pick).filter(id => P.pick[id]);
      h = '<h3>Les infos importantes</h3><p class="muted pp-note">Seulement ce que Bêta home ne peut pas deviner. Les marques marquées « automatique » se connectent seules.</p><div class="pp-list">' + ids.map(id => {
        const b = BR(id), f = P.form[id] || {}, st = P.st[id] || {}, need = fieldsOf(b), auto = isAuto(id);
        return '<section class="pp-b ' + (st.ok ? 'ok' : st.err ? 'err' : '') + '"><div class="pp-bh"><span class="bdg" style="--g1:#2fe0ff;--g2:#1f7dff;--s:34px">' + ico(b.icon) + '</span><b>' + esc(b.name) + '</b><span class="pp-st">' +
          (st.busy ? ico('refresh') + 'Connexion…' : st.ok ? ico('check') + (st.n != null ? st.n + ' appareil' + (st.n > 1 ? 's' : '') + ' ajouté' + (st.n > 1 ? 's' : '') : 'Connecté') : st.err ? ico('alert') + esc(st.err) : auto ? ico('sparkle') + 'Automatique' : '') + '</span></div>' +
          (auto && !st.err ? '' : (b.steps && b.steps[0] ? '<p class="pp-tip">' + b.steps[0] + '</p>' : '') +
            (need.length ? '<div class="grid2">' + need.map(q => '<label class="field">' + esc(q[1]) + (OPT.test(q[1]) ? '' : ' *') + '<input data-input="ppIn" data-arg="' + id + '|' + q[0] + '" value="' + esc(q[2] && q[2].pw && f[q[0]] === '••••' ? '' : f[q[0]] || '') + '"' + (q[2] && q[2].pw ? ' type="password" placeholder="' + (f[q[0]] === '••••' ? 'déjà enregistré' : '') + '"' : q[2] && q[2].ph ? ' placeholder="' + esc(q[2].ph) + '"' : '') + ' autocomplete="off" spellcheck="false"></label>').join('') + '</div>' : '') +
            ((b.actions || []).length ? '<div class="row pp-acts">' + b.actions.map(a => '<button type="button" class="btn sm" data-act="ppAct" data-arg="' + id + ':' + a[0] + '">' + ico(a[2]) + a[1] + '</button>').join('') + '</div>' : '') +
            (b.oauth ? '<p class="muted pp-note">' + ico('link') + 'Connexion au compte à terminer ensuite dans Marques › ' + esc(b.name) + ' (« Se connecter »).</p>' : '')) +
          (st.info && !st.ok ? '<p class="muted pp-note">' + esc(st.info) + '</p>' : '') + '</section>';
      }).join('') +
        (P.camOn && P.cams.length ? '<section class="pp-b ' + (P.camSt && P.camSt.ok ? 'ok' : P.camSt && P.camSt.err ? 'err' : '') + '"><div class="pp-bh"><span class="bdg" style="--g1:#2fe0ff;--g2:#1f7dff;--s:34px">' + ico('camera') + '</span><b>Caméras</b><span class="pp-st">' + (P.camSt ? (P.camSt.busy ? ico('refresh') + 'Ajout…' : P.camSt.ok ? ico('check') + P.camSt.n + ' ajoutée(s)' : ico('alert') + esc(P.camSt.err)) : P.cams.length + ' à ajouter') + '</span></div></section>' : '') + '</div>';
    }
    if (P.step === 'done') {
      const ok = Object.keys(P.st).filter(id => P.st[id].ok), n = ok.reduce((a, id) => a + (P.st[id].n || 0), 0), todo = Object.keys(P.pick).filter(id => P.pick[id] && !(P.st[id] && P.st[id].ok));
      h = '<div class="pp-scan"><span class="pp-radar done">' + ico('check') + '</span><h3>Votre maison est prête</h3><p>' + ok.length + ' marque' + (ok.length > 1 ? 's' : '') + ' connectée' + (ok.length > 1 ? 's' : '') + ', ' + n + ' appareil' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') + (P.camSt && P.camSt.n ? ', ' + P.camSt.n + ' caméra(s)' : '') + '.</p>' +
        (todo.length ? '<p class="muted">À terminer dans Marques : ' + esc(todo.map(id => BR(id).name).join(', ')) + '.</p>' : '') +
        '<p class="muted pp-note">Seules vos marques restent affichées ; les autres sont masquées (Paramètres › Marques pour en remettre). Les nouvelles pièces sont rangées par nom de marque ou de pièce : renommez-les ou déplacez les appareils à votre goût.</p></div>';
    }
    const nav = P.step === 'scan' ? '' : '<div class="sw-nav">' + (P.step === 'brands' || P.step === 'done' ? '<span></span>' : '<button class="btn" data-act="ppBack">' + ico('chevL') + 'Retour</button>') +
      (P.step === 'brands' ? '<button class="btn pri" data-act="ppNext"' + (Object.values(P.pick).some(Boolean) || (P.camOn && P.cams.length) ? '' : ' disabled') + '>Continuer' + ico('chevR') + '</button>' :
        P.step === 'infos' ? '<div class="row" style="gap:8px"><button class="btn" data-act="ppFinish">Terminer</button><button class="btn pri" data-act="ppGo"' + (P.busy ? ' disabled' : '') + '>' + ico('bolt') + 'Tout connecter</button></div>' :
          '<button class="btn pri" data-act="ppClose">' + ico('check') + 'C’est parti</button>') + '</div>';
    const html = '<div class="setupw pp"><div class="sw-steps">' + ['scan', 'brands', 'infos', 'done'].map((s, k) => '<i class="' + (k < i ? 'done' : k === i ? 'on' : '') + '"></i>').join('') + '</div><h2 class="pp-title">' + ico('sparkle') + 'Plug & play</h2><div class="sw-body">' + h + '</div>' + nav + '</div>';
    const box = document.querySelector('.modal .box.ppmodal');
    if (box) { const sc = box.querySelector('.sw-body') ? box.querySelector('.sw-body').scrollTop : 0; box.innerHTML = (P.setup ? '' : '<button class="x" data-act="ppClose" aria-label="Fermer">' + ico('x') + '</button>') + html; const nb = box.querySelector('.sw-body'); if (nb) nb.scrollTop = sc; }
    else { B.modal(html, 'setup wide ppmodal'); if (P.setup) { const x = document.querySelector('.modal .box.ppmodal .x'); if (x) x.remove(); } }
  }

  /* ---------- connexion ---------- */
  const fieldsBody = (id, all) => { const b = BR(id), f = P.form[id] || {}, o = {}; (b.fields || []).forEach(([k, , opt]) => { if (f[k] == null || f[k] === '' || f[k] === '••••') return; if (!all && opt && opt.tmp) return; o[k] = String(f[k]).trim(); }); return o; };
  async function connect(id) {
    const b = BR(id), st = P.st[id] = { busy: true }; paint();
    try {
      const body = fieldsBody(id);
      if (Object.keys(body).length) await Hub().call('/api/hub/' + id, body, 'PUT');
      if (b.oauth) { const x = await Hub().call('/api/hub/' + id); if (!x.linked) throw new Error('compte à relier dans Marques (« Se connecter »)'); }
      const t = await Hub().call('/api/hub/' + id + '/test', {});
      if (t.status !== 'ok') throw new Error(t.info || 'pas de réponse');
      st.n = await Hub().autoImport(id); st.ok = true; delete st.err;
    } catch (e) { st.err = e.message; }
    st.busy = false; paint();
  }
  async function addCams() {
    if (!P.camOn || !P.cams.length || (P.camSt && P.camSt.ok) || !B.Disc) return;
    P.camSt = { busy: true }; paint(); let n = 0, err = '';
    for (const c of P.cams) {
      try {
        let rtsp = '';
        const auth = P.camUser ? encodeURIComponent(P.camUser) + ':' + encodeURIComponent(P.camPass) + '@' : '';
        if (c.onvif) { const r = await B.Server.post('/api/cams/onvif', { xaddr: c.onvif, user: P.camUser, pass: P.camPass }); if (r.error) throw new Error(r.error); rtsp = r.streams[0].rtsp.replace(/^rtsp:\/\/(?:[^@/]*@)?/, 'rtsp://' + auth); }
        else rtsp = 'rtsp://' + auth + c.ip + ':' + (c.rtspPort || 554) + '/';
        await B.Disc.pushCams({ name: (c.name || 'Caméra ' + c.ip).replace(/^Caméra (\d)/, 'Caméra $1'), ip: c.ip, homekit: true, rtsp }); n++;
      } catch (e) { err = (c.name || c.ip) + ' : ' + e.message; }
    }
    if (n) { B.Disc.applyCams(); B.save(); B.emit('cams'); }
    P.camSt = n ? { ok: true, n } : { err: err || 'aucune caméra ajoutée' }; paint();
  }
  // à la fin : on ne garde affichées que les marques choisies (et celles déjà utilisées)
  function mask() {
    const off = Hub().off(), keep = new Set(Object.keys(P.pick).filter(id => P.pick[id]).concat(Object.values(S.settings.hubMap || {}).map(r => r.brand)));
    Hub().BRANDS.forEach(b => { if (keep.has(b.id)) delete off[b.id]; else off[b.id] = 1; });
    B.save(); B.emit('hub');
  }

  B.plugWizard = open;
  B.act('plugOpen', () => open());
  B.act('ppPick', el => { P.pick[el.dataset.arg] = el.checked; paint(); });
  B.act('ppAsk', el => { const id = el.dataset.arg; P.pick[id] = !P.pick[id]; if (P.pick[id]) prefill(id); paint(); });
  B.act('ppCamOn', el => { P.camOn = el.checked; });
  B.act('ppCam', el => { if (el.dataset.arg === 'u') P.camUser = el.value.trim(); else P.camPass = el.value; });
  B.act('ppIn', el => { const [id, k] = el.dataset.arg.split('|'); (P.form[id] = P.form[id] || {})[k] = el.value; });
  B.act('ppNext', () => { P.step = 'infos'; paint(); });
  B.act('ppBack', () => { P.step = 'brands'; paint(); });
  B.act('ppAct', async el => {
    const [id, a] = el.dataset.arg.split(':'), st = P.st[id] = P.st[id] || {}; el.disabled = true; st.info = 'Patientez… suivez l’indication de la marque (bouton à appuyer, code affiché…)'; paint();
    try {
      const body = fieldsBody(id); if (Object.keys(body).length) await Hub().call('/api/hub/' + id, body, 'PUT');
      const x = await Hub().call('/api/hub/' + id + '/action/' + a, fieldsBody(id, true)); st.info = x.info || 'C’est fait'; Object.assign(P.form[id] = P.form[id] || {}, x.cfg || {}); delete st.err;
    } catch (e) { st.err = e.message; st.info = ''; }
    paint();
  });
  B.act('ppGo', async () => {
    P.busy = true; paint();
    for (const id of Object.keys(P.pick).filter(x => P.pick[x] && !(P.st[x] && P.st[x].ok))) await connect(id);
    await addCams();
    P.busy = false; Hub().load(); paint();
    if (Object.keys(P.pick).filter(x => P.pick[x]).every(x => P.st[x] && P.st[x].ok) && (!P.camOn || !P.cams.length || (P.camSt && P.camSt.ok))) setTimeout(() => { mask(); P.step = 'done'; paint(); }, 600);
  });
  B.act('ppFinish', () => { mask(); P.step = 'done'; paint(); });
  B.act('ppClose', () => {
    if (P && P.step !== 'done' && !P.setup) { P = null; return B.closeModal(); }
    const setup = P && P.setup; P = null; B.closeModal();
    if (setup) { B.go('accueil'); setTimeout(() => location.reload(), 400); } else B.show();
  });
})();
