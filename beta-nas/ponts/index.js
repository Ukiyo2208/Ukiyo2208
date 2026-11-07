// Ponts de Bêta (repris de Bêta home) : les appareils de Home Assistant choisis dans Bêta home
// (http://IP_DU_NAS:8800/home/) apparaissent dans Alexa (Matter, sans skill) et dans l'app Maison d'Apple
// (HomeKit), chacun avec sa propre liste. Les ordres passent par Bêta, puis Home Assistant.
// Alexa : enceinte Echo compatible Matter et IPv6 sur le réseau. HomeKit : un iPhone sur le même réseau.
import { Endpoint, Environment, ServerNode, VendorId } from '@matter/main';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { WindowCoveringServer } from '@matter/main/behaviors/window-covering';
import { OccupancySensingServer } from '@matter/main/behaviors/occupancy-sensing';
import { OccupancySensing } from '@matter/main/clusters/occupancy-sensing';
import { WindowCovering } from '@matter/main/clusters/window-covering';
import { DimmableLightDevice } from '@matter/main/devices/dimmable-light';
import { OnOffPlugInUnitDevice } from '@matter/main/devices/on-off-plug-in-unit';
import { WindowCoveringDevice } from '@matter/main/devices/window-covering';
import { ContactSensorDevice } from '@matter/main/devices/contact-sensor';
import { OccupancySensorDevice } from '@matter/main/devices/occupancy-sensor';
import { TemperatureSensorDevice } from '@matter/main/devices/temperature-sensor';
import { HumiditySensorDevice } from '@matter/main/devices/humidity-sensor';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { startHomeKit } from './homekit.js';

const BETA = (process.env.BETA_URL || 'http://127.0.0.1:8800').replace(/\/+$/, ''), JETON = process.env.BETA_TOKEN || '';
let matterOk = false, matterErr = '', hk = null, hkErr = '';
const PORT = +process.env.BRIDGE_PORT || 5540, PASSCODE = +process.env.BRIDGE_PASSCODE || 20252025, DISCR = +process.env.BRIDGE_DISCRIMINATOR || 3125;
// appairages gardés dans MATTER_STORAGE_PATH (variable lue par matter.js ; /data dans le conteneur)
if (!process.env.MATTER_STORAGE_PATH) Environment.default.vars.set('storage.path', './data');
// une panne de Matter (IPv6 absente sur le réseau…) est notée et affichée dans Bêta home
Environment.default.vars.set('runtime.unhandlederrors', false);
process.on('unhandledRejection', e => { matterErr = (e && e.message) || String(e); console.warn('Matter : ' + matterErr); });

async function beta(path, body) {
  const r = await fetch(BETA + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + JETON }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Bêta : HTTP ' + r.status);
  return r.json();
}
const KEYS = new Map();   // identifiant Matter de l'appareil → clé Bêta
const commande = pour => (key, patch) => beta('/v1/ponts/commande', { key, patch, pour }).catch(e => console.warn(pour + ' ' + key + ' : ' + e.message));
const send = commande('alexa');

// volets : Alexa demande une position (0 = ouvert en Matter, donc on inverse pour Bêta : 100 = ouvert)
const CoverServer = WindowCoveringServer.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift);
class BetaCover extends CoverServer {
  async handleMovement(type, reversed, direction, target) {
    const key = KEYS.get(this.endpoint.id);
    const pos = target != null ? 100 - Math.round(target / 100) : direction === 1 ? 0 : 100;   // direction 1 = fermer
    send(key, { pos });
    if (target != null) this.state.targetPositionLiftPercent100ths = target;
  }
  async handleStopMovement() { send(KEYS.get(this.endpoint.id), { moving: 'stop' }); }
}

// type Bêta → appareil Matter
function typeOf(it) {
  if (it.type === 'button') return 'button';
  if (it.type === 'trigger') return 'contact';
  return ({ light: 'light', rgb: 'light', cover: 'cover', awning: 'cover', garage: 'cover', door: 'contact', leak: 'contact', motion: 'motion', temp: 'temp', hum: 'hum' })[it.kind] || 'plug';
}
const DEVICE = { light: DimmableLightDevice, plug: OnOffPlugInUnitDevice, button: OnOffPlugInUnitDevice, cover: WindowCoveringDevice.with(BetaCover), contact: ContactSensorDevice, motion: OccupancySensorDevice.with(OccupancySensingServer.with(OccupancySensing.Feature.PassiveInfrared)), temp: TemperatureSensorDevice, hum: HumiditySensorDevice };
// état Bêta → attributs Matter
function attrs(t, s) {
  s = s || {};
  switch (t) {
    case 'light': return { onOff: { onOff: !!s.on }, levelControl: { currentLevel: Math.max(1, Math.round((s.bri == null ? 100 : s.bri) * 2.54)) } };
    case 'plug': case 'button': return { onOff: { onOff: !!s.on } };
    case 'cover': { const v = (100 - Math.max(0, Math.min(100, Math.round(s.pos || 0)))) * 100; return { windowCovering: { currentPositionLiftPercent100ths: v, targetPositionLiftPercent100ths: v } }; }
    case 'contact': return { booleanState: { stateValue: !s.on } };          // Matter : true = fermé
    case 'motion': return { occupancySensing: { occupancy: { occupied: !!s.on } } };
    case 'temp': return { temperatureMeasurement: { measuredValue: s.val == null ? null : Math.round(s.val * 100) } };
    case 'hum': return { relativeHumidityMeasurement: { measuredValue: s.val == null ? null : Math.round(s.val * 100) } };
  }
  return {};
}

let server = null, aggregator = null;
// sans IPv6 sur le réseau, Matter peut rester bloqué : on abandonne au bout de 20 s (voir en bas)
async function initMatter() {
  server = await ServerNode.create({
    id: 'beta-home-bridge',
    network: { port: PORT },
    commissioning: { passcode: PASSCODE, discriminator: DISCR },
    productDescription: { name: 'Bêta home', deviceType: AggregatorEndpoint.deviceType },
    basicInformation: { vendorName: 'Bêta home', vendorId: VendorId(0xfff1), nodeLabel: 'Bêta home', productName: 'Bêta home', productLabel: 'Bêta home', productId: 0x8000, serialNumber: 'BH-0001', uniqueId: 'beta-home-bridge' }
  });
  aggregator = new Endpoint(AggregatorEndpoint, { id: 'aggregator' });
  await server.add(aggregator);
}

const live = new Map();   // clé → { ep, t, last }
const epId = key => 'e_' + hashKey(key);
function hashKey(k) { let h = 0; for (const c of k) h = (h * 31 + c.codePointAt(0)) >>> 0; return k.replace(/[^\w]/g, '_').slice(0, 40) + '_' + h.toString(36); }
async function addItem(it) {
  const t = typeOf(it), id = epId(it.key), name = String(it.name || it.key).slice(0, 32);
  const ep = new Endpoint(DEVICE[t].with(BridgedDeviceBasicInformationServer), Object.assign({
    id, bridgedDeviceBasicInformation: { nodeLabel: name, productName: name.slice(0, 32), productLabel: name.slice(0, 64), serialNumber: ('sn' + id).slice(-32), uniqueId: id.slice(-32), reachable: true }
  }, t === 'motion' ? { occupancySensing: { occupancySensorType: 0, occupancySensorTypeBitmap: { pir: true } } } : {}, attrs(t, it.state)));
  KEYS.set(id, it.key);
  await aggregator.add(ep);
  const rec = { ep, t, last: Object.assign({}, it.state), key: it.key };
  live.set(it.key, rec);
  // ordres venus d'Alexa (on ignore l'écho de nos propres mises à jour)
  if (ep.events.onOff) ep.events.onOff.onOff$Changed.on(v => {
    if (rec.t === 'button') { if (v) { send(rec.key, { run: true }); setTimeout(() => ep.set({ onOff: { onOff: false } }).catch(() => { }), 1200); } return; }
    if (!!rec.last.on === v) return; rec.last.on = v; send(rec.key, { on: v });
  });
  if (ep.events.levelControl) ep.events.levelControl.currentLevel$Changed.on(v => {
    if (v == null) return; const bri = Math.round(v / 2.54); if (Math.abs(bri - (rec.last.bri == null ? 100 : rec.last.bri)) <= 1) return; rec.last.bri = bri; send(rec.key, { bri });
  });
  console.log('+ ' + name + ' (' + t + ')');
}
async function sync() {
  let data; try { data = await beta('/v1/ponts/etat?pour=alexa'); } catch (e) { return console.warn(e.message); }
  const want = new Map((data.items || []).filter(it => it.matter !== false).map(it => [it.key, it]));   // case « Alexa » cochée
  for (const [k, r] of live) if (!want.has(k)) { live.delete(k); await r.ep.delete().catch(() => { }); console.log('- ' + k); }
  for (const it of want.values()) {
    const r = live.get(it.key);
    if (!r) { try { await addItem(it); } catch (e) { console.warn('ajout ' + it.key + ' : ' + e.message); } continue; }
    const s = it.state || {}, changed = Object.keys(s).some(k => JSON.stringify(s[k]) !== JSON.stringify(r.last[k]));
    if (changed) { r.last = Object.assign({}, s); await r.ep.set(attrs(r.t, s)).catch(e => console.warn('maj ' + it.key + ' : ' + e.message)); }
  }
}
async function status() {
  const out = { at: Date.now(), matterErr, hkErr, hk: hk ? hk.status() : null };
  if (matterOk) { const c = server.state.commissioning, codes = c.pairingCodes || {}; Object.assign(out, { manual: codes.manualPairingCode, qr: codes.qrPairingCode, commissioned: !!c.commissioned, fabrics: Object.values(c.fabrics || {}).map(f => f.label || ('fabric ' + f.fabricIndex)), devices: live.size }); }
  await beta('/v1/ponts/statut', out).catch(() => { });
}

// HomeKit d'abord : il fonctionne même si Matter ne peut pas démarrer (IPv6 absente…)
if (process.env.HOMEKIT !== 'off') {
  try { hk = await startHomeKit({ beta, send: commande('homekit'), store: process.env.MATTER_STORAGE_PATH || './data', port: +process.env.HOMEKIT_PORT || 51826 }); }
  catch (e) { hkErr = e.message; console.warn('HomeKit : ' + e.message); }
}
if (process.env.ALEXA !== 'off') try {
  await Promise.race([initMatter(), new Promise((ok, ko) => setTimeout(() => ko(new Error('démarrage trop long (IPv6 ?)')), 20000))]);
  await server.start();
  await sync();
  matterOk = true;
  const codes = server.state.commissioning.pairingCodes;
  console.log('Pont Alexa (Matter) prêt — code d’appairage : ' + codes.manualPairingCode + ' — QR : ' + codes.qrPairingCode);
  setInterval(sync, 2000);
} catch (e) { matterErr = e.message; console.warn('Matter indisponible : ' + e.message); }
await status();
setInterval(status, 15000);
