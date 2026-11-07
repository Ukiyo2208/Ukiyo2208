/* Bêta home 7.13 — page Réseau : la box internet (Bbox, Freebox) et le Wi-Fi maillé TP-Link Deco.
   État de la ligne, débits, IP, bornes, appareils connectés (Wi-Fi / câble), redémarrage,
   et « Suivre » un téléphone pour savoir qui est à la maison. Passe par le serveur Bêta (les box ne parlent pas au navigateur). */
(function () {
  const B = window.BOS, { S, esc, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const BOXES = [['bbox', 'Bbox'], ['deco', 'TP-Link Deco'], ['freebox', 'Freebox']];
  const N = { info: {}, err: {}, at: 0, q: '', all: false };
  const hubList = () => (B.Hub && B.Hub.H && B.Hub.H.list) || {};
  const used = () => BOXES.filter(([id]) => { const h = hubList()[id]; return h && (h.status === 'ok' || Object.keys(h.cfg || {}).some(k => h.cfg[k] && !['presence'].includes(k))); });
  async function load() {
    if (!srv()) return;
    if (B.Hub && !B.Hub.H.loaded && B.Hub.load) { try { await B.Hub.load(); } catch (e) { } }
    await Promise.all(used().map(async ([id]) => { try { N.info[id] = await B.Server.req('/api/hub/' + id + '/info'); delete N.err[id]; } catch (e) { N.err[id] = e.message; } }));
    N.at = Date.now(); B.emit('reseau');
  }
  const up = s => { if (!s) return ''; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600); return d ? d + ' j ' + h + ' h' : h + ' h ' + Math.floor(s % 3600 / 60) + ' min'; };
  const mb = v => v == null ? '—' : (v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' Gb/s' : v + ' Mb/s');
  const allClients = () => used().flatMap(([id, name]) => ((N.info[id] || {}).clients || []).map(c => Object.assign({ src: id, srcName: name }, c)));
  RENDER.netBoxes = () => {
    if (!srv()) return '<p class="warn">Les box et le Wi-Fi se lisent par le serveur Bêta du NAS : reliez-le d’abord (Connexions).</p>';
    if (!used().length) return '<div class="secempty">' + ico('wifi') + '<b>Votre box et votre Wi-Fi</b><p class="muted">Reliez la Bbox (Bouygues Telecom), la Freebox ou les bornes TP-Link Deco dans Marques : débit, IP, appareils connectés, redémarrage et détection de présence.</p><div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn" data-act="hubOpen" data-arg="bbox">' + ico('wifi') + 'Bbox</button><button class="btn" data-act="hubOpen" data-arg="deco">' + ico('wifi') + 'TP-Link Deco</button><button class="btn" data-act="hubOpen" data-arg="freebox">' + ico('wifi') + 'Freebox</button></div></div>';
    return '<div class="netboxes scroll">' + used().map(([id, name]) => {
      const i = N.info[id], e = N.err[id];
      if (!i) return '<div class="netbox"><b>' + esc(name) + '</b><p class="' + (e ? 'warn' : 'muted') + '">' + esc(e || 'Lecture…') + '</p></div>';
      const b = i.box || {}, w = b.wan || {}, on = /connect/.test(w.state || '');
      return '<div class="netbox"><div class="nbh"><span class="nbdot ' + (on ? 'g' : 'p') + '"></span><div><b>' + esc(b.model || name) + '</b><small>' + esc([w.type, b.firmware ? 'version ' + b.firmware : '', b.uptime ? 'allumée depuis ' + up(b.uptime) : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        (isAdmin() && (i.actions || []).includes('reboot') ? '<button class="btn sm" data-act="netReboot" data-arg="' + id + '">' + ico('refresh') + 'Redémarrer</button>' : '') + '</div>' +
        '<div class="nbgrid"><div><small>Internet</small><b>' + esc(w.state || '—') + '</b></div><div><small>Adresse IP</small><b>' + esc(w.ip || '—') + '</b></div>' +
        (w.down != null || w.syncDown != null ? '<div><small>Débit ↓ / ↑ maintenant</small><b>' + mb(w.down) + ' / ' + mb(w.up) + '</b></div>' : '') + (w.maxDown || w.syncDown ? '<div><small>' + (w.syncDown ? 'Synchro ↓ / ↑' : 'Maximum ↓ / ↑') + '</small><b>' + mb(w.syncDown || w.maxDown) + ' / ' + mb(w.syncUp || w.maxUp) + '</b></div>' : '') +
        (b.wifi ? '<div><small>Wi-Fi</small><b>' + (b.wifi.on ? 'allumé' : 'coupé') + (b.wifi.ssid ? ' · ' + esc(b.wifi.ssid) : '') + '</b></div>' : '') + (b.cpu != null ? '<div><small>Processeur / mémoire</small><b>' + b.cpu + ' % / ' + b.mem + ' %</b></div>' : '') +
        '<div><small>Appareils connectés</small><b>' + (i.clients || []).filter(c => c.online).length + '</b></div></div>' +
        (i.nodes && i.nodes.length ? '<div class="nbnodes">' + i.nodes.map(n => '<span class="' + (n.online ? '' : 'off') + '">' + ico('wifi') + '<b>' + esc(n.name) + '</b><small>' + esc(n.role + (n.ip ? ' · ' + n.ip : '')) + '</small></span>').join('') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  };
  RENDER.netClients = () => {
    if (!srv() || !used().length) return '<p class="muted" style="font-size:13px">Aucune box reliée.</p>';
    const q = N.q.toLowerCase(), list = allClients().filter(c => (N.all || c.online) && (!q || (c.name + ' ' + c.ip + ' ' + c.mac).toLowerCase().includes(q))).sort((a, b) => (b.online - a.online) || String(a.name).localeCompare(String(b.name)));
    const watched = id => String(((hubList()[id] || {}).cfg || {}).presence || '').toLowerCase().split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    return '<div class="netcl"><div class="row" style="gap:8px;flex-wrap:wrap"><input class="search" placeholder="Chercher un appareil, une IP…" value="' + esc(N.q) + '" data-input="netQ" style="flex:1 1 180px"><label class="rlck"><input type="checkbox" data-change="netAll"' + (N.all ? ' checked' : '') + '>hors ligne aussi</label></div>' +
      '<div class="list scroll">' + (list.map(c => { const w = watched(c.src).includes(String(c.name).toLowerCase()) || watched(c.src).includes(c.mac); return '<div class="li netc' + (c.online ? '' : ' off') + '"><span class="ic">' + ico(c.link === 'wifi' ? 'wifi' : 'link') + '</span><div><b>' + esc(c.name || c.mac) + '</b><small>' + esc([c.ip, c.link === 'wifi' ? 'Wi-Fi ' + (c.band || '') : 'câble', c.guest ? 'invités' : '', used().length > 1 ? c.srcName : '', c.down ? '↓ ' + c.down + ' Ko/s' : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        (isAdmin() ? (w ? '<small class="tag2">suivi</small>' : '<button class="btn sm" data-act="netFollow" data-arg="' + c.src + '|' + esc(c.name || c.mac) + '" title="Savoir quand ce téléphone est à la maison">' + ico('pin') + 'Suivre</button>') : '') + '</div>'; }).join('') || '<p class="muted" style="font-size:13px">Aucun appareil.</p>') + '</div></div>';
  };
  B.route('reseau', { title: 'Réseau', bg: 'assets/bg/generic.jpg', render: () => B.side('reseau') + B.header({ id: 'reseau', title: 'Réseau', sub: 'Box internet, Wi-Fi et appareils connectés', icon: 'wifi', info: { t: 'infobox', keys: ['reseau'], items: () => {
    const cl = allClients(), i = used().map(([id]) => N.info[id]).filter(Boolean), w = (i[0] && i[0].box && i[0].box.wan) || {};
    return [{ icon: 'wifi', v: cl.filter(c => c.online && c.link === 'wifi').length, l: 'En Wi-Fi', cls: 'c' }, { icon: 'link', v: cl.filter(c => c.online && c.link !== 'wifi').length, l: 'Par câble' }, { icon: 'download', v: w.down != null ? mb(w.down) : '—', l: 'Débit ↓', cls: 'y' }, { icon: 'server', v: /connect/.test(w.state || '') ? 'OK' : '—', l: 'Internet', cls: /connect/.test(w.state || '') ? 'g' : '' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 800, 1012]) + '">' + B.whead('link', 'Box et bornes', '<button class="wmore" data-act="netReload" aria-label="Actualiser">' + ico('refresh') + '</button>') + T({ t: 'netBoxes', keys: ['reseau'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([810, 235, 1522, 1012]) + '">' + B.whead('family', 'Appareils connectés') + T({ t: 'netClients', keys: ['reseau'] }) + '</section>', after: () => load() });
  setInterval(() => { if (B.current === 'reseau' && !document.hidden) load(); }, 30000);
  B.act('netReload', load);
  B.act('netQ', el => { N.q = el.value; clearTimeout(N.t); N.t = setTimeout(() => { B.emit('reseau'); const i = document.querySelector('[data-input="netQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); });
  B.act('netAll', el => { N.all = el.checked; B.emit('reseau'); });
  B.act('netReboot', async el => { const id = el.dataset.arg; if (!confirm('Redémarrer ' + (BOXES.find(b => b[0] === id) || [])[1] + ' ? Internet sera coupé quelques minutes.')) return; try { await B.Server.post('/api/hub/' + id + '/action/reboot', {}); B.toast('Redémarrage demandé', 'refresh'); } catch (e) { B.toast(e.message, 'info'); } });
  B.act('netFollow', async el => {
    const [id, name] = el.dataset.arg.split('|'), h = hubList()[id], cur = String((h && h.cfg && h.cfg.presence) || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    try { const v = await B.Server.req('/api/hub/' + id, { presence: cur.concat([name]).join(', ') }, 'PUT'); if (h) h.cfg = v.cfg; B.emit('reseau'); B.toast('« ' + name + ' » suivi : ajoutez son détecteur dans Marques › ' + (BOXES.find(b => b[0] === id) || [])[1] + ' › Ajouter les appareils, puis Sécurité › Présence', 'pin'); }
    catch (e) { B.toast(e.message, 'info'); }
  });
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); if (!out.some(n => n[0] === 'reseau')) { const i = out.findIndex(n => n[0] === 'sante'); out.splice(i < 0 ? out.length : i + 1, 0, ['reseau', 'Réseau', 'wifi', 'wifi', 'noside']); } return out; };
})();
