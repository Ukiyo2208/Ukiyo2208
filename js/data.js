/* Bêta OS — données par défaut (profils, appareils, médias, agenda, mails) */
(function () {
  const A = 'assets/';

  /* ---------- profils ---------- */
  const USERS = [
    { id: 'bastien', name: 'Bastien', avatar: A + 'avatars/bastien.png', ring: '#22cfff', bc: '#22e3a4', bat: 78, place: 'home', admin: true },
    { id: 'sarah', name: 'Sarah', avatar: A + 'avatars/sarah.png', ring: 'linear-gradient(135deg,#ff6fae,#ffa23d)', glow: '#ff7a8a', bc: '#ff5fae', bat: 62, place: 'work' },
    { id: 'leo', name: 'Léo', avatar: A + 'avatars/leo.png', ring: '#2a8dff', bc: '#22e3c0', bat: 91, place: 'school' },
    { id: 'emma', name: 'Emma', avatar: A + 'avatars/emma.png', ring: '#ff5fa8', bc: '#ffd23f', bat: 55, place: 'city' }
  ];
  const PLACES = {
    home: { label: 'À la maison', icon: 'homeFill', color: '#2fa8ff' },
    work: { label: 'Au travail', icon: 'user', color: '#ff7ac8' },
    school: { label: 'Lycée', icon: 'school', color: '#5fb8ff' },
    city: { label: 'En ville', icon: 'user', color: '#ff5f7e' },
    friends: { label: 'Amis', icon: 'family', color: '#2fa8ff' },
    away: { label: 'Absent', icon: 'pin', color: '#93a8cc' }
  };

  /* bibliothèque d'avatars (sélecteur de profil) */
  const n2 = i => String(i).padStart(2, '0');
  const RINGS_F = ['#ff6fae', '#2a8dff', '#ff8a3d', '#ff6fae', '#5aa8ff', '#ff5f7e', '#2a8dff', '#ff4fa8', '#2a8dff', '#ff8a3d', '#ff6fae', '#5aa8ff'];
  const RINGS_H = ['#2a8dff', '#2a8dff', '#ff8a3d', '#2a8dff', '#5aa8ff', '#ff5f7e', '#2a8dff', '#ff8a3d', '#2a8dff', '#ff5fa8', '#2a8dff', '#2a8dff'];
  const RINGS_E = ['#2a8dff', '#ff6fae', '#2a8dff', '#ff8a3d', '#2a8dff', '#ff6fae', '#2a8dff', '#ff6fae'];
  const AVATARS = [
    { group: 'Femmes', sym: '♀', items: Array.from({ length: 12 }, (_, i) => ({ src: A + 'avatars/avatar-' + n2(i + 1) + '.png', ring: RINGS_F[i] })) },
    { group: 'Hommes', sym: '♂', items: Array.from({ length: 12 }, (_, i) => ({ src: A + 'avatars/avatar-' + n2(i + 13) + '.png', ring: RINGS_H[i] })) },
    { group: 'Enfants', sym: '☺', items: Array.from({ length: 8 }, (_, i) => ({ src: A + 'avatars/avatar-' + n2(i + 25) + '.png', ring: RINGS_E[i] })) },
    { group: 'Bêta', sym: '⛩', items: [
      { src: A + 'avatars/bastien.png', ring: '#22cfff' }, { src: A + 'avatars/sarah.png', ring: '#ff8a3d' },
      { src: A + 'avatars/leo.png', ring: '#2a8dff' }, { src: A + 'avatars/emma.png', ring: '#ff5fa8' },
      { src: A + 'avatars/samourai.png', ring: '#2a8dff' }, { src: A + 'avatars/sarah-lune.png', ring: '#ff6fae' },
      { src: A + 'avatars/leo-nuit.png', ring: '#2a8dff' }, { src: A + 'avatars/emma-sakura.png', ring: '#ff5fa8' }
    ] }
  ];

  /* ---------- appareils (état par défaut) ----------
     type : light | cover | clim | power | app | vacuum | mower | sprinkler | charger | group */
  const D = {};
  const add = (id, type, name, room, def, ha) => { D[id] = { id, type, name, room, def, ha }; };
  // 1er étage
  add('e1.couloir.light', 'light', 'Éclairage RGB', 'Escalier & Couloir', { on: true, color: '#ffb35c', rgb: true }, 'light.couloir_etage_1');
  add('e1.couloir.clim', 'clim', 'Climatisation', 'Escalier & Couloir', { on: true, temp: 22 }, 'climate.couloir_etage_1');
  add('e1.couloir.cover', 'cover', 'Volets', 'Escalier & Couloir', { pos: 0 }, 'cover.couloir_etage_1');
  add('e1.ch1.light', 'light', 'Éclairage RGB', 'Chambre 1', { on: true, color: '#ffb35c', rgb: true }, 'light.chambre_1');
  add('e1.ch1.cover', 'cover', 'Volets', 'Chambre 1', { pos: 0 }, 'cover.chambre_1');
  add('e1.ch2.light', 'light', 'Éclairage RGB', 'Chambre 2', { on: true, color: '#ffb35c', rgb: true }, 'light.chambre_2');
  add('e1.ch2.cover', 'cover', 'Volets', 'Chambre 2', { pos: 0 }, 'cover.chambre_2');
  add('e1.suite.light', 'light', 'Éclairage', 'Suite parentale', { on: true }, 'light.suite_parentale');
  add('e1.suite.amb', 'light', 'Éclairage ambiance', 'Suite parentale', { on: true }, 'light.suite_ambiance');
  add('e1.suite.clim', 'clim', 'Climatisation', 'Suite parentale', { on: true, temp: 22 }, 'climate.suite_parentale');
  add('e1.suite.cover', 'cover', 'Volets', 'Suite parentale', { pos: 0 }, 'cover.suite_parentale');
  add('e1.sdb.light', 'light', 'Éclairage', 'Salle de bains', { on: true }, 'light.salle_de_bains');
  add('e1.wc.light', 'light', 'Éclairage', 'WC', { on: false }, 'light.wc_etage_1');
  // 2e étage : 2 volets, 2 éclairages RGB, 1 climatisation
  add('e2.ch.light', 'light', 'Éclairage RGB', 'Grenier 1', { on: true, color: '#ffb35c', rgb: true }, 'light.chambre_amis');
  add('e2.ch.cover', 'cover', 'Volets', 'Grenier 1', { pos: 0 }, 'cover.chambre_amis');
  add('e2.ch.clim', 'clim', 'Climatisation', 'Grenier 1', { on: false, temp: 21 }, 'climate.chambre_amis');
  add('e2.bureau.light', 'light', 'Éclairage RGB', 'Grenier 2', { on: true, color: '#7aa8ff', rgb: true }, 'light.bureau');
  add('e2.bureau.cover', 'cover', 'Volets', 'Grenier 2', { pos: 0 }, 'cover.bureau');
  // RDC
  add('rdc.garage.light', 'light', 'Éclairage', 'Garage', { on: true }, 'light.garage');
  add('rdc.garage.door', 'cover', 'Porte garage', 'Garage', { pos: 0 }, 'cover.porte_garage');
  add('rdc.buand.light', 'light', 'Éclairage', 'Buanderie', { on: true }, 'light.buanderie');
  add('rdc.buand.washer', 'app', 'Machine à laver', 'Buanderie', { on: false, prog: 'Coton 40°' }, 'switch.machine_a_laver');
  add('rdc.wc.light', 'light', 'Éclairage', 'WC', { on: false }, 'light.wc_rdc');
  add('rdc.entree.light', 'light', 'Éclairage', 'Entrée', { on: true }, 'light.entree');
  add('rdc.cuisine.applique', 'light', 'Applique', 'Cuisine', { on: true }, 'light.cuisine_applique');
  add('rdc.cuisine.centrale', 'light', 'Centrale', 'Cuisine', { on: true }, 'light.cuisine_centrale');
  add('rdc.cuisine.cover', 'cover', 'Volet', 'Cuisine', { pos: 0 }, 'cover.cuisine');
  add('rdc.cuisine.dish', 'app', 'Lave-vaisselle', 'Cuisine', { on: false, prog: 'Éco 50°' }, 'switch.lave_vaisselle');
  add('rdc.salon.light', 'light', 'Éclairage', 'Salon', { on: true }, 'light.salon');
  add('rdc.salon.tv', 'power', 'TV Salon', 'Salon', { on: true }, 'media_player.tv_salon');
  add('rdc.salon.amp', 'power', 'Marantz (Ampli)', 'Salon', { on: true }, 'media_player.marantz');
  add('rdc.salon.pc', 'power', 'Ordinateur', 'Salon', { on: true }, 'switch.ordinateur');
  add('rdc.salon.clim', 'clim', 'Climatisation', 'Salon', { on: true, temp: 22 }, 'climate.salon');
  add('rdc.salon.cover', 'cover', 'Volet', 'Salon', { pos: 0 }, 'cover.salon');
  add('rdc.sejour.light', 'light', 'Éclairage', 'Séjour', { on: true }, 'light.sejour');
  add('rdc.sejour.cover', 'cover', 'Volet', 'Séjour', { pos: 0 }, 'cover.sejour');
  add('rdc.robot', 'vacuum', 'Aspirateur robot', 'Aspirateur robot', { status: 'docked', bat: 78 }, 'vacuum.robot');
  // Extérieur
  add('ext.borne', 'charger', 'Borne de recharge', 'Cour', { on: false, kw: 0, car: false }, 'switch.borne_recharge');
  add('ext.parking', 'group', 'Éclairage parking', 'Cour', { on: true, n: 6, lit: 4 }, 'light.eclairage_parking');
  add('ext.cour', 'group', 'Éclairage cour', 'Cour', { on: true, n: 4, lit: 3 }, 'light.eclairage_cour');
  add('ext.arrosage', 'sprinkler', 'Arrosage automatique', 'Jardin', { on: false, min: 10 }, 'switch.arrosage');
  add('ext.tondeuse', 'mower', 'Tondeuse robot', 'Jardin', { status: 'docked', bat: 92 }, 'lawn_mower.tondeuse');
  add('ext.jardin', 'group', 'Éclairage jardin', 'Jardin', { on: true, n: 4, lit: 2 }, 'light.eclairage_jardin');
  add('ext.store', 'cover', 'Store banne', 'Terrasse', { pos: 100 }, 'cover.store_banne');
  add('ext.ambiance', 'group', 'Éclairage ambiance', 'Terrasse', { on: true, n: 6, lit: 3 }, 'light.terrasse_ambiance');
  add('ext.spots', 'group', 'Spots terrasse', 'Terrasse', { on: true, n: 4, lit: 2 }, 'light.spots_terrasse');
  // Maison
  add('home.chauffage', 'clim', 'Chauffage maison', 'Maison', { on: true, temp: 21.5, mode: 'Auto' }, 'climate.chauffage');
  add('home.ecs', 'power', 'Eau chaude', 'Maison', { on: true, temp: 52 }, 'water_heater.ballon');
  add('home.climg', 'power', 'Climatisation globale', 'Maison', { on: true }, 'climate.global');

  /* ---------- caméras ---------- */
  const CAMS = {
    'cam.cour-garage': { name: 'Cour - Vue garage', img: A + 'cams/cour-garage.jpg', ha: 'camera.cour_garage', det: ['person', 'car', 'animal', 'motion'] },
    'cam.cour': { name: 'Caméra cour', img: A + 'cams/cour.jpg', ha: 'camera.cour', det: ['person', 'car', 'animal'], ev: { type: 'motion', ago: 2 } },
    'cam.sonnette': { name: 'Sonnette', img: A + 'cams/sonnette.jpg', ha: 'camera.sonnette', det: ['person', 'car', 'animal'], ev: { type: 'person', ago: 0 }, bell: true },
    'cam.jardin': { name: 'Jardin', img: A + 'cams/jardin.jpg', ha: 'camera.jardin', det: ['person', 'car', 'animal', 'motion'] },
    'cam.rdc-garage': { name: 'Caméra garage', img: A + 'cams/rdc-garage.jpg', ha: 'camera.garage', det: ['person', 'animal', 'motion'] },
    'cam.rdc-entree': { name: 'Caméra entrée', img: A + 'cams/rdc-entree.jpg', ha: 'camera.entree', det: ['person', 'car', 'animal'] },
    'cam.rdc-salon': { name: 'Caméra salon', img: A + 'cams/rdc-salon.jpg', ha: 'camera.salon', det: ['person', 'car', 'animal'], bell: true },
    'cam.rdc-sejour': { name: 'Caméra séjour', img: A + 'cams/rdc-sejour.jpg', ha: 'camera.sejour', det: ['person', 'car', 'animal'] },
    'cam.ext-jardin': { name: 'Caméra jardin', img: A + 'devices/camera-jardin.jpg', ha: 'camera.jardin_2', det: ['person', 'animal'] }
  };

  /* ---------- médias ---------- */
  const PLAYLISTS = [
    { id: 'lofi', name: 'LoFi Japon', cover: A + 'media/playlist-1.jpg', thumb: A + 'media/lofi-japon.jpg', kind: 'yt', ref: 'jfKfPfyJRdk', artist: 'Lofi Girl · radio' },
    { id: 'citypop', name: 'City Pop', cover: A + 'media/playlist-2.jpg', kind: 'radio', ref: 'https://icecast.radiofrance.fr/fipgroove-midfi.mp3', artist: 'FIP Groove' },
    { id: 'gaming', name: 'Gaming', cover: A + 'media/playlist-3.jpg', kind: 'yt', ref: '4xDzrJKXOOY', artist: 'Synthwave radio' },
    { id: 'focus', name: 'Focus', cover: A + 'media/playlist-4.jpg', kind: 'radio', ref: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3', artist: 'France Musique' },
    { id: 'chill', name: 'Chill Mix', cover: A + 'media/now-playing.jpg', thumb: A + 'media/chill-mix.jpg', kind: 'yt', ref: 'rUxyKA_-grg', artist: 'Lofi Girl · sleep' }
  ];
  const RADIOS = [
    { id: 'r-inter', name: 'France Inter', ref: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3', site: 'radiofrance.fr', color: '#e2001a' },
    { id: 'r-info', name: 'franceinfo', ref: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3', site: 'francetvinfo.fr', color: '#ffd100' },
    { id: 'r-fip', name: 'FIP', ref: 'https://icecast.radiofrance.fr/fip-midfi.mp3', site: 'fip.fr', color: '#e2007a' },
    { id: 'r-musique', name: 'France Musique', ref: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3', site: 'radiofrance.fr', color: '#7b2dff' },
    { id: 'r-culture', name: 'France Culture', ref: 'https://icecast.radiofrance.fr/franceculture-midfi.mp3', site: 'radiofrance.fr', color: '#8b1cff' },
    { id: 'r-mouv', name: "Mouv'", ref: 'https://icecast.radiofrance.fr/mouv-midfi.mp3', site: 'mouv.fr', color: '#ff2d55' },
    { id: 'r-nrj', name: 'NRJ', ref: 'https://cdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3', site: 'nrj.fr', color: '#e30613' },
    { id: 'r-fg', name: 'Radio FG', ref: 'https://stream.rcs.revma.com/wknqhm4yuchvv', site: 'radiofg.com', color: '#1f9bff' }
  ];
  const PLEX = [
    { id: 'p1', title: 'Neon Nights', img: A + 'media/plex-1.jpg', kind: 'Film', year: 2024, dur: '1 h 58', genre: 'Thriller, néo-noir', progress: 42, summary: 'Une nuit de pluie à Shinjuku, un chauffeur de taxi se retrouve mêlé à une course-poursuite entre deux clans rivaux.' },
    { id: 'p2', title: 'Tokyo Drift Lights', img: A + 'media/plex-2.jpg', kind: 'Série', year: 2023, dur: 'S1 · É4', genre: 'Action', progress: 0, summary: 'Des pilotes de rue s’affrontent sur les autoroutes suspendues de Tokyo.' },
    { id: 'p3', title: 'Japan', img: A + 'media/plex-3.jpg', kind: 'Anime', year: 2025, dur: 'S2 · É7', genre: 'Aventure, fantastique', progress: 68, summary: 'Un voyage initiatique à travers un Japon onirique, des temples de Kyoto aux néons d’Osaka.' },
    { id: 'p4', title: 'Sakura Dreams', img: A + 'media/plex-4.jpg', kind: 'Film', year: 2022, dur: '2 h 04', genre: 'Romance', progress: 0, summary: 'Deux étudiants se retrouvent chaque printemps sous le même cerisier.' },
    { id: 'p5', title: 'Midnight City', img: A + 'media/plex-5.jpg', kind: 'Série', year: 2024, dur: 'S1 · É1', genre: 'Science-fiction', progress: 12, summary: 'Dans une ville qui ne dort jamais, une détective androïde enquête sur des rêves volés.' }
  ];
  const OUTPUTS = [
    { id: 'tv', name: 'TV Salon', icon: 'group' },
    { id: 'spk', name: 'Enceinte Salon', icon: 'speaker' },
    { id: 'grp', name: 'Groupe RDC', icon: 'group' },
    { id: 'suite', name: 'Suite parentale', icon: 'tv' }
  ];

  /* ---------- mails ---------- */
  const MAILS = [
    { id: 'm1', from: 'Ma Société', subj: 'Rapport modifié', time: '20:14', logo: 'M', bg: 'linear-gradient(135deg,#ff4b3e,#d4141f)', read: false, body: 'Bonjour Bastien,\n\nLe rapport trimestriel a été mis à jour avec les derniers chiffres. Merci de le relire avant la réunion d’équipe de demain 08:00.\n\nBonne soirée,\nL’équipe' },
    { id: 'm2', from: 'Amazon', subj: 'Votre commande', time: '12:11', logo: 'a', bg: 'linear-gradient(135deg,#7b7bff,#4f56d8)', read: false, body: 'Votre commande « Ampoules connectées RGB × 4 » a été expédiée.\nLivraison prévue demain avant 13:00.' },
    { id: 'm3', from: 'Banque', subj: 'Relevé mensuel', time: '11:32', logo: '€', bg: 'linear-gradient(135deg,#27a8ff,#1569d9)', read: false, body: 'Votre relevé de compte du mois est disponible dans votre espace client.' },
    { id: 'm4', from: 'École', subj: 'Réunion parents', time: '10:45', logo: '✎', bg: 'linear-gradient(135deg,#1fb6ff,#1478e0)', read: false, body: 'Madame, Monsieur,\n\nLa réunion parents-professeurs de Léo aura lieu jeudi à 18:00 en salle B12 (durée : 1 h 30).\n\nCordialement,\nLa vie scolaire', invite: { title: 'Réunion parents – Léo', when: 'jeudi', time: '18:00', dur: 90, place: 'Salle B12' } },
    { id: 'm5', from: 'Plex', subj: 'Nouveaux ajouts cette semaine', time: '09:02', logo: '›', bg: 'linear-gradient(135deg,#ffc53a,#f08a12)', read: false, body: '3 nouveaux films et 2 épisodes ont été ajoutés à votre bibliothèque.' }
  ];

  window.BETA_DATA = { USERS, PLACES, AVATARS, DEVICES: D, CAMS, PLAYLISTS, RADIOS, PLEX, OUTPUTS, MAILS };
})();
