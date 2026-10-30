// Imprimantes (HP, Epson, Canon, Brother… compatibles IPP / AirPrint) — niveaux d'encre ou de toner et état, en local.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
// requête IPP « Get-Printer-Attributes » (RFC 8011), encodée à la main
function body(uri) {
  const parts = [Buffer.from([2, 0, 0, 0x0b, 0, 0, 0, 1, 0x01])];
  const attr = (tag, name, val) => { const n = Buffer.from(name), v = Buffer.from(val), b = Buffer.alloc(5 + n.length + v.length); b[0] = tag; b.writeUInt16BE(n.length, 1); n.copy(b, 3); b.writeUInt16BE(v.length, 3 + n.length); v.copy(b, 5 + n.length); parts.push(b); };
  attr(0x47, 'attributes-charset', 'utf-8'); attr(0x48, 'attributes-natural-language', 'fr'); attr(0x45, 'printer-uri', uri);
  ['marker-levels', 'marker-names', 'marker-colors', 'printer-state', 'printer-make-and-model', 'printer-state-reasons'].forEach((k, i) => attr(0x44, i ? '' : 'requested-attributes', k));
  parts.push(Buffer.from([0x03])); return Buffer.concat(parts);
}
function parse(b) {
  const out = {}; let i = 8, last = null;
  while (i < b.length) {
    const tag = b[i++]; if (tag === 0x03) break; if (tag < 0x10) continue;   // délimiteurs de groupes
    const nl = b.readUInt16BE(i); i += 2; const name = b.toString('utf8', i, i + nl); i += nl;
    const vl = b.readUInt16BE(i); i += 2; const raw = b.slice(i, i + vl); i += vl;
    const val = tag === 0x21 || tag === 0x23 ? raw.readInt32BE(0) : raw.toString('utf8');
    if (nl) { last = name; out[name] = [val]; } else if (last) out[last].push(val);
  }
  return out;
}
async function attrs(h) {
  for (const path of ['/ipp/print', '/ipp/printer', '/ipp', '/']) {
    const uri = 'ipp://' + h + path, r = await request('http://' + (/:\d+$/.test(h) ? h : h + ':631') + path, { body: body(uri), headers: { 'Content-Type': 'application/ipp' }, raw: true, timeout: 6000 });
    if (r.status === 200 && r.buf.length > 8 && r.buf.readUInt16BE(2) < 0x0400) return parse(r.buf);
  }
  throw new Error('imprimante sans IPP (activez AirPrint / IPP)');
}
const STATE = { 3: 'prête', 4: 'en cours d’impression', 5: 'arrêtée' };
module.exports = {
  id: 'ipp', name: 'Imprimantes', poll: 300000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const a = await attrs(h[0]); return (a['printer-make-and-model'] || ['imprimante'])[0] + ' · ' + (a['marker-levels'] || []).length + ' cartouche(s)'; },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try {
        const a = await attrs(h), model = (a['printer-make-and-model'] || ['Imprimante'])[0], st = STATE[(a['printer-state'] || [])[0]] || '', reason = (a['printer-state-reasons'] || []).filter(x => x !== 'none').join(', ');
        (a['marker-levels'] || []).forEach((lv, i) => out.push({ id: h + '|' + i, name: model + ' — ' + ((a['marker-names'] || [])[i] || 'cartouche ' + (i + 1)), kind: 'meter', info: 'Imprimante · ' + st + (reason ? ' · ' + reason : ''), state: { val: lv < 0 ? null : lv, unit: '%' } }));
      } catch (e) { out.push({ id: h + '|0', name: 'Imprimante ' + h, kind: 'meter', error: e.message, state: {} }); }
    }
    return out;
  },
  async command() { },
  _body: body, _parse: parse
};
