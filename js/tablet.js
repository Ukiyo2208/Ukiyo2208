/* Bêta home 7.11 — tablettes murales et petits écrans :
   - écran de veille (heure, météo, prochain évènement, photos) après quelques minutes sans toucher
   - luminosité réduite la nuit, réveil quand quelqu'un passe devant (détection de mouvement de Fully Kiosk)
   - disposition par écran : automatique, grand écran, tablette (2 colonnes, idéale en 8 pouces), téléphone
   - mode performance (sans flous ni animations) pour les tablettes modestes
   Réglages : Paramètres › Cet écran (chaque tablette garde les siens). */
(function () {
  const B = window.BOS, { S, DATA, esc, F, WX } = B;
  const DK = 'betaos.device';
  const cfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } };
  const setCfg = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  const tab = () => Object.assign({ on: false, idle: 3, photos: true, night: true, from: '22:00', to: '07:00', bri: 20, day: 80, motion: true, say: true }, cfg().tablet || {});
  const FULLY = () => typeof window.fully !== 'undefined' ? window.fully : null;

  /* ---------- disposition 2 colonnes : les grands blocs prennent toute la largeur ---------- */
  function spans() {
    if (!document.documentElement.classList.contains('tab2')) return;
    document.querySelectorAll('.page > section.abs, .page > .abs.card').forEach(el => { const w = parseFloat((el.getAttribute('style') || '').match(/width:\s*([\d.]+)px/) ? RegExp.$1 : 0); el.classList.toggle('span2', w >= 900); });
  }
  window.addEventListener('hashchange', () => setTimeout(spans, 60));
  window.addEventListener('resize', () => setTimeout(spans, 120));
  setTimeout(spans, 400);

  /* ---------- écran de veille ---------- */
  let last = Date.now(), sv = null, slide = 0, svT = null;
  const PH = () => {
    const rooms = ['rdc-salon', 'rdc-cuisine', 'rdc-sejour', 'e1-suite', 'ext-jardin', 'ext-terrasse', 'e1-chambre1'].map(n => 'assets/rooms/' + n + '.jpg');
    const own = (S.custom && S.custom.rooms || []).map(r => r.img).filter(Boolean);
    return own.concat(rooms);
  };
  function nextEv() { const now = Date.now(); const e = (S.events || []).map(x => Object.assign({ at: +new Date(x.date + 'T' + (x.time || '00:00')) }, x)).filter(x => x.at >= now - 36e5).sort((a, b) => a.at - b.at)[0]; return e ? (e.date === F.ymd(new Date()) ? 'Aujourd’hui' : new Date(e.at).toLocaleDateString('fr-FR', { weekday: 'long' })) + (e.time ? ' · ' + e.time : '') + ' — ' + e.title : ''; }
  function paintSv() {
    if (!sv) return;
    const now = new Date(), w = WX && WX.now ? WX.now : null, t = tab();
    sv.querySelector('.svt').textContent = F.time(now);
    sv.querySelector('.svd').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    sv.querySelector('.svw').innerHTML = w ? (B.wxIcon ? B.wxIcon(w.code, !w.day) : '') + '<b>' + Math.round(w.temp) + '°</b><span>' + esc(S.settings.city || '') + '</span>' : '';
    sv.querySelector('.sve').textContent = nextEv();
    const al = (B.wxAlerts ? B.wxAlerts() : [])[0]; sv.querySelector('.sva').textContent = al ? al.text : '';
    if (t.photos) { const p = PH(); slide = (slide + 1) % p.length; const img = sv.querySelector('.svbg'); img.style.opacity = 0; setTimeout(() => { img.style.backgroundImage = 'url("' + p[slide] + '")'; img.style.opacity = 1; }, 700); }
  }
  function sleep() {
    if (sv || !tab().on || document.querySelector('.modal')) return;
    sv = document.createElement('div'); sv.className = 'saver' + (tab().photos ? '' : ' nophoto');
    sv.innerHTML = '<div class="svbg"></div><div class="svbox"><div class="svt"></div><div class="svd"></div><div class="svw"></div><div class="sve"></div><div class="sva"></div></div><small class="svh">Touchez l’écran</small>';
    document.body.appendChild(sv); paintSv(); svT = setInterval(paintSv, 20000);
    const f = FULLY(); if (f && night()) try { f.setScreenBrightness(Math.round(tab().bri * 2.55 * 0.6)); } catch (e) { }
  }
  function wake() {
    last = Date.now();
    if (!sv) return; clearInterval(svT); sv.classList.add('out'); const s = sv; sv = null; setTimeout(() => s.remove(), 400);
    const f = FULLY(); if (f) try { f.turnScreenOn(); bright(); } catch (e) { }
  }
  B.tabletWake = wake;
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, () => { if (sv) { wake(); } else last = Date.now(); }, { capture: true, passive: true }));
  setInterval(() => { const t = tab(); if (t.on && !sv && Date.now() - last > t.idle * 6e4) sleep(); }, 10000);

  /* ---------- nuit : luminosité réduite (Fully Kiosk) ou voile sombre (autres navigateurs) ---------- */
  const night = () => { const t = tab(); if (!t.night) return false; const n = F.time(new Date()); return t.from <= t.to ? n >= t.from && n < t.to : n >= t.from || n < t.to; };
  function bright() {
    const t = tab(), n = t.on && night(), f = FULLY();
    if (f) { try { f.setScreenBrightness(Math.round((n ? t.bri : t.day) * 2.55)); } catch (e) { } }
    else document.documentElement.style.setProperty('--nightveil', n ? String(Math.max(0, 0.75 - t.bri / 100)) : '0');
    document.documentElement.classList.toggle('tnight', !f && n);
  }
  setInterval(bright, 60000); setTimeout(bright, 1500);
  // Fully Kiosk : la caméra frontale réveille l'écran quand quelqu'un passe (option « Motion Detection » de Fully)
  if (FULLY()) { try { window.fully.bind('onMotion', 'BOS.tabletWake && BOS.tabletWake()'); window.fully.bind('screenOn', 'BOS.tabletWake && BOS.tabletWake()'); } catch (e) { } }

  /* ---------- annonces du serveur lues à voix haute (si la tablette n'est pas sous Fully, qui parle déjà) ---------- */
  B.tabletSay = text => {
    if (!tab().say || FULLY() || !window.speechSynthesis) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; speechSynthesis.speak(u); } catch (e) { }
    wake();
  };

  /* ---------- application installable (écran d'accueil de l'iPhone, Android, tablettes) ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

  /* ---------- réglages dans « Cet écran » ---------- */
  B.screenExtra = c => {
    const t = tab(), L = c.layout || 'auto', opt = (v, l) => '<option value="' + v + '"' + (L === v ? ' selected' : '') + '>' + l + '</option>';
    const sw = (k, l, on) => '<label class="row tbsw"><button type="button" class="sw sm' + (on ? ' on' : '') + '" data-act="tbSet" data-arg="' + k + '"></button><span>' + l + '</span></label>';
    return '<label class="field">Langue / Language<select data-change="tbLang"><option value="fr"' + (window.BETA_LANG !== 'en' ? ' selected' : '') + '>Français</option><option value="en"' + (window.BETA_LANG === 'en' ? ' selected' : '') + '>English</option></select></label>' +
      '<label class="field">Disposition<select data-change="tbLayout">' + opt('auto', 'Automatique') + opt('large', 'Grand écran (tableau complet)') + opt('tablet', 'Tablette 8″ (2 colonnes, gros boutons)') + opt('phone', 'Téléphone (1 colonne)') + '</select></label>' +
      sw('perf', 'Mode performance (sans flous ni animations : tablettes modestes)', !!c.perf) +
      '<div class="tbbox"><b>' + ico('monitor') + 'Tablette murale</b>' + sw('on', 'Écran de veille et luminosité automatique', t.on) +
      (t.on ? '<div class="grid2"><label class="field">Veille après (min)<input type="number" min="1" max="60" value="' + t.idle + '" data-change="tbNum" data-arg="idle"></label><label class="field">Luminosité le jour (%)<input type="number" min="5" max="100" value="' + t.day + '" data-change="tbNum" data-arg="day"></label>' +
        '<label class="field">Nuit de<input type="time" value="' + t.from + '" data-change="tbTxt" data-arg="from"></label><label class="field">à<input type="time" value="' + t.to + '" data-change="tbTxt" data-arg="to"></label><label class="field">Luminosité la nuit (%)<input type="number" min="0" max="100" value="' + t.bri + '" data-change="tbNum" data-arg="bri"></label></div>' +
        sw('photos', 'Photos des pièces en fond d’écran de veille', t.photos) + sw('night', 'Baisser la luminosité la nuit', t.night) + sw('motion', 'Se réveiller quand quelqu’un passe (Fully Kiosk : activez « Motion Detection »)', t.motion) + sw('say', 'Lire à voix haute les annonces de la maison', t.say) +
        '<button type="button" class="btn sm" data-act="tbTest">' + ico('moon') + 'Voir l’écran de veille</button>' : '') + '</div>';
  };
  const redraw = () => { if (B.screenCfg && document.querySelector('.scmodal')) B.screenCfg(); };
  B.act('tbLang', el => window.betaSetLang && window.betaSetLang(el.value));
  B.act('tbLayout', el => { const c = cfg(); c.layout = el.value; setCfg(c); window.dispatchEvent(new Event('resize')); B.show(); setTimeout(spans, 200); B.toast('Disposition : ' + el.selectedOptions[0].textContent, 'monitor'); });
  B.act('tbSet', el => { const c = cfg(), k = el.dataset.arg; if (k === 'perf') { c.perf = !c.perf; setCfg(c); window.dispatchEvent(new Event('resize')); } else { c.tablet = Object.assign(tab(), { [k]: !tab()[k] }); setCfg(c); bright(); } redraw(); });
  B.act('tbNum', el => { const c = cfg(); c.tablet = Object.assign(tab(), { [el.dataset.arg]: Math.max(0, +el.value || 0) }); setCfg(c); bright(); });
  B.act('tbTxt', el => { const c = cfg(); c.tablet = Object.assign(tab(), { [el.dataset.arg]: el.value }); setCfg(c); bright(); });
  B.act('tbTest', () => { B.closeModal(); setTimeout(() => { const c = cfg(); const was = tab().on; if (!was) { c.tablet = Object.assign(tab(), { on: true }); setCfg(c); } sleep(); }, 200); });
})();
