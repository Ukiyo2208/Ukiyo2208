// Schneider Charge (et toute borne OCPP 1.6J) — le serveur Bêta joue le rôle de « serveur central » OCPP.
// La borne se connecte d'elle-même à ws://IP-du-NAS:8090/ocpp/<identifiant> ; on suit la charge en direct
// et on peut la démarrer ou l'arrêter. Tout reste sur le réseau local.
'use strict';
const crypto = require('crypto');
const { accept } = require('./ws');

const CP = {};   // bornes connues : id → { ws, status, tx, w, wh, soc, info, seen, wait }
const ST = { Available: 'Libre', Preparing: 'Voiture branchée', Charging: 'En charge', SuspendedEV: 'Pause (voiture)', SuspendedEVSE: 'Pause (borne)', Finishing: 'Fin de charge', Reserved: 'Réservée', Unavailable: 'Indisponible', Faulted: 'En défaut' };
const now = () => new Date().toISOString();

// appel du serveur vers la borne : [2, id, action, données] → réponse [3, id, …] ou erreur [4, id, …]
function call(cp, action, payload) {
  return new Promise((ok, ko) => {
    if (!cp || !cp.ws || !cp.ws.open) return ko(new Error('borne non connectée'));
    const id = crypto.randomBytes(8).toString('hex');
    cp.wait[id] = { ok, ko, t: setTimeout(() => { delete cp.wait[id]; ko(new Error('la borne ne répond pas')); }, 20000) };
    cp.ws.send(JSON.stringify([2, id, action, payload]));
  });
}
function meter(cp, mv) {
  (mv || []).forEach(m => {
    let tot = null, ph = null;
    (m.sampledValue || []).forEach(s => {
      const v = parseFloat(s.value), what = s.measurand || 'Energy.Active.Import.Register', k = s.unit === 'kW' || s.unit === 'kWh' ? 1000 : 1;
      if (isNaN(v)) return;
      if (what === 'Power.Active.Import') { if (!s.phase) tot = v * k; else if (/^L\d$/.test(s.phase)) ph = (ph || 0) + v * k; }
      else if (what === 'Energy.Active.Import.Register' && !s.phase) cp.wh = v * k;
      else if (what === 'SoC') cp.soc = v;
    });
    if (tot != null || ph != null) cp.w = tot != null ? tot : ph;
  });
}
// messages envoyés par la borne
const HANDLERS = {
  BootNotification(cp, p) { cp.info = [p.chargePointVendor, p.chargePointModel].filter(Boolean).join(' '); setTimeout(() => configure(cp), 2000); return { status: 'Accepted', currentTime: now(), interval: 60 }; },
  Heartbeat: () => ({ currentTime: now() }),
  StatusNotification(cp, p) { if (+p.connectorId !== 0) { cp.status = p.status; if (p.status === 'Available') { cp.tx = null; cp.w = 0; cp.soc = null; } } return {}; },
  Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
  StartTransaction(cp, p) { cp.tx = Math.floor(Date.now() / 1000) % 2e9; cp.start = p.meterStart; return { transactionId: cp.tx, idTagInfo: { status: 'Accepted' } }; },
  StopTransaction(cp) { cp.tx = null; cp.w = 0; return { idTagInfo: { status: 'Accepted' } }; },
  MeterValues(cp, p) { if (p.transactionId && !cp.tx) cp.tx = p.transactionId; meter(cp, p.meterValue); return {}; },
  DataTransfer: () => ({ status: 'Accepted' }),
  FirmwareStatusNotification: () => ({}),
  DiagnosticsStatusNotification: () => ({})
};
// relevés toutes les 30 s avec la puissance (les bornes qui refusent un réglage l'ignorent simplement)
function configure(cp) {
  call(cp, 'ChangeConfiguration', { key: 'MeterValueSampleInterval', value: '30' }).catch(() => { });
  call(cp, 'ChangeConfiguration', { key: 'MeterValuesSampledData', value: 'Energy.Active.Import.Register,Power.Active.Import,SoC' }).catch(() => { });
  call(cp, 'TriggerMessage', { requestedMessage: 'StatusNotification', connectorId: 1 }).catch(() => { });
}
const state = cp => ({ on: cp.status === 'Charging' || (!!cp.tx && !/^(Available|Finishing)$/.test(cp.status || '')), kw: Math.round((cp.w || 0) / 100) / 10, car: cp.soc != null ? Math.round(cp.soc) : false, prog: (ST[cp.status] || cp.status || 'Connectée') + (cp.wh != null && cp.start != null && cp.tx ? ' · ' + String(Math.round((cp.wh - cp.start) / 100) / 10).replace('.', ',') + ' kWh' : ''), online: !!(cp.ws && cp.ws.open) });

module.exports = {
  id: 'schneider', name: 'Schneider Charge', poll: 2000, secrets: ['password'],
  actions: {
    // limite de courant appliquée tout de suite à la borne (6 à 32 A)
    async limit(c, b) { const a = +b.amps; if (!(a >= 6 && a <= 32)) throw new Error('limite entre 6 et 32 A'); await module.exports.command(c, c.cpId, { amps: a }); return { amps: String(a) }; }
  },
  // connexion WebSocket de la borne sur /ocpp/<identifiant>
  upgrade(req, socket, c, save) {
    const m = req.url.match(/^\/ocpp\/([^/?#]{1,48})\/?(?:\?.*)?$/); if (!m) return false;
    const id = decodeURIComponent(m[1]);
    if (c.cpId && c.cpId !== id) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return true; }
    if (c.password) {
      const a = String(req.headers.authorization || ''), ok = a.startsWith('Basic ') && Buffer.from(a.slice(6), 'base64').toString() === id + ':' + c.password;
      if (!ok) { socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="OCPP"\r\n\r\n'); return true; }
    }
    const ws = accept(req, socket, 'ocpp1.6'); if (!ws) return true;
    const cp = CP[id] = Object.assign(CP[id] || { wait: {} }, { ws, seen: Date.now() });
    if (!c.cpId) save({ cpId: id });
    ws.onmessage = t => {
      let msg; try { msg = JSON.parse(t); } catch (e) { return; }
      cp.seen = Date.now();
      if (msg[0] === 2) {
        const h = HANDLERS[msg[2]];
        ws.send(JSON.stringify(h ? [3, msg[1], h(cp, msg[3] || {})] : [4, msg[1], 'NotImplemented', 'Action non gérée', {}]));
      } else if (msg[0] === 3 || msg[0] === 4) {
        const w = cp.wait[msg[1]]; if (!w) return; clearTimeout(w.t); delete cp.wait[msg[1]];
        msg[0] === 3 ? w.ok(msg[2]) : w.ko(new Error(msg[3] || msg[2]));
      }
    };
    ws.onclose = () => { if (CP[id] && CP[id].ws === ws) CP[id].ws = null; };
    return true;
  },
  async test(c) {
    const cp = CP[c.cpId];
    if (!cp || !cp.ws || !cp.ws.open) throw new Error(c.cpId ? 'borne « ' + c.cpId + ' » pas connectée au serveur' : 'en attente de la borne : saisissez l’adresse OCPP dans sa configuration');
    return (cp.info || 'Borne') + ' · ' + (ST[cp.status] || 'connectée');
  },
  async devices(c) {
    return Object.keys(CP).filter(id => !c.cpId || id === c.cpId).map(id => ({ id, name: 'Borne de recharge', kind: 'charger', info: CP[id].info || 'OCPP ' + id, state: state(CP[id]) }));
  },
  async command(c, id, p) {
    const cp = CP[id];
    if ('on' in p) {
      if (p.on) { const r = await call(cp, 'RemoteStartTransaction', { connectorId: 1, idTag: c.idTag || 'BETAOS' }); if (r.status !== 'Accepted') throw new Error('démarrage refusé par la borne (voiture branchée ?)'); }
      else { if (!cp || !cp.tx) throw new Error('aucune charge en cours'); const r = await call(cp, 'RemoteStopTransaction', { transactionId: cp.tx }); if (r.status !== 'Accepted') throw new Error('arrêt refusé par la borne'); }
    }
    // limite de courant (ampères) pour toute la charge
    if ('amps' in p) {
      const r = await call(cp, 'SetChargingProfile', { connectorId: 1, csChargingProfiles: { chargingProfileId: 1, stackLevel: 0, chargingProfilePurpose: 'TxDefaultProfile', chargingProfileKind: 'Relative', chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: Math.max(6, Math.min(32, +p.amps)) }] } } });
      if (r.status !== 'Accepted') throw new Error('limite refusée par la borne');
    }
  }
};
