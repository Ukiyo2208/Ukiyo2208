/* Bêta home 6.7 — diffusion de la musique (« caster ») : sur ce téléphone, sur un appareil précis,
   sur tout un étage ou sur toute la maison, via les lecteurs Home Assistant (TV, enceintes, Music Assistant).
   Widget musique des étages = celui de l'accueil, limité aux appareils de l'étage. */
(function () {
  const B = window.BOS, { S, DATA, esc, RENDER, T } = B;
  const Music = B.Music, HA = B.HA;
  if (!S.music.cast) S.music.cast = 'local';
  const FN = { rdc: 'RDC', e1: 'Étage 1', e2: 'Étage 2', ext: 'Extérieur', home: 'Maison' };
  const ALL = { rdc: 'Tout le RDC', e1: 'Tout l’étage 1', e2: 'Tout l’étage 2', ext: 'Tout l’extérieur', home: 'Toute la maison' };
  const here = () => document.documentElement.classList.contains('fluid') ? 'Ce téléphone' : 'Cet appareil';

  /* ---------- où peut-on jouer ? ---------- */
  function targets(floor) {
    const out = [];
    Object.values(DATA.DEVICES).forEach(d => {
      const k = B.kindOf ? B.kindOf(d) : d.type;
      if (!(['tv', 'speaker'].includes(k) || d.type === 'media') || (B.isHidden && B.isHidden(d.id))) return;
      const e = HA.entity(d.id);
      out.push({ id: d.id, name: d.name, room: d.room, floor: B.floorOf ? B.floorOf(d.id) : d.id.split('.')[0], icon: k === 'speaker' ? 'speaker' : 'tv', eid: e && e.startsWith('media_player.') ? e : '' });
    });
    const mapped = new Set(out.map(t => t.eid));
    Object.keys(HA.states || {}).filter(e => e.startsWith('media_player.') && !mapped.has(e)).forEach(e => {
      const a = HA.states[e].attributes || {};
      out.push({ id: 'ha:' + e, name: a.friendly_name || e, room: '', floor: (S.music.castFloor || {})[e] || '', icon: 'speaker', eid: e });
    });
    if (!HA.enabled()) {
      if (!out.some(t => t.floor === 'e1')) out.push({ id: 'demo:e1tv', name: 'TV', room: 'Suite parentale', floor: 'e1', icon: 'tv' }, { id: 'demo:e1spk', name: 'Enceinte', room: 'Suite parentale', floor: 'e1', icon: 'speaker' });
      if (!out.some(t => t.floor === 'rdc' && t.icon === 'speaker')) out.push({ id: 'demo:rdcspk', name: 'Enceinte', room: 'Cuisine', floor: 'rdc', icon: 'speaker' });
    }
    return floor ? out.filter(t => t.floor === floor) : out;
  }
  function label(id) {
    if (!id || id === 'local') return here();
    if (id === 'all') return 'Toute la maison';
    if (id.startsWith('floor:')) return ALL[id.slice(6)] || 'Tout l’étage';
    const t = targets().find(x => x.id === id); return t ? t.name + (t.room ? ' · ' + t.room : '') : here();
  }
  const listOf = id => id === 'all' ? targets() : id.startsWith('floor:') ? targets(id.slice(6)) : id === 'local' ? [] : targets().filter(t => t.id === id);

  /* ---------- lancer la lecture sur la cible ---------- */
  function mediaUrl() {
    const it = Music.get(S.music.src) || {}, k = Music.kindOf ? Music.kindOf(it) : it.kind;
    if (k === 'yt') { const p = B.ytParse(it.ref) || {}; return p.list ? 'https://www.youtube.com/playlist?list=' + p.list : 'https://www.youtube.com/watch?v=' + p.v; }
    return it.ref || it.url || '';
  }
  async function playOn(eid) {
    const url = mediaUrl(); if (!url) return;
    try { await HA.req('/api/services/music_assistant/play_media', { entity_id: eid, media_id: url, enqueue: 'replace' }); }
    catch (e) { await HA.call('media_player', 'play_media', { entity_id: eid, media_content_id: url, media_content_type: 'music' }); }
  }
  async function castTo(id, quiet) {
    S.music.cast = id; B.save(); B.$$('.pop').forEach(p => p.remove());
    const list = listOf(id), name = label(id);
    if (!list.length) { B.emit('music'); if (!quiet) B.toast('La musique joue sur ' + name.toLowerCase(), 'speaker'); return; }
    // enceintes reliées directement par Marques (Sonos, Google Cast) : le serveur Bêta leur envoie le flux
    const hub = (S.settings.hubMap || {}), direct = list.filter(t => hub[t.id]), real = list.filter(t => t.eid && !hub[t.id]);
    const url = mediaUrl(), it = Music.get(S.music.src) || {}, radioOk = /^https?:\/\//.test(url) && !/youtube\.com|youtu\.be/.test(url);
    if (direct.length && radioOk) direct.forEach(t => B.HA.push(t.id, { play: url, title: it.name || 'Bêta home' }));
    if (HA.enabled() && real.length) for (const t of real) await playOn(t.eid);
    if ((direct.length && radioOk) || (HA.enabled() && real.length)) {
      if (Music.playing) Music.pause();   // le son ne sort plus du téléphone
      if (!quiet) B.toast('Diffusion sur ' + name, 'speaker');
    } else if (!quiet) B.toast(direct.length && !radioOk ? 'Les vidéos YouTube ne se diffusent pas sur ' + name + ' : choisissez une radio ou un fichier du NAS' : 'Diffusion sur ' + name + ' (démo — reliez l’enceinte dans Marques)', 'speaker');
    B.emit('music');
  }
  B.cast = { targets, label, castTo };
  // une nouvelle musique choisie part directement sur la cible en cours
  const play0 = Music.play.bind(Music);
  Music.play = function (id) { const r = play0(id); const hub = S.settings.hubMap || {}; if (S.music.cast && S.music.cast !== 'local' && listOf(S.music.cast).some(t => hub[t.id] || (HA.enabled() && t.eid))) setTimeout(() => castTo(S.music.cast, true), 50); return r; };

  /* ---------- choix de la cible ---------- */
  const chip = floor => '<button class="castbtn" data-act="castPick" data-floor="' + (floor || '') + '" title="Où écouter ?">' + ico(S.music.cast === 'local' ? 'monitor' : 'speaker') + '<span>' + esc(label(S.music.cast)) + '</span>' + ico('chevD') + '</button>';
  B.castChip = chip;
  B.act('castPick', el => {
    const fl = el.dataset.floor, opt = (id, icon, name, sub) => '<button class="li castopt' + (S.music.cast === id ? ' on' : '') + '" data-act="castSet" data-arg="' + esc(id) + '">' + ico(icon) + '<span><b>' + esc(name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + (S.music.cast === id ? ico('check') : '') + '</button>';
    let h = opt('local', 'monitor', here(), 'Le son sort de cet écran');
    if (fl) {
      const l = targets(fl);
      if (l.length > 1) h += opt('floor:' + fl, 'group', ALL[fl] || 'Tout l’étage', l.length + ' appareils');
      h += l.map(t => opt(t.id, t.icon, t.name, t.room)).join('') || '<p class="muted" style="margin:6px 4px;font-size:13px">Aucun appareil audio à cet étage.</p>';
    } else {
      const l = targets();
      if (l.length > 1) h += opt('all', 'homeFill', 'Toute la maison', l.length + ' appareils');
      Object.keys(FN).concat(['']).forEach(f => { const g = l.filter(t => t.floor === f); if (!g.length) return; h += '<h5>' + esc(FN[f] || 'Autres lecteurs') + '</h5>' + (g.length > 1 ? opt('floor:' + f, 'group', ALL[f] || 'Tout l’étage', g.length + ' appareils') : '') + g.map(t => opt(t.id, t.icon, t.name, t.room)).join(''); });
    }
    B.popover(el, '<b style="font-weight:500">Où écouter ?</b><div class="list castlist">' + h + '</div>' + (HA.enabled() ? '' : '<p class="muted" style="font-size:11.5px;margin:8px 2px 0;line-height:1.4">Démo : reliez Home Assistant (et Music Assistant pour YouTube) pour diffuser vraiment.</p>'));
  });
  B.act('castSet', el => castTo(el.dataset.arg));
  // l'ancien choix « zone » (page Musique) passe par le même menu
  B.zoneName = () => label(S.music.cast);
  B.act('zone', el => B.ACT.castPick(el));
  B.act('mOut', el => castTo(el.dataset.arg));

  /* ---------- accueil : la cible dans le widget Musique ---------- */
  const hm0 = RENDER.hmusic;
  RENDER.hmusic = s => hm0(s).replace('<div class="hmnow">', '<div class="hmnow">' + chip(''));

  /* ---------- étages : même widget que l'accueil, limité à l'étage ---------- */
  const RD = ['r-nrj', 'r-fg', 'r-info'];
  function favItems(n) {
    const f = Music.favs().map(id => Music.get(id)).filter(Boolean);
    const pool = RD.map(id => Music.get(id)).filter(Boolean).concat(S.playlists.map(p => Music.get(p.id)));
    return f.concat(pool.filter(x => !f.some(y => y.id === x.id)).map(x => Object.assign({ sug: true }, x))).slice(0, n);
  }
  B.favItems = favItems;
  const favBtn = x => { const k = Music.kindOf(x), on = S.music.src === x.id; return '<button class="fav' + (on ? ' on' : '') + (x.sug ? ' sug' : '') + '" data-act="mPlay" data-arg="' + x.id + '" title="' + esc(x.name) + '">' + (k === 'radio' ? B.radioLogo(x, 40, true) : '<img src="' + (x.cover || 'assets/media/playlist-1.jpg') + '" alt="">') + (on && Music.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : '') + '<span>' + esc(k === 'radio' ? x.name.replace(/^France (?=\w)/, '') : x.name) + '</span></button>'; };
  RENDER.fmusic = s => {
    const i = B.curInfo();
    return '<div class="card abs fmus" style="' + s.style + '"><a href="#musique" class="cv" aria-label="Page Musique">' + B.mcover(i, 80) + '</a>' +
      '<div class="nf">' + B.srcPill(i) + '<b class="ell">' + esc(i.title) + '</b><span class="ell">' + esc(i.artist) + '</span></div>' +
      B.transport() + '<div class="favs">' + favItems(4).map(favBtn).join('') + '</div><div class="fcast">' + chip(s.floor) + '<a href="#musique" class="wmore" aria-label="Page Musique">' + ico('chevR') + '</a></div></div>';
  };
})();
