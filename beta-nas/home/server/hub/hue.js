// Philips Hue — API locale officielle du pont (CLIP v2). Appairage : bouton du pont puis « Appairer ».
'use strict';
const { json, hexToXy, xyToHex } = require('./net');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const api = (c, path, o) => json('https://' + host(c) + '/clip/v2/resource' + path, Object.assign({ insecure: true, headers: { 'hue-application-key': c.key } }, o));
const state = l => {
  const s = { on: !!(l.on && l.on.on) };
  if (l.dimming) s.bri = Math.round(l.dimming.brightness);
  if (l.color && l.color.xy) s.color = xyToHex(l.color.xy.x, l.color.xy.y);
  return s;
};

module.exports = {
  id: 'hue', name: 'Philips Hue', poll: 3000, secrets: ['key'],
  actions: {
    async discover() {
      const l = await json('https://discovery.meethue.com/');
      if (!l || !l.length) throw new Error('aucun pont trouvé : saisissez son adresse IP');
      return { host: l[0].internalipaddress };
    },
    async pair(c, b) {
      const h = b.host || c.host; if (!h) throw new Error('adresse IP du pont manquante');
      const r = await json('https://' + host({ host: h }) + '/api', { insecure: true, body: { devicetype: 'beta_os#serveur', generateclientkey: true } });
      const e = r && r[0] && r[0].error; if (e) throw new Error(e.type === 101 ? 'appuyez d’abord sur le bouton rond du pont, puis réessayez dans les 30 s' : e.description);
      return { host: h, key: r[0].success.username };
    }
  },
  async test(c) {
    if (!c.key) throw new Error('pont non appairé');
    const l = await api(c, '/light'); return l.data.length + ' lampe(s)';
  },
  async devices(c) {
    const [lights, rooms] = await Promise.all([api(c, '/light'), api(c, '/room').catch(() => ({ data: [] }))]);
    const roomOf = {}; rooms.data.forEach(r => (r.children || []).forEach(ch => { roomOf[ch.rid] = r.metadata.name; }));
    return lights.data.map(l => ({ id: l.id, name: l.metadata.name, kind: l.color ? 'rgb' : 'light', room: roomOf[l.owner && l.owner.rid] || '', state: state(l) }));
  },
  async command(c, id, p) {
    const b = {};
    if ('on' in p) b.on = { on: !!p.on };
    if ('bri' in p) b.dimming = { brightness: Math.max(1, Math.min(100, +p.bri)) };
    if (p.color) b.color = { xy: hexToXy(p.color) };
    if ('ct' in p) b.color_temperature = { mirek: Math.max(153, Math.min(500, Math.round(1e6 / p.ct))) };
    if (Object.keys(b).length) await api(c, '/light/' + id, { method: 'PUT', body: b });
  }
};
