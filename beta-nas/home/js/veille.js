/* Bêta home 7.20 — « Veille des marques » : le tableau de bord pour corriger vite quand une marque change.
   État de chaque marque reliée (en marche, en panne, réponse différente), dernières versions publiées,
   tickets Home Assistant de la semaine, journal, rapport à copier et ticket GitHub. Données : server/veille.js */
(function () {
  const B = window.BOS, { esc, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const req = (p, b, m) => B.Server.req(p, b, m);
  const W = { d: null, open: null, busy: false };
  async function load() { if (!srv()) return; try { W.d = await req('/api/veille'); } catch (e) { W.d = null; W.err = e.message; } B.emit('veille'); }
  setInterval(() => { if (B.current === 'veille' && !document.hidden) load(); }, 30000);
  const ago = t => { if (!t) return '—'; const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 1 ? 'à l’instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j'; };
  const week = t => t && Date.now() - +new Date(t) < 7 * 864e5;
  const ICON = { down: 'alert', up: 'check', change: 'refresh', release: 'download', issue: 'chat', ticket: 'link', partial: 'alert', info: 'info' };
  const stat = b => b.down ? ['bad', 'En panne', b.err] : b.err ? ['warn', 'Erreurs depuis ' + ago(b.errSince).replace('il y a ', ''), b.err] : b.okAt ? ['ok', 'En marche', ago(b.okAt) + ' · ' + b.n + ' appareil' + (b.n > 1 ? 's' : '')] : ['idle', 'Pas encore relue', ''];

  RENDER.vlInfo = () => {
    const d = W.d || { brands: [], events: [] }, ev7 = t => d.events.filter(e => e.type === t && week(e.t)).length;
    return [{ icon: 'check', v: d.brands.filter(b => !b.err && b.okAt).length, l: 'En marche', cls: 'c' }, { icon: 'alert', v: d.brands.filter(b => b.down).length, l: 'En panne', cls: d.brands.some(b => b.down) ? 'p' : '' }, { icon: 'refresh', v: ev7('change'), l: 'Changements' }, { icon: 'download', v: ev7('release'), l: 'Versions' }];
  };
  RENDER.vlList = () => {
    if (!srv()) return '<p class="warn">Le serveur Bêta du NAS fait la veille : reliez-le d’abord (Connexions).</p>';
    const d = W.d; if (!d) return '<p class="muted">' + esc(W.err || 'Chargement…') + '</p>';
    if (!d.brands.length) return '<p class="muted">Aucune marque reliée pour l’instant (page Marques).</p>';
    const order = b => b.down ? 0 : b.err ? 1 : b.partial ? 2 : 3;
    return '<div class="vl scroll">' + d.brands.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(b => {
      const [cls, label, sub] = stat(b), u = b.up || {}, warnIss = (u.issues || []).filter(x => x.alarm), open = W.open === b.id;
      return '<div class="vlb ' + cls + (open ? ' open' : '') + '"><button class="vlh" data-act="vlOpen" data-arg="' + b.id + '"><i class="dot"></i><b>' + esc(b.name) + '</b><span class="st">' + label + '</span><small>' + esc(sub) + '</small>' +
        '<span class="chips">' + (u.tag ? '<span class="' + (week(u.date) ? 'new' : '') + '">' + ico('download') + esc(u.tag) + (week(u.date) ? ' · nouvelle' : '') + '</span>' : '') + (u.issues && u.issues.length ? '<span class="' + (warnIss.length ? 'warn' : '') + '">' + ico('chat') + u.issues.length + ' ticket' + (u.issues.length > 1 ? 's' : '') + ' HA</span>' : '') + (b.partial ? '<span class="warn">' + ico('alert') + 'appareils en erreur</span>' : '') + '</span>' + ico(open ? 'chevU' : 'chevD') + '</button>' +
        (open ? '<div class="vld">' +
          '<p><b>Connecteur :</b> <code>server/hub/' + esc(b.id) + '.js</code>' + (b.err ? '<br><b>Erreur :</b> ' + esc(b.err) : '') + '<br><b>Champs reçus :</b> ' + (b.sig.length ? b.sig.map(s => '<code>' + esc(s) + '</code>').join(' ') : '—') + '</p>' +
          (u.tag ? '<p><b>Dernière version :</b> <a href="' + esc(u.url || '#') + '" target="_blank" rel="noopener">' + esc(u.tag) + '</a> (' + ago(u.date) + ')' + (u.notes ? '</p><pre class="vlnotes">' + esc(u.notes) + '</pre>' : '</p>') : '') +
          (u.ha ? '<p><b>Intégration Home Assistant « ' + esc(u.ha) + ' » :</b> ' + (u.issues.length ? u.issues.length + ' ticket(s) ouverts cette semaine' : 'aucun ticket cette semaine') + '</p>' + (u.issues.length ? '<ul class="vliss">' + u.issues.map(x => '<li class="' + (x.alarm ? 'warn' : '') + '"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a> <small>' + ago(x.at) + '</small></li>').join('') + '</ul>' : '') : '') +
          (u.err ? '<p class="muted">Nouvelles : ' + esc(u.err) + '</p>' : '') +
          '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="vlReport" data-arg="' + b.id + '">' + ico('files') + 'Copier le rapport</button>' + (isAdmin() ? '<button class="btn sm" data-act="vlCheck" data-arg="' + b.id + '">' + ico('refresh') + 'Vérifier les nouvelles</button>' + (d.cfg.gh.repo ? '<button class="btn sm" data-act="vlTicket" data-arg="' + b.id + '">' + ico('link') + (b.issue ? 'Ticket #' + b.issue.n : 'Créer un ticket GitHub') + '</button>' : '') : '') + '<a class="btn sm" href="#marques">' + ico('plug') + 'Fiche de la marque</a></div></div>' : '') + '</div>';
    }).join('') + '</div>';
  };
  RENDER.vlLog = () => {
    const d = W.d; if (!d) return '<p class="muted">—</p>';
    return d.events.length ? '<div class="vlog scroll">' + d.events.slice(0, 40).map(e => '<div class="' + e.type + '">' + ico(ICON[e.type] || 'info') + '<span>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.text) + '</a>' : esc(e.text)) + '</span><small>' + ago(e.t) + '</small></div>').join('') + '</div>' : '<p class="muted">Rien à signaler pour l’instant : les pannes, changements et nouvelles versions apparaîtront ici.</p>';
  };
  RENDER.vlCfg = () => {
    const d = W.d; if (!d) return '';
    const c = d.cfg, sw = (k, l) => '<label class="row tbsw"><button type="button" class="sw sm' + (c[k] ? ' on' : '') + '" data-act="vlSet" data-arg="' + k + '"' + (isAdmin() ? '' : ' disabled') + '></button><span>' + l + '</span></label>';
    return '<div class="vlcfg">' + sw('on', 'Veille active') + sw('notifyDown', 'Prévenir quand une marque tombe en panne (et quand elle revient)') +
      '<label class="field">Délai avant de prévenir (minutes)<input type="number" min="2" max="240" value="' + c.delay + '" data-change="vlDelay"></label>' +
      sw('notifyChange', 'Prévenir si la réponse d’une marque change (appareils ou champs disparus)') + sw('upstream', 'Suivre les nouvelles des marques chaque jour (GitHub)') + sw('notifyRelease', 'Prévenir à chaque nouvelle version publiée') + sw('notifyIssues', 'Prévenir des signaux d’alerte pour les marques cloud (tickets Home Assistant)') +
      '<h4 class="rlh">' + ico('link') + 'Ticket GitHub <small>(facultatif)</small></h4><p class="muted" style="font-size:12.5px;margin:0 0 6px">Crée un ticket dans votre dépôt avec le rapport complet. Le jeton (github.com › Settings › Developer settings › Fine-grained tokens : « Issues : Read and write ») reste sur le NAS ; il évite aussi les limites de GitHub.</p>' +
      '<div class="grid2"><label class="field">Dépôt<input value="' + esc(c.gh.repo || '') + '" placeholder="ukiyo2208/ukiyo2208" data-change="vlGh" data-arg="repo"></label><label class="field">Jeton GitHub<input type="password" value="' + esc(c.gh.token || '') + '" placeholder="github_pat_…" data-change="vlGh" data-arg="token"></label></div>' +
      '<label class="row tbsw"><button type="button" class="sw sm' + (c.gh.auto ? ' on' : '') + '" data-act="vlGhAuto"></button><span>Créer le ticket tout seul en cas de panne ou de changement</span></label>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" data-act="vlCheck">' + ico('refresh') + 'Vérifier les nouvelles maintenant</button><button class="btn" data-act="nfOpen">' + ico('bellFill') + 'Notification « Marques »</button></div>' +
      '<p class="muted" style="font-size:12px">' + (d.upAt ? 'Nouvelles vérifiées ' + ago(d.upAt) + '.' : 'Nouvelles pas encore vérifiées (chaque nuit vers 4 h).') + '</p></div>';
  };
  B.route('veille', { title: 'Veille des marques', bg: 'assets/bg/generic.jpg', render: () => B.side('veille') + B.header({ id: 'veille', title: 'Veille', sub: 'Marques : pannes, changements, versions', icon: 'plug', info: { t: 'infobox', keys: ['veille'], items: () => RENDER.vlInfo() } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 960, 1012]) + '">' + B.whead('link', 'Marques reliées') + T({ t: 'vlList', keys: ['veille'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([975, 235, 1522, 560]) + '">' + B.whead('history', 'Journal') + T({ t: 'vlLog', keys: ['veille'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([975, 572, 1522, 1012]) + '">' + B.whead('gear', 'Réglages de la veille') + T({ t: 'vlCfg', keys: ['veille'] }) + '</section>', after: load });

  const put = async patch => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); try { W.d = await req('/api/veille', patch, 'PUT'); B.emit('veille'); } catch (e) { B.toast(e.message, 'info'); } };
  B.act('vlOpen', el => { W.open = W.open === el.dataset.arg ? null : el.dataset.arg; B.emit('veille'); });
  B.act('vlSet', el => put({ [el.dataset.arg]: !W.d.cfg[el.dataset.arg] }));
  B.act('vlDelay', el => put({ delay: +el.value }));
  B.act('vlGh', el => put({ gh: { [el.dataset.arg]: el.value } }));
  B.act('vlGhAuto', () => put({ gh: { auto: !W.d.cfg.gh.auto } }));
  B.act('vlCheck', async el => {
    if (W.busy) return; W.busy = true; B.toast('Vérification des nouvelles…', 'refresh');
    try { W.d = await req('/api/veille/check', { brand: el.dataset && el.dataset.arg || '' }); B.emit('veille'); B.toast('Nouvelles à jour', 'check'); } catch (e) { B.toast(e.message, 'info'); } finally { W.busy = false; }
  });
  B.act('vlReport', async el => {
    try { const r = await req('/api/veille/report?brand=' + encodeURIComponent(el.dataset.arg)); (navigator.clipboard ? navigator.clipboard.writeText(r.text) : Promise.reject()).then(() => B.toast('Rapport copié : collez-le dans votre demande de correctif', 'check'), () => { prompt('Copiez le rapport :', r.text); }); } catch (e) { B.toast(e.message, 'info'); }
  });
  B.act('vlTicket', async el => {
    const b = W.d.brands.find(x => x.id === el.dataset.arg); if (b && b.issue && b.issue.url) return window.open(b.issue.url, '_blank');
    try { const t = await req('/api/veille/ticket', { brand: el.dataset.arg }); B.toast('Ticket créé : #' + t.n, 'check'); load(); } catch (e) { B.toast(e.message, 'info'); }
  });
})();
