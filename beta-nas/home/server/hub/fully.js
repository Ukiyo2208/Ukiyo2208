// Fully Kiosk Browser — tablettes murales : écran, luminosité, page affichée, annonces vocales (API REST port 2323).
'use strict';
const { json, request } = require('./net');
const tabs = c => String(c.hosts || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const [ip, ...n] = x.split(/\s*[:=]\s*(?=\D)/); return { ip: ip.trim(), name: n.join(' ').trim() }; });
const q = (c, ip, o) => 'http://' + ip + ':2323/?' + new URLSearchParams(Object.assign({ type: 'json', password: c.password || '' }, o));
const info = (c, ip) => json(q(c, ip, { cmd: 'deviceInfo' }), { timeout: 4000 });
module.exports = {
  id: 'fully', name: 'Fully Kiosk', poll: 5000, secrets: ['password'],
  async test(c) { const ts = tabs(c); if (!ts.length) throw new Error('adresse IP manquante'); const r = await Promise.all(ts.map(t => info(c, t.ip).then(i => i.status === 'Error' ? '⚠ ' + t.ip + ' : ' + i.statustext : (t.name || i.deviceName), e => '⚠ ' + t.ip + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' tablette(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(tabs(c).map(t => info(c, t.ip).then(i => i.status === 'Error' ? null : ({ id: t.ip, name: 'Écran ' + (t.name || i.deviceName || t.ip), kind: 'light', info: 'Batterie ' + i.batteryLevel + ' %', state: { on: !!i.screenOn, bri: Math.round((+i.screenBrightness || 0) / 2.55) } }), () => null)))).filter(Boolean);
  },
  async command(c, ip, p) {
    const go = o => request(q(c, ip, o), { timeout: 5000 });
    if ('on' in p) await go({ cmd: p.on ? 'screenOn' : 'screenOff' });
    if ('bri' in p) await go({ cmd: 'setStringSetting', key: 'screenBrightness', value: Math.round(p.bri * 2.55) });
    if (p.say) await go({ cmd: 'textToSpeech', text: p.say, locale: 'fr_FR' });   // annonce vocale
    if (p.url) await go({ cmd: 'loadURL', url: p.url });                             // ouvrir une page (ex. caméra)
    if (p.front) await go({ cmd: 'toForeground' });
    if (p.sound) await go({ cmd: 'playSound', url: p.sound, loop: 'false' });          // radio du réveil, carillon
    if (p.stopSound) await go({ cmd: 'stopSound' });                                   // ramener Fully (donc Bêta home) devant
  }
};
