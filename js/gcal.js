/* Bêta home — Google Agenda : synchronisation dans les deux sens avec le compte Google
   déjà utilisé pour YouTube. L'import / export .ics reste disponible à côté. */
(function () {
  const B = window.BOS, { S, F, esc, RENDER } = B;
  const Y = B.YTM, API = 'https://www.googleapis.com/calendar/v3/calendars/';
  const COL = { 1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e', 7: '#039be5', 8: '#9e9e9e', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000' };
  const TZ = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || 'Europe/Paris';
  if (!S.gcal) S.gcal = { write: true, cal: 'primary', last: 0, err: '' };
  const G = S.gcal;
  const gIco = '<span class="gmark" aria-hidden="true">G</span>';

  const ok = () => Y && Y.connected();
  /* le jeton couvre-t-il l'agenda ? (jetons d'avant la v6.1 : YouTube seulement) */
  const scoped = () => !Y.scope || /calendar/.test(Y.scope);
  async function req(path, opt) {
    if (!ok()) throw new Error('non connecté');
    const r = await fetch(API + encodeURIComponent(G.cal || 'primary') + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + Y.token }, opt && opt.body ? { 'Content-Type': 'application/json' } : {}) }));
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { Y.token = null; localStorage.removeItem('betaos.yt'); throw new Error('session Google expirée'); }
    if (!r.ok) {
      const m = (j.error && j.error.message) || 'HTTP ' + r.status;
      if (/insufficient/i.test(m)) { Y.scope = 'youtube'; throw new Error('autorisation de l’agenda manquante'); }
      if (/has not been used|is disabled/i.test(m)) throw new Error('activez « Google Calendar API » dans Google Cloud');
      throw new Error(m);
    }
    return j;
  }
  const pad = n => String(n).padStart(2, '0');
  const local = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
  function fromG(g) {
    const s = g.start || {}, e = g.end || {}, allDay = !s.dateTime;
    const a = new Date(s.dateTime || s.date + 'T00:00'), z = new Date(e.dateTime || (e.date ? e.date + 'T00:00' : +a + 36e5));
    return { id: 'g' + g.id, gid: g.id, src: 'google', date: F.ymd(a), time: allDay ? '00:00' : F.time(a), dur: allDay ? 24 * 60 : Math.max(5, Math.round((z - a) / 6e4)), allDay, title: g.summary || '(sans titre)', place: g.location || '', color: COL[g.colorId] || '#4285f4', uid: g.iCalUID };
  }
  function toG(e) {
    const a = new Date(e.date + 'T' + (e.time || '00:00')), z = new Date(+a + (e.dur || 60) * 6e4);
    return { summary: e.title, location: e.place || undefined, start: { dateTime: local(a), timeZone: TZ }, end: { dateTime: local(z), timeZone: TZ } };
  }

  const gcal = {
    busy: false,
    async sync(loud) {
      if (!ok() || this.busy) return;
      this.busy = true; B.emit('cal');
      try {
        const from = new Date(Date.now() - 30 * 864e5), to = new Date(Date.now() + 180 * 864e5);
        let items = [], page = '';
        do {
          const j = await req('/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + from.toISOString() + '&timeMax=' + to.toISOString() + (page ? '&pageToken=' + page : ''));
          items = items.concat((j.items || []).filter(g => g.status !== 'cancelled')); page = j.nextPageToken || '';
        } while (page && items.length < 1500);
        const list = items.map(fromG), gids = new Set(list.map(e => e.gid));
        // on garde les événements locaux, on remplace la copie Google ; un .ics déjà présent sur Google n'est pas doublé
        S.events = S.events.filter(e => e.src !== 'google' && !(e.uid && list.some(g => g.uid === e.uid)) && !(e.gid && gids.has(e.gid))).concat(list);
        G.last = Date.now(); G.err = ''; G.n = list.length; B.save();
        if (loud) B.toast(list.length + ' événement' + (list.length > 1 ? 's' : '') + ' Google synchronisé' + (list.length > 1 ? 's' : ''), 'calendar');
      } catch (e) { G.err = e.message; if (loud !== false) B.toast('Google Agenda : ' + e.message, 'info'); }
      finally { this.busy = false; B.emit('cal'); B.emit('events'); }
    },
    async push(e) {
      if (!ok() || !G.write || !scoped()) return;
      try {
        const g = e.gid ? await req('/events/' + encodeURIComponent(e.gid), { method: 'PATCH', body: JSON.stringify(toG(e)) }) : await req('/events', { method: 'POST', body: JSON.stringify(toG(e)) });
        e.gid = g.id; e.src = 'google'; e.uid = g.iCalUID; B.save(); B.emit('cal');
      } catch (er) { B.toast('Pas envoyé à Google Agenda : ' + er.message, 'info'); }
    },
    async remove(e) {
      if (!ok() || !e.gid) return;
      try { await req('/events/' + encodeURIComponent(e.gid), { method: 'DELETE' }); } catch (er) { B.toast('Suppression Google impossible : ' + er.message, 'info'); }
    }
  };
  B.gcal = gcal;

  /* ---------- les actions de l'agenda envoient aussi vers Google ---------- */
  const add0 = B.ACT.calAdd;
  B.ACT.calAdd = (el, ev) => {
    const before = new Set(S.events.map(e => e.id)), id = el.id && el.id.value;
    const r = add0(el, ev);
    const e = id ? S.events.find(x => x.id === id) : S.events.find(x => !before.has(x.id));
    if (e) gcal.push(e);
    return r;
  };
  const del0 = B.ACT.calDel;
  B.ACT.calDel = (el, ev) => { const e = S.events.find(x => x.id === el.dataset.arg); if (e && e.gid) gcal.remove(e); return del0(el, ev); };
  // invitation acceptée depuis un mail : elle part aussi dans Google Agenda
  ['mailInvite'].forEach(n => {
    const f = B.ACT[n]; if (!f) return;
    B.ACT[n] = (el, ev) => { const before = new Set(S.events.map(e => e.id)); const r = f(el, ev); S.events.filter(x => !before.has(x.id)).forEach(e => gcal.push(e)); return r; };
  });

  /* ---------- barre de l'agenda : bouton Google ---------- */
  const grid0 = RENDER.calgrid;
  RENDER.calgrid = s => {
    const html = grid0(s);
    const btn = !ok() ? '<button class="btn gbtn" data-act="gcalConnect" title="Relier Google Agenda">' + gIco + 'Google Agenda</button>'
      : !scoped() ? '<button class="btn gbtn warn" data-act="gcalConnect" title="Autoriser l’agenda">' + gIco + 'Autoriser l’agenda</button>'
      : '<button class="btn gbtn on' + (gcal.busy ? ' busy' : '') + '" data-act="gcalMenu" title="' + esc(G.err ? 'Erreur : ' + G.err : G.last ? 'Synchronisé à ' + F.time(new Date(G.last)) : 'Synchroniser') + '">' + gIco + (gcal.busy ? 'Synchro…' : G.err ? 'Erreur' : 'Synchronisé') + '</button>';
    return html.replace('<span style="flex:1"></span>', '<span style="flex:1"></span>' + btn);
  };
  const day0 = RENDER.calday;
  RENDER.calday = s => day0(s).split('<div class="li"').map((c, i) => { if (!i) return c; const m = c.match(/data-act="calEdit" data-arg="([^"]+)"/), e = m && S.events.find(x => x.id === m[1]); return e && e.src === 'google' ? c.replace('<b>', '<b>' + gIco) : c; }).join('<div class="li"');
  B.act('gcalConnect', () => B.modal('<h2>' + ico('calendar') + 'Relier Google Agenda</h2><p style="font-size:14px;line-height:1.55;margin:0 0 10px">Bêta home utilise le même compte Google que YouTube. Vos événements Google apparaissent dans l’agenda et ceux que vous ajoutez ici partent dans Google Agenda.</p>' +
    '<ol class="steps"><li>Google Cloud › « API et services » › Bibliothèque › activez <b>Google Calendar API</b>.</li><li>« Écran de consentement OAuth » › Accès aux données : ajoutez le champ d’application <code>…/auth/calendar.events</code> (facultatif en mode test).</li><li>Revenez ici et touchez « Se connecter » : Google vous demandera d’autoriser l’agenda.</li></ol>' +
    '<p class="muted" style="font-size:12.5px;margin:10px 0 14px">Les fichiers .ics restent utilisables : « Ajouter un fichier .ics » importe un agenda sans compte.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="closeModal">Plus tard</button><button class="btn pri" data-act="gcalGo">' + gIco + 'Se connecter</button></div>', 'sm'));
  B.act('gcalGo', () => { B.closeModal(); Y.token = null; B.ACT.ytConnect ? B.ACT.ytConnect() : Y.connect(); });
  B.act('gcalMenu', () => B.modal('<h2>' + ico('calendar') + 'Google Agenda</h2><div style="display:flex;flex-direction:column;gap:12px;font-size:14px">' +
    '<p style="margin:0" class="' + (G.err ? 'warn' : 'muted') + '">' + (G.err ? 'Dernière erreur : ' + esc(G.err) : G.last ? (G.n || 0) + ' événements · synchronisé à ' + F.time(new Date(G.last)) : 'Pas encore synchronisé') + '</p>' +
    '<label class="row" style="gap:10px"><button type="button" class="sw sm' + (G.write ? ' on' : '') + '" data-act="gcalWrite" aria-label="Écrire dans Google"></button>Ajouter aussi mes nouveaux événements dans Google Agenda</label>' +
    '<label class="field">Agenda Google utilisé<input value="' + esc(G.cal || 'primary') + '" data-change="gcalCal" placeholder="primary" spellcheck="false"></label>' +
    '<p class="muted" style="font-size:12px;margin:0">« primary » = votre agenda principal. Pour un agenda familial partagé, collez son identifiant (Paramètres de l’agenda › Intégrer l’agenda).</p>' +
    '<div class="row" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn" data-act="gcalOff">' + ico('x') + 'Retirer les événements Google</button><button class="btn pri" data-act="gcalSync">' + ico('refresh') + 'Synchroniser</button></div></div>', 'sm'));
  B.act('gcalSync', () => { B.closeModal(); gcal.sync(true); });
  B.act('gcalWrite', el => { G.write = !G.write; B.save(); el.classList.toggle('on', G.write); });
  B.act('gcalCal', el => { G.cal = el.value.trim() || 'primary'; B.save(); });
  B.act('gcalOff', () => { S.events = S.events.filter(e => e.src !== 'google'); G.last = 0; B.save(); B.closeModal(); B.emit('cal'); B.emit('events'); B.toast('Événements Google retirés de l’écran (rien n’est supprimé chez Google)', 'calendar'); });

  /* synchronisation automatique : à l'ouverture de l'agenda puis toutes les 15 min */
  const r = B.ROUTES.calendrier;
  if (r) { const a0 = r.after; r.after = () => { if (a0) a0(); if (ok() && scoped() && Date.now() - G.last > 5 * 6e4) gcal.sync(false); }; }
  setInterval(() => { if (ok() && scoped() && G.last) gcal.sync(false); }, 15 * 6e4);
  setTimeout(() => { if (ok() && scoped() && Date.now() - G.last > 30 * 6e4) gcal.sync(false); }, 4000);
})();
