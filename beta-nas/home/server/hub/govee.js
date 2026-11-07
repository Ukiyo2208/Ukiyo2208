// Govee — API officielle (clé API gratuite demandée dans l'app Govee Home).
// Quota d'environ 10 000 appels par jour : l'état est relu toutes les 2 minutes.
'use strict';
const { json, hexToInt, intToHex } = require('./net');
const API = 'https://openapi.api.govee.com/router/api/v1';
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const api = (c, path, body) => { if (!c.apiKey) throw new Error('clé API manquante'); return json(API + path, { headers: { 'Govee-API-Key': c.apiKey }, body }); };
const split = id => { const i = id.indexOf('|'); return { sku: id.slice(0, i), device: id.slice(i + 1) }; };

module.exports = {
  id: 'govee', name: 'Govee', poll: 120000, secrets: ['apiKey'],
  async test(c) { if (!c.apiKey) throw new Error('clé API manquante'); const r = await api(c, '/user/devices'); return (r.data || []).length + ' appareil(s)'; },
  async devices(c) {
    const r = await api(c, '/user/devices'), out = [];
    for (const d of (r.data || []).filter(d => /light/.test(d.type || ''))) {
      const id = d.sku + '|' + d.device, s = {};
      try {
        const st = await api(c, '/device/state', { requestId: rid(), payload: { sku: d.sku, device: d.device } });
        (st.payload && st.payload.capabilities || []).forEach(cap => {
          const v = cap.state && cap.state.value;
          if (cap.instance === 'powerSwitch') s.on = v === 1;
          else if (cap.instance === 'brightness' && typeof v === 'number') s.bri = v;
          else if (cap.instance === 'colorRgb' && typeof v === 'number' && v > 0) s.color = intToHex(v);
        });
      } catch (e) { }
      out.push({ id, name: d.deviceName || d.sku, kind: (d.capabilities || []).some(x => x.instance === 'colorRgb') ? 'rgb' : 'light', info: d.sku, state: s });
    }
    return out;
  },
  async command(c, id, p) {
    const { sku, device } = split(id), send = capability => api(c, '/device/control', { requestId: rid(), payload: { sku, device, capability } });
    if ('on' in p) await send({ type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: p.on ? 1 : 0 });
    if ('bri' in p) await send({ type: 'devices.capabilities.range', instance: 'brightness', value: Math.max(1, Math.min(100, +p.bri)) });
    if (p.color) await send({ type: 'devices.capabilities.color_setting', instance: 'colorRgb', value: hexToInt(p.color) });
  }
};
