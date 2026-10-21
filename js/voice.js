/* Bêta OS 6.6 — mode vocal : on parle à Bêta IA, elle répond à voix haute, puis réécoute
   (conversation continue). Reconnaissance : celle du navigateur (Safari/Chrome) ; voix : synthèse
   vocale de l'appareil, en français. */
(function () {
  const B = window.BOS, { S, esc } = B;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = window.speechSynthesis;
  const V = S.settings.voice = Object.assign({ read: true, readAll: false, cont: true, voice: '', rate: 1, pitch: 1 }, S.settings.voice || {});
  let rec = null, open = false, state = 'idle', wasPlaying = false, lastHeard = '', lastReply = '';

  /* ---------- voix ---------- */
  const PREF = /amélie|amelie|audrey|aurélie|aurelie|marie|thomas|denise|henri|eloise|vivienne|google français|french|fr-fr/i;
  function voices() { return (TTS ? TTS.getVoices() : []).filter(v => /^fr/i.test(v.lang)); }
  function pick() { const l = voices(); return l.find(v => v.name === V.voice) || l.find(v => /premium|enhanced|amélioré|natural|neural/i.test(v.name)) || l.find(v => PREF.test(v.name) && v.localService) || l.find(v => /fr-FR/i.test(v.lang)) || l[0] || null; }
  if (TTS) TTS.onvoiceschanged = () => { if (document.querySelector('.vset')) drawSet(); };
  function clean(t) {
    return String(t).replace(/\p{Extended_Pictographic}|️/gu, '').replace(/[«»“”"]/g, '')
      .replace(/(\d+(?:[.,]\d+)?)\s?°C?/g, '$1 degrés').replace(/km\/h/g, 'kilomètres heure').replace(/(\d)\s?kWh/g, '$1 kilowattheures').replace(/(\d)\s?kW/g, '$1 kilowatts')
      .replace(/(\d)\s?km\b/g, '$1 kilomètres').replace(/(\d)\s?min\b/g, '$1 minutes').replace(/(\d)\s?%/g, '$1 pour cent').replace(/\bRDC\b/g, 'rez-de-chaussée').replace(/\bIA\b/g, 'I A').replace(/\s+/g, ' ').trim();
  }
  function speak(text, done) {
    if (!TTS || !text) { if (done) done(); return; }
    TTS.cancel();
    const u = new SpeechSynthesisUtterance(clean(text)), v = pick();
    if (v) u.voice = v; u.lang = v ? v.lang : 'fr-FR'; u.rate = V.rate || 1; u.pitch = V.pitch || 1;
    u.onend = u.onerror = () => { if (done) done(); };
    TTS.speak(u);
    // iOS coupe parfois les longues phrases : on relance si la synthèse se bloque
    const k = setInterval(() => { if (!TTS.speaking) return clearInterval(k); if (!open && !V.readAll) { clearInterval(k); } TTS.pause(); TTS.resume(); }, 10000);
  }
  B.speak = speak;

  /* ---------- écoute ---------- */
  function setState(s, txt) {
    state = s;
    const m = document.querySelector('.vmode'); if (!m) return;
    m.dataset.s = s;
    const st = m.querySelector('.vst'); if (st) st.textContent = txt || { listen: 'Je vous écoute…', think: 'Je réfléchis…', speak: 'Je réponds…', idle: 'Touchez le micro pour parler' }[s];
    const b = m.querySelector('.vmic'); if (b) b.setAttribute('aria-label', s === 'listen' ? 'Arrêter l’écoute' : 'Parler');
  }
  const STOP = /^(merci|merci beaucoup|c.?est tout|stop|arr[eê]te|au revoir|bonne nuit b[eê]ta|termin[eé]|ok merci)[ .!]*$/i;
  function listen() {
    if (!SR) { setState('idle', 'Touchez 🎤 sur le clavier pour dicter, puis Envoyer'); const f = document.querySelector('.vmode .vtype'); if (f) { f.hidden = false; f.q.focus(); } return; }
    if (TTS) TTS.cancel();
    try { if (rec) rec.abort(); } catch (e) { }
    rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '', got = false;
    rec.onresult = e => {
      let interim = ''; final = '';
      for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; }
      const h = document.querySelector('.vmode .vheard'); if (h) h.textContent = (final || interim);
      got = true;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setState('idle', 'Micro refusé : autorisez-le (iPhone : Réglages › Safari › Micro, ou Sitecase)');
      else if (e.error === 'no-speech') setState('idle', 'Je n’ai rien entendu. Touchez le micro pour reparler.');
      else if (e.error !== 'aborted') setState('idle', 'Micro indisponible (' + e.error + ')');
      got = 'err';
    };
    rec.onend = () => {
      rec = null;
      if (got === 'err' || !open) return;
      const h = document.querySelector('.vmode .vheard'), text = (final || (h && h.textContent) || '').trim();
      if (!text) return setState('idle', 'Je n’ai rien entendu. Touchez le micro pour reparler.');
      handle(text);
    };
    setState('listen');
    const h = document.querySelector('.vmode .vheard'); if (h) h.textContent = '';
    try { rec.start(); } catch (e) { setState('idle', 'Micro indisponible'); }
  }
  function handle(text) {
    lastHeard = text;
    if (STOP.test(text)) { reply('Avec plaisir ! À tout à l’heure.', true); return; }
    setState('think');
    const r = B.askIA(text);
    reply(r);
  }
  function reply(r, end) {
    lastReply = r;
    const rp = document.querySelector('.vmode .vreply'); if (rp) rp.textContent = r;
    if (!V.read) { setState('idle'); if (end) setTimeout(close, 900); else if (V.cont) setTimeout(() => { if (open) listen(); }, 900); return; }
    setState('speak');
    speak(r, () => { if (!open) return; if (end) return close(); setState('idle'); if (V.cont) setTimeout(() => { if (open && state === 'idle') listen(); }, 350); });

  }

  /* ---------- fenêtre du mode vocal ---------- */
  function html() {
    return '<div class="vmode" data-s="idle"><div class="vtop"><b>' + (B.brainSVG ? '' : '') + 'Bêta IA</b><span class="tag2">mode vocal</span><span style="flex:1"></span><button class="sq" data-act="vSet" aria-label="Réglages de la voix">' + ico('gear') + '</button></div>' +
      '<div class="vorb" data-act="vMic" role="button" tabindex="0"><i></i><i></i><i></i><span class="vmic">' + ico('mic') + '</span></div>' +
      '<p class="vst">Touchez le micro pour parler</p><p class="vheard"></p><p class="vreply"></p>' +
      '<form class="vtype iainput" data-submit="vType"' + (SR ? ' hidden' : '') + '><input name="q" placeholder="Parlez avec la dictée du clavier…" autocomplete="off" enterkeyhint="send"><button class="btn pri" aria-label="Envoyer">' + ico('send') + '</button></form>' +
      '<div class="vbar"><label class="row"><button type="button" class="sw sm' + (V.cont ? ' on' : '') + '" data-act="vCont" aria-label="Conversation continue"></button>Conversation continue</label>' +
      '<label class="row"><button type="button" class="sw sm' + (V.read ? ' on' : '') + '" data-act="vRead" aria-label="Lire les réponses"></button>Réponses à voix haute</label></div>' +
      '<div class="vhint">Dites par exemple : « éteins le salon et ferme les volets », « quel temps fera-t-il demain ? », « préchauffe la voiture ». Dites « merci » pour terminer.</div><div class="vset" hidden></div></div>';
  }
  function start() {
    open = true;
    if (B.Music && B.Music.playing) { wasPlaying = true; B.Music.pause(); } else wasPlaying = false;
    const m = B.modal(html(), 'voice sm');
    // iOS : la synthèse vocale doit être « débloquée » pendant un toucher
    if (TTS) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch (e) { } }
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); stopAll(); } });
    obs.observe(document.body, { childList: true });
    setTimeout(listen, 250);
  }
  function stopAll() { open = false; try { if (rec) rec.abort(); } catch (e) { } rec = null; if (TTS) TTS.cancel(); if (wasPlaying && B.Music) { B.Music.resume && B.Music.resume(); wasPlaying = false; } }
  function close() { stopAll(); B.closeModal(); }
  B.voice = { start, close, speak, listen };
  B.act('voice', start);
  B.act('vMic', () => { if (state === 'listen') { try { rec && rec.stop(); } catch (e) { } } else if (state === 'speak') { if (TTS) TTS.cancel(); listen(); } else listen(); });
  B.act('vType', el => { const t = el.q.value.trim(); el.q.value = ''; if (t) { const h = document.querySelector('.vmode .vheard'); if (h) h.textContent = t; handle(t); } });
  B.act('vCont', el => { V.cont = !V.cont; B.save(); el.classList.toggle('on', V.cont); });
  B.act('vRead', el => { V.read = !V.read; B.save(); el.classList.toggle('on', V.read); if (!V.read && TTS) TTS.cancel(); });
  function drawSet() {
    const box = document.querySelector('.vmode .vset'); if (!box) return;
    const l = voices(), cur = pick();
    box.innerHTML = '<label class="field">Voix<select data-change="vVoice">' + (l.length ? l.map(v => '<option value="' + esc(v.name) + '"' + (cur && cur.name === v.name ? ' selected' : '') + '>' + esc(v.name) + (v.localService ? '' : ' (en ligne)') + '</option>').join('') : '<option>Voix française par défaut</option>') + '</select></label>' +
      '<label class="field">Vitesse · ' + String(V.rate).replace('.', ',') + '×<input type="range" class="range thin" min="0.7" max="1.4" step="0.05" value="' + V.rate + '" style="--p:' + ((V.rate - .7) / .7 * 100) + '%" data-change="vRate"></label>' +
      '<label class="row" style="gap:10px;font-size:13.5px"><button type="button" class="sw sm' + (V.readAll ? ' on' : '') + '" data-act="vReadAll" aria-label="Toujours lire"></button>Lire aussi les réponses écrites (barre IA, conversation)</label>' +
      '<div class="row" style="gap:8px"><button class="btn sm" data-act="vTest">' + ico('volume') + 'Essayer la voix</button></div>' +
      '<p class="muted" style="font-size:11.5px;margin:0;line-height:1.45">Astuce iPhone : Réglages › Accessibilité › Contenu énoncé › Voix › Français : téléchargez une voix « améliorée » ou « premium » (Amélie, Thomas…), beaucoup plus naturelle.</p>';
  }
  B.act('vSet', () => { const b = document.querySelector('.vmode .vset'); if (!b) return; b.hidden = !b.hidden; if (!b.hidden) drawSet(); });
  B.act('vVoice', el => { V.voice = el.value; B.save(); });
  B.act('vRate', el => { V.rate = +el.value; B.save(); drawSet(); });
  B.act('vReadAll', el => { V.readAll = !V.readAll; B.save(); el.classList.toggle('on', V.readAll); });
  B.act('vTest', () => speak('Bonjour ' + B.user().name + ', je suis Bêta, votre assistante. Il fait ' + B.WX.now.temp + ' degrés à ' + S.settings.city + '.'));

  /* ---------- le micro ouvre le mode vocal partout ---------- */
  B.act('mic', () => start());
  // appui long sur le bouton Bêta IA du dock (téléphone) : mode vocal direct
  let lp = null;
  document.addEventListener('pointerdown', e => { const f = e.target.closest('.iafab, .iatop'); if (!f) return; lp = setTimeout(() => { lp = 'done'; start(); }, 450); }, true);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => { if (lp && lp !== 'done') clearTimeout(lp); }, true));
  document.addEventListener('click', e => { if (lp === 'done' && e.target.closest('.iafab, .iatop')) { e.stopPropagation(); e.preventDefault(); lp = null; } }, true);
  // lecture des réponses écrites (option)
  const ask0 = B.askIA;
  B.askIA = t => { const r = ask0(t); if (V.readAll && !open && r) speak(r); return r; };
  // bouton « Mode vocal » sur la page Bêta IA
  const iaR = B.ROUTES.ia;
  if (iaR) { const r0 = iaR.render; iaR.render = () => r0().replace('<button class="btn sm" data-act="chatClear">', '<button class="btn sm pri" data-act="voice">' + ico('mic') + 'Mode vocal</button><button class="btn sm" data-act="chatClear">'); }
})();
