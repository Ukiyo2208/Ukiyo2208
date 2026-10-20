/* Bêta OS — ambiances (jour / nuit), saisons, particules et sons discrets */
(function () {
  const B = window.BOS, { S, WX } = B;
  const SEASONS = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
  if (!S.settings.season) S.settings.season = 'auto';
  if (!S.settings.ambiance) S.settings.ambiance = 'auto';
  if (!S.settings.fx) S.settings.fx = 'lock';
  if (S.settings.sound === undefined) S.settings.sound = true;

  function season() {
    if (S.settings.season !== 'auto') return S.settings.season;
    const m = new Date().getMonth() + 1;
    return m >= 3 && m <= 5 ? 'printemps' : m >= 6 && m <= 8 ? 'ete' : m >= 9 && m <= 11 ? 'automne' : 'hiver';
  }
  function ambiance() {
    if (S.settings.ambiance !== 'auto') return S.settings.ambiance;
    if (WX.sun) { const n = Date.now(); return n > +WX.sun.rise && n < +WX.sun.set ? 'jour' : 'nuit'; }
    return B.isNight() ? 'nuit' : 'jour';
  }
  /* ---------- particules : pétales, lucioles, feuilles, flocons ---------- */
  const SHAPES = {
    printemps: () => ico('sakura'),
    ete: () => '<b class="fly"></b>',
    automne: () => ico('maple'),
    hiver: () => ico('flake')
  };
  let lastKey = '';
  function particles(force) {
    const se = season(), where = B.current === 'verrou' ? 'lock' : 'page', mode = S.settings.fx;
    const n = mode === 'off' ? 0 : where === 'lock' ? 20 : mode === 'all' ? 9 : 0;
    const key = se + n;
    if (key === lastKey && !force) return;
    lastKey = key;
    let layer = document.querySelector('.fx');
    if (!layer) { layer = document.createElement('div'); layer.className = 'fx'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
    layer.className = 'fx fx-' + se;
    let h = '';
    for (let i = 0; i < n; i++) {
      const dur = se === 'ete' ? 6 + Math.random() * 6 : se === 'hiver' ? 9 + Math.random() * 9 : 10 + Math.random() * 9;
      h += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;' + (se === 'ete' ? 'top:' + (30 + Math.random() * 65).toFixed(0) + '%;' : '') + 'animation-delay:-' + (Math.random() * dur).toFixed(1) + 's;animation-duration:' + dur.toFixed(1) + 's;--s:' + (.45 + Math.random() * .75).toFixed(2) + ';--d:' + (Math.random() * 180 - 90).toFixed(0) + 'px">' + SHAPES[se]() + '</i>';
    }
    layer.innerHTML = h;
  }
  function apply() {
    const se = season(), am = ambiance(), cl = document.documentElement.classList;
    Object.keys(SEASONS).forEach(k => cl.toggle('s-' + k, k === se));
    cl.toggle('a-jour', am === 'jour'); cl.toggle('a-nuit', am !== 'jour');
    particles();
  }
  setInterval(apply, 60000);
  window.addEventListener('hashchange', () => setTimeout(apply, 30));
  B.on && B.on('weather', apply);

  /* ---------- sons (synthétisés, aucun fichier) ---------- */
  let ctx = null;
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, d, type, vol, when, glide) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + (when || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || .05, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + .02);
  }
  const SOUNDS = {
    tap: () => tone(1250, .045, 'sine', .028),
    on: () => { tone(660, .07, 'sine', .04); tone(990, .09, 'sine', .035, .05); },
    off: () => { tone(880, .07, 'sine', .035); tone(560, .1, 'sine', .03, .05); },
    chime: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .35, 'sine', .04, i * .07)),
    unlock: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, .5, 'triangle', .035, i * .06)); tone(2093, .6, 'sine', .015, .3); },
    notify: () => { tone(880, .25, 'sine', .045); tone(1320, .35, 'sine', .035, .12); },
    dingdong: () => { tone(988, .9, 'triangle', .07); tone(784, 1.2, 'triangle', .07, .55); },
    error: () => tone(220, .2, 'square', .02, 0, 160)
  };
  function sound(k) { if (!S.settings.sound) return; try { (SOUNDS[k] || SOUNDS.tap)(); } catch (e) { } if (navigator.vibrate && k !== 'tap') navigator.vibrate(k === 'dingdong' ? [60, 80, 60] : 10); }
  // un léger « tic » sur chaque bouton, un son plus marqué pour les interrupteurs
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || !S.settings.sound) return;
    const a = el.dataset.act;
    if (a === 'toggle') { const d = B.dev(el.dataset.id); setTimeout(() => sound(B.dev(el.dataset.id).on ? 'on' : 'off'), 0); void d; }
    else if (a !== 'unlock' && a !== 'lockUser' && a !== 'unlockTo') { sound('tap'); if (navigator.vibrate) navigator.vibrate(6); }
  }, true);
  const n0 = B.notify;
  B.notify = o => { sound('notify'); return n0(o); };

  B.fx = { season, ambiance, apply, particles, sound, SEASONS };
  apply();
})();
