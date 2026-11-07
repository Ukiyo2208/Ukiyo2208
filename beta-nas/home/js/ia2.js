/* Bêta home 7.1 — Bêta IA s'adapte à la maison : elle lit la liste réelle des étages, pièces et
   appareils (ceux de la démo comme ceux créés ou importés de Home Assistant) à chaque question.
   « allume la lampe de chevet », « éteins la prise du bureau », « ferme les volets du grenier »,
   « mets la clim de la chambre à 22 », « la télé du salon est allumée ? », « état de la cuisine ». */
(function () {
  const B = window.BOS, { S, DATA, dev, setDev } = B;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = d => !(B.isHidden && B.isHidden(d.id));
  const kind = d => B.kindOf ? B.kindOf(d) : d.type;
  const STOP = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'd', 'l', 'a', 'au', 'aux', 'et', 'dans', 'sur', 'un', 'une', 'mon', 'ma', 'mes', 'en', 'pour', 'tout', 'toute', 'toutes', 'tous', 'moi', 'stp', 'svp', 'plait', 'peux', 'tu', 'vous', 'est', 'ce', 'que', 'qui']);
  const words = s => norm(s).split(' ').filter(w => w.length > 1 && !STOP.has(w));

  /* ---------- catégories d'appareils ---------- */
  const CAT = [
    [/lumiere|lampe|eclairage|lustre|spot|ampoule|led|plafonnier|applique|veilleuse/, d => d.type === 'light' || d.type === 'group'],
    [/volet|store|rideau/, d => d.type === 'cover' && kind(d) !== 'garage'],
    [/porte (du |de )?garage|garage/, d => kind(d) === 'garage'],
    [/clim|climatisation|chauffage|radiateur|thermostat|pompe a chaleur/, d => d.type === 'clim'],
    [/tele|television|tv\b/, d => kind(d) === 'tv'],
    [/enceinte|haut parleur|sonos|homepod|ampli/, d => kind(d) === 'speaker' || /ampli|marantz/i.test(d.name)],
    [/prise/, d => kind(d) === 'plug' || (d.type === 'power' && /prise/i.test(d.name))],
    [/ventilateur|ventilo/, d => d.type === 'fan'],
    [/arrosage|vanne/, d => d.type === 'valve' || d.type === 'sprinkler'],
    [/ordinateur|ordi|pc\b/, d => kind(d) === 'computer' || /ordi|pc\b/i.test(d.name)],
    [/aspirateur|robot/, d => d.type === 'vacuum'],
    [/tondeuse/, d => d.type === 'mower'],
    [/serrure|verrou/, d => d.type === 'lock'],
    [/machine|lave linge|lave vaisselle|seche linge/, d => d.type === 'app'],
    [/chauffe eau|ballon/, d => d.type === 'heater']
  ];
  /* ---------- lieux : pièces et étages réels ---------- */
  function places() {
    const rooms = [], floors = (B.floors ? B.floors() : []).map(f => ({ id: f.id, n: norm(f.name) }));
    (B.floors ? B.floors() : []).forEach(f => (B.roomsList ? B.roomsList(f.id) : []).forEach(r => rooms.push({ floor: f.id, name: r.name, n: norm(r.label || r.name), n2: norm(r.name) })));
    rooms.sort((a, b) => b.n.length - a.n.length);
    return { rooms, floors };
  }
  function scope(q) {
    const P = places();
    const r = P.rooms.filter(x => q.includes(x.n) || q.includes(x.n2));
    if (r.length) return { rooms: r, label: r.map(x => x.name).join(', ') };
    const f = P.floors.find(x => q.includes(x.n)) || P.floors.find(x => /rdc|rez/.test(q) && x.id === 'rdc') || P.floors.find(x => /premier etage|1er/.test(q) && x.id === 'e1') || P.floors.find(x => /exterieur|dehors|jardin/.test(q) && (x.id === 'ext' || /exter/.test(x.n)));
    if (f) return { floor: f.id, label: (B.floor(f.id) || {}).name || '' };
    return null;
  }
  const inScope = (d, sc) => !sc ? true : sc.rooms ? sc.rooms.some(r => r.name === d.room && (B.floorOf ? B.floorOf(d.id) === r.floor : true)) : (B.floorOf ? B.floorOf(d.id) : d.id.split('.')[0]) === sc.floor;

  /* ---------- trouver les appareils visés ---------- */
  function targets(q, sc) {
    const all = Object.values(DATA.DEVICES).filter(visible);
    // 1) un appareil précis cité par son nom (« lampe de chevet », « TV Salon »)
    const qw = new Set(words(q)), roomW = new Set(sc && sc.rooms ? sc.rooms.flatMap(r => words(r.name)) : []);
    const scored = all.map(d => { const w = words(d.name).filter(x => !roomW.has(x)); const hit = w.filter(x => qw.has(x) || qw.has(x.replace(/s$/, ''))).length; return { d, s: w.length ? hit / w.length : 0, hit }; }).filter(x => x.hit && x.s >= .5 && inScope(x.d, sc));
    const cat = CAT.find(c => c[0].test(q));
    let list = scored.length ? scored.filter(x => x.s === Math.max(...scored.map(y => y.s))).map(x => x.d) : [];
    if (cat && list.length) list = list.filter(cat[1]).length ? list.filter(cat[1]) : list;
    // 2) sinon une catégorie (« les lumières », « la clim ») dans le lieu demandé
    if (!list.length && cat) list = all.filter(d => cat[1](d) && inScope(d, sc));
    // 3) « éteins la cuisine » / « éteins tout » : lumières du lieu
    if (!list.length && (sc || /\btout\b|toute la maison|partout/.test(q))) list = all.filter(d => (d.type === 'light' || d.type === 'group') && inScope(d, sc) && (sc || !(B.floorOf && B.floorOf(d.id) === 'ext')));
    return list;
  }

  /* ---------- action demandée ---------- */
  function action(q) {
    let m;
    if ((m = q.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:°|degres?)/)) || (/clim|chauffage|radiateur|thermostat|temperature/.test(q) && (m = q.match(/\ba\s+(\d{2}(?:[.,]\d)?)\b/)))) return { k: 'temp', v: parseFloat(m[1].replace(',', '.')) };
    if ((m = q.match(/(\d{1,3})\s*(?:%|pour ?cent)/)) && /lumi|lampe|eclair|luminosite|tamise/.test(q)) return { k: 'bri', v: Math.min(100, +m[1]) };
    if ((m = q.match(/(\d{1,3})\s*(?:%|pour ?cent)/)) && /volet|store|ouvr/.test(q)) return { k: 'pos', v: Math.min(100, +m[1]) };
    if (/deverrouill/.test(q)) return { k: 'unlock' };
    if (/verrouill/.test(q)) return { k: 'lock' };
    if (/\b(ouvre|ouvrir|leve|monte|remonte)\b/.test(q)) return { k: 'open' };
    if (/\b(ferme|fermer|baisse|descend|descends|abaisse)\b/.test(q)) return { k: 'close' };
    if (/\b(eteins|eteint|eteindre|coupe|couper|arrete|arreter|stop|desactive)\b/.test(q)) return { k: 'off' };
    if (/\b(allume|allumer|active|activer|demarre|demarrer|lance|lancer|mets en marche|mets|met)\b/.test(q)) return { k: 'on' };
    if (/est (il |elle )?(allume|eteint|ouvert|ferme)|c est allume|etat|statut|ca donne quoi/.test(q)) return { k: 'ask' };
    return null;
  }
  function apply(d, a) {
    if (B.canUse && !B.canUse(d.id)) return 'locked';
    const p = {};
    if (a.k === 'on' || a.k === 'off') {
      if (d.type === 'cover') p.pos = a.k === 'on' ? 100 : 0;
      else if (d.type === 'vacuum') p.status = a.k === 'on' ? 'cleaning' : 'returning';
      else if (d.type === 'mower') p.status = a.k === 'on' ? 'mowing' : 'docked';
      else if (d.type === 'lock') p.locked = a.k === 'off';
      else if ('on' in dev(d.id) || ['light', 'group', 'power', 'app', 'clim', 'fan', 'media', 'valve', 'heater', 'sprinkler', 'charger'].includes(d.type)) p.on = a.k === 'on';
      else return 'skip';
    }
    if (a.k === 'open' || a.k === 'close') { if (d.type === 'cover') p.pos = a.k === 'open' ? 100 : 0; else if (d.type === 'lock') p.locked = a.k === 'close'; else if (d.type === 'valve') p.on = a.k === 'open'; else return 'skip'; }
    if (a.k === 'pos') { if (d.type !== 'cover') return 'skip'; p.pos = a.v; }
    if (a.k === 'temp') { if (d.type !== 'clim' && d.type !== 'heater') return 'skip'; p.on = true; p.temp = a.v; }
    if (a.k === 'bri') { if (d.type !== 'light') return 'skip'; p.on = a.v > 0; p.bri = a.v; }
    if (a.k === 'lock' || a.k === 'unlock') { if (d.type !== 'lock') return 'skip'; p.locked = a.k === 'lock'; }
    setDev(d.id, p); return 'ok';
  }
  const VERB = { on: 'allumé', off: 'éteint', open: 'ouvert', close: 'fermé', pos: 'réglé', temp: 'réglé', bri: 'réglé', lock: 'verrouillé', unlock: 'déverrouillé' };
  const join = l => l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
  const stateOf = d => { const st = dev(d.id); if (d.type === 'cover') return st.pos > 0 ? (st.pos >= 100 ? 'ouvert' : 'ouvert à ' + st.pos + ' %') : 'fermé'; if (d.type === 'clim') return st.on ? 'allumée, ' + String(st.temp).replace('.', ',') + ' °C' : 'arrêtée'; if (d.type === 'lock') return st.locked ? 'verrouillée' : 'déverrouillée'; if (d.type === 'sensor') return String(st.val).replace('.', ',') + ' ' + (st.unit || ''); return B.stateText ? B.stateText(d, st).toLowerCase() : (st.on ? 'allumé' : 'éteint'); };
  const nm = (d, sc) => d.name + (sc && sc.rooms && sc.rooms.length === 1 ? '' : ' (' + d.room + ')');

  function devCmd(text) {
    const q = norm(text), a = action(q);
    if (!a) return null;
    // les phrases déjà gérées ailleurs (routines, musique, météo…) ne passent pas ici
    if (/playlist|radio|musique|chanson|meteo|agenda|mail|routine|scene|mode (soir|jour|nuit|absent)|je pars|je rentre|bonne nuit|voiture|qui |quand /.test(q) && !CAT.some(c => c[0].test(q))) return null;
    const sc = scope(q); let list = targets(q, sc);
    if (!list.length && a.k === 'temp') list = Object.values(DATA.DEVICES).filter(d => visible(d) && d.type === 'clim' && inScope(d, sc) && !/globale|maison/i.test(d.name + d.room) && (sc || dev(d.id).on));
    if (!list.length) return sc || CAT.some(c => c[0].test(q)) ? 'Je ne trouve pas cet appareil' + (sc ? ' (' + sc.label + ')' : '') + '. Vérifiez son nom dans la pièce, ou ajoutez-le (Pièces › Modifier).' : null;
    if (a.k === 'ask') return list.slice(0, 6).map(d => nm(d, sc) + ' : ' + stateOf(d)).join(' · ') + '.';
    const done = [], locked = [];
    list.forEach(d => { const r = apply(d, a); if (r === 'ok') done.push(d); else if (r === 'locked') locked.push(d); });
    if (!done.length) return locked.length ? 'Vous n’avez pas le droit de piloter ' + join(locked.map(d => '« ' + d.name + ' »')) + '.' : 'Ces appareils ne peuvent pas faire ça.';
    const what = done.length > 4 ? done.length + ' appareils' : join(done.map(d => nm(d, sc)));
    const how = a.k === 'temp' ? ' à ' + String(a.v).replace('.', ',') + ' °C' : a.k === 'bri' ? ' à ' + a.v + ' %' : a.k === 'pos' ? ' à ' + a.v + ' %' : '';
    const plur = done.length === 1 && /s$/i.test(done[0].name.split(' ')[0]);
    const fem = done.length === 1 && /^(lampe|lumiere|prise|tele|television|enceinte|clim|climatisation|porte|serrure|machine|ventilation|tondeuse|vanne)/.test(norm(done[0].name));
    return (done.length > 1 ? 'C’est fait : ' + what + ' ' + VERB[a.k] + 's' : 'C’est fait : ' + what + ' ' + VERB[a.k] + (fem ? 'e' : '') + (plur ? 's' : '')) + how + (sc && sc.label && done.length > 1 ? ' (' + sc.label + ')' : '') + '.' + (locked.length ? ' (' + locked.length + ' non autorisé' + (locked.length > 1 ? 's' : '') + ')' : '');
  }
  B.iaDevices = devCmd;
  // l'ancien moteur reste en secours (routines, météo, musique, agenda…)
  const ia0 = B.ia;
  B.ia = text => devCmd(text) || ia0(text);

  /* ---------- « état de la cuisine », « bilan de l'étage » ---------- */
  const ia1 = B.ia;
  B.ia = text => {
    const q = norm(text);
    if (/^(etat|bilan|resume|point)\b/.test(q) || /qu est ce qui est allume|quoi d allume/.test(q)) {
      const sc = scope(q), all = Object.values(DATA.DEVICES).filter(d => visible(d) && inScope(d, sc));
      if (/allume/.test(q)) { const on = all.filter(d => dev(d.id).on); return on.length ? 'Allumé' + (sc ? ' (' + sc.label + ')' : '') + ' : ' + join(on.slice(0, 8).map(d => nm(d, sc))) + (on.length > 8 ? ' … et ' + (on.length - 8) + ' autres' : '') + '.' : 'Tout est éteint' + (sc ? ' (' + sc.label + ')' : '') + '.'; }
      if (sc) return sc.label + ' : ' + all.slice(0, 8).map(d => d.name + ' ' + stateOf(d)).join(', ') + '.';
    }
    return ia1(text);
  };

  /* ---------- suggestions construites avec vos appareils ---------- */
  B.iaSugg = () => {
    const all = Object.values(DATA.DEVICES).filter(visible), pick = f => all.find(f), out = ['Fais le point sur la maison'];
    const l = pick(d => d.type === 'light' && !/^(éclairage|lumière)/i.test(d.name)) || pick(d => d.type === 'light'), c = pick(d => d.type === 'cover' && kind(d) === 'cover'), k = pick(d => d.type === 'clim' && !/maison|globale/i.test(d.room + d.name)), t = pick(d => kind(d) === 'tv'), p = pick(d => kind(d) === 'plug');
    const art = n => /^(lampe|lumière|prise|télé|tv|enceinte|clim)/i.test(n) ? 'la ' : /^[aeéèiouyh]/i.test(n) ? 'l’' : 'le ';
    if (l) out.push(/^(éclairage|lumière)/i.test(l.name) ? 'Allume la lumière : ' + l.room : 'Allume ' + art(l.name) + l.name.toLowerCase());
    if (c) out.push('Ferme les volets : ' + c.room);
    if (k) out.push('Mets la clim à 21 degrés : ' + k.room);
    if (t) out.push('Éteins ' + art(t.name) + t.name);
    if (p) out.push('Allume ' + art(p.name) + p.name.toLowerCase());
    const f = (B.floors ? B.floors() : []).find(x => x.level >= 0); if (f) out.push('Éteins tout : ' + f.name);
    out.push('Qu’est-ce qui est allumé ?', 'Quel temps fait-il ?', 'Mets la radio NRJ', 'Qui a ouvert le garage hier ?', 'Je pars', 'Bonne nuit');
    return out;
  };
})();
