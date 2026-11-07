// Wake-on-LAN : allume une TV en veille (paquet magique en diffusion sur le réseau local).
'use strict';
const dgram = require('dgram');
module.exports = function wol(mac) {
  const m = String(mac || '').replace(/[^0-9a-f]/gi, ''); if (m.length !== 12) return Promise.reject(new Error('adresse MAC de la TV manquante (réglages de la fiche)'));
  const b = Buffer.concat([Buffer.alloc(6, 0xff)].concat(Array(16).fill(Buffer.from(m, 'hex'))));
  return new Promise(ok => { const s = dgram.createSocket('udp4'); s.bind(() => { s.setBroadcast(true); s.send(b, 9, '255.255.255.255', () => { s.send(b, 7, '255.255.255.255', () => { s.close(); ok(); }); }); }); });
};
