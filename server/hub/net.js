// Petit client HTTP commun aux connecteurs (sans dépendance).
// insecure : accepte le certificat auto-signé d'un appareil du réseau local (box TaHoma, pont Hue).
'use strict';
const http = require('http'), https = require('https');

function request(url, o) {
  o = o || {};
  return new Promise((ok, ko) => {
    const u = new URL(url), lib = u.protocol === 'https:' ? https : http;
    let body = o.body;
    const headers = Object.assign({}, o.headers);
    if (o.form) { body = new URLSearchParams(o.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body != null && typeof body !== 'string') { body = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
    if (body != null) headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(u, { method: o.method || (body != null ? 'POST' : 'GET'), headers, rejectUnauthorized: !o.insecure, timeout: o.timeout || 15000 }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(ch), text = buf.toString('utf8');
        const r = { status: res.statusCode, headers: res.headers, text, buf, json() { try { return JSON.parse(text); } catch (e) { return null; } } };
        if (o.raw || (res.statusCode >= 200 && res.statusCode < 300)) return ok(r);
        const j = r.json(), msg = j && (j.error_description || j.message || j.error && (j.error.description || j.error.message || j.error) || j.errorCode);
        ko(new Error('HTTP ' + res.statusCode + (msg ? ' : ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)) : '')));
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e => ko(new Error(e.code === 'ENOTFOUND' || e.code === 'EHOSTUNREACH' || e.code === 'ECONNREFUSED' ? 'appareil injoignable (' + e.code + ')' : e.message)));
    if (body != null) req.write(body);
    req.end();
  });
}
const json = async (url, o) => (await request(url, o)).json();

/* couleurs : #rrggbb <-> xy (CIE 1931, utilisé par Philips Hue) */
function hexToXy(hex) {
  const c = [0, 2, 4].map(i => parseInt(hex.replace('#', '').substr(i, 2), 16) / 255).map(v => v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92);
  const X = c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805, Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, Z = c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505, s = X + Y + Z;
  return s ? { x: +(X / s).toFixed(4), y: +(Y / s).toFixed(4) } : { x: 0.3127, y: 0.329 };
}
function xyToHex(x, y) {
  const Y = 1, X = (Y / y) * x, Z = (Y / y) * (1 - x - y);
  let rgb = [X * 3.2406 - Y * 1.5372 - Z * 0.4986, -X * 0.9689 + Y * 1.8758 + Z * 0.0415, X * 0.0557 - Y * 0.204 + Z * 1.057];
  const m = Math.max(...rgb, 1e-6); rgb = rgb.map(v => Math.max(0, v / m)).map(v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return '#' + rgb.map(v => ('0' + Math.round(Math.min(1, v) * 255).toString(16)).slice(-2)).join('');
}
const hexToInt = hex => parseInt(hex.replace('#', ''), 16);
const intToHex = n => '#' + ('00000' + (n >>> 0).toString(16)).slice(-6);

module.exports = { request, json, hexToXy, xyToHex, hexToInt, intToHex };
