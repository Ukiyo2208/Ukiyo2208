// eedomus — les périphériques de la box française (Z-Wave, RFXCom…), par son API locale (Configuration › Mon compte › Consulter vos identifiants).
'use strict';
const { request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return /^https?:/.test(h) ? h : 'http://' + h; };
const q = (c, path, o) => base(c) + '/api/' + path + '?' + new URLSearchParams(Object.assign({ api_user: c.user || '', api_secret: c.secret || '' }, o)).toString();
// la box répond parfois en ISO-8859-1 : on décode à la main
async function get(c, path, o) { const r = await request(q(c, path, o), { timeout: 10000 }); let t = r.buf.toString('utf8'); if (t.includes('�')) t = r.buf.toString('latin1'); const j = JSON.parse(t); if (+j.success !== 1) throw new Error('eedomus : ' + (j.body && j.body.error_msg || 'identifiants refusés')); return j.body; }
const KIND = u => /volet|store|rideau/i.test(u) ? 'cover' : /lampe|lumi|éclair|eclair|variateur|ampoule/i.test(u) ? 'light' : /temp[ée]rature/i.test(u) ? 'temp' : /humidit/i.test(u) ? 'hum' : /mouvement|pr[ée]sence/i.test(u) ? 'motion' : /ouverture|porte|fen[êe]tre/i.test(u) ? 'door' : /consommation|puissance|watt/i.test(u) ? 'meter' : /fuite|inondation/i.test(u) ? 'leak' : /prise|interrupteur|relais|switch|commutateur/i.test(u) ? 'plug' : '';
function state(k, v) {
  const n = parseFloat(String(v).replace(',', '.'));
  if (k === 'cover') return { pos: Math.round(n || 0) };
  if (k === 'light') return { on: n > 0, bri: n > 0 && n <= 100 ? Math.round(n) : undefined };
  if (k === 'plug') return { on: n > 0 };
  if (k === 'temp') return { val: n, unit: '°C' }; if (k === 'hum') return { val: n, unit: '%' }; if (k === 'meter') return { val: Math.round(n || 0), unit: 'W' };
  return { on: n > 0 };
}
module.exports = {
  id: 'eedomus', name: 'eedomus', poll: 15000, secrets: ['secret'],
  async test(c) { const l = await get(c, 'get', { action: 'periph.list' }); return l.length + ' périphérique(s), ' + l.filter(x => KIND(x.usage_name || '')).length + ' reconnu(s)'; },
  async devices(c) {
    const l = (await get(c, 'get', { action: 'periph.list' })).filter(x => KIND(x.usage_name || '')), out = [];
    for (let i = 0; i < l.length; i += 8) await Promise.all(l.slice(i, i + 8).map(async x => {
      const k = KIND(x.usage_name || '');
      try { const d = await get(c, 'get', { action: 'periph.caract', periph_id: x.periph_id }); out.push({ id: String(x.periph_id), name: x.name, room: x.room_name || '', kind: k, info: 'eedomus · ' + x.usage_name, state: state(k, d.last_value) }); }
      catch (e) { out.push({ id: String(x.periph_id), name: x.name, room: x.room_name || '', kind: k, error: e.message, state: {} }); }
    }));
    return out;
  },
  async command(c, id, p) {
    let v = null;
    if ('bri' in p) v = Math.round(p.bri); else if ('pos' in p) v = Math.round(p.pos); else if ('on' in p) v = p.on ? 100 : 0;
    if (v !== null) await get(c, 'set', { action: 'periph.value', periph_id: id, value: v });
  },
  _kind: KIND
};
