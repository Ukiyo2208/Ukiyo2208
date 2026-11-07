// Music Assistant (serveur seul, sans Home Assistant) — API WebSocket locale (port 8095).
// Tous les lecteurs que Music Assistant connaît (Sonos, Cast, AirPlay, Squeezebox, DLNA…) deviennent des enceintes Bêta.
'use strict';
const { connect, rpc } = require('./ws');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return /^wss?:\/\//.test(h) ? h : 'ws://' + (/:\d+$/.test(h.replace(/^https?:\/\//, '')) ? h.replace(/^https?:\/\//, '') : h.replace(/^https?:\/\//, '') + ':8095'); };
async function session(c) {
  const ws = await connect(base(c) + '/ws'), call = rpc(ws, 'message_id');
  // le message d'accueil du serveur (sans identifiant) est simplement ignoré par rpc()
  const cmd = async (command, args) => { const r = await call({ command, args: args || {} }); if (r.error_code || r.details) throw new Error(r.details || 'erreur ' + r.error_code); return r.result; };
  if (c.token) await cmd('auth', { token: c.token });
  return { ws, cmd };
}
async function withMA(c, fn) { const s = await session(c); try { return await fn(s.cmd); } finally { s.ws.close(); } }
const CMD = { media_play_pause: 'play_pause', media_play: 'play', media_pause: 'pause', media_next_track: 'next', media_previous_track: 'previous', media_stop: 'stop' };
module.exports = {
  id: 'musicassistant', name: 'Music Assistant', poll: 5000, secrets: ['token'],
  async test(c) { if (!c.host) throw new Error('adresse du serveur Music Assistant manquante'); const n = await module.exports.devices(c); return n.length + ' lecteur(s) trouvé(s)'; },
  async devices(c) {
    if (!c.host) return [];
    const list = await withMA(c, cmd => cmd('players/all'));
    return list.filter(p => p.available !== false && p.enabled !== false && !p.hidden).map(p => {
      const m = p.current_media || {};
      return { id: p.player_id, name: p.display_name || p.name, kind: 'speaker', info: (p.device_info && p.device_info.model) || p.provider || 'Music Assistant',
        state: { on: p.powered !== false, vol: Math.round(p.volume_level || 0), playing: p.state === 'playing', title: m.title || '', artist: m.artist || '', art: m.image_url || '' } };
    });
  },
  async command(c, id, p) {
    return withMA(c, async cmd => {
      if ('on' in p) await cmd('players/cmd/power', { player_id: id, powered: !!p.on });
      if ('vol' in p) await cmd('players/cmd/volume_set', { player_id: id, volume_level: Math.round(p.vol) });
      if (p.cmd && CMD[p.cmd]) await cmd('players/cmd/' + CMD[p.cmd], { player_id: id });
      if (p.cmd === 'volume_mute') await cmd('players/cmd/volume_mute', { player_id: id, muted: true });
      // une radio Bêta (URL) ou un élément de la bibliothèque Music Assistant (library://playlist/12, spotify://…)
      if (p.play) await cmd('player_queues/play_media', { queue_id: id, media: p.play, option: 'replace' });
      if (p.say) await cmd('players/cmd/play_announcement', { player_id: id, url: p.say });
    });
  },
  // recherche dans la musique de Music Assistant (pour la page Musique)
  async search(c, q) { return withMA(c, cmd => cmd('music/search', { search_query: String(q || ''), media_types: ['track', 'album', 'playlist', 'radio', 'artist'], limit: 8 })); }
};
