// Bêta home — pont Matter : les appareils choisis dans Bêta home (Connexions › Alexa / Matter) apparaissent
// dans Alexa (et Google Home, Apple Maison, SmartThings…) comme des appareils Matter locaux. Sans Home Assistant,
// sans abonnement : « Alexa, allume la lumière du salon » part directement au NAS.
// - appareils reliés en direct (Shelly, Hue, Zigbee2MQTT…) : lumières, prises, volets, capteurs
// - routines Bêta : des « boutons » (Alexa, lance Soirée ciné)
// - déclencheurs : des capteurs d'ouverture que Bêta ouvre (sonnette, mode absent) pour lancer des routines Alexa
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

const BETA = (process.env.BETA_URL || 'http://127.0.0.1:8090').replace(/\/+$/, ''), KEY = process.env.BETA_KEY || '';
const PORT = +process.env.BRIDGE_PORT || 5540, PASSCODE = +process.env.BRIDGE_PASSCODE || 20252025, DISCR = +process.env.BRIDGE_DISCRIMINATOR || 3125;
// appairages gardés dans MATTER_STORAGE_PATH (variable lue par matter.js ; /data dans le conteneur)
if (!process.env.MATTER_STORAGE_PATH) Environment.default.vars.set('storage.path', './data');

async function beta(path, body) {
  const r = await fetch(BETA + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Beta-Key': KEY }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('serveur Bêta : HTTP ' + r.status);
  return r.json();
}
const KEYS = new Map();   // identifiant Matter de l'appareil → clé Bêta
const send = (key, patch) => beta('/api/bridge/command', { key, patch }).catch(e => console.warn('commande ' + key + ' : ' + e.message));

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

const server = await ServerNode.create({
  id: 'beta-home-bridge',
  network: { port: PORT },
  commissioning: { passcode: PASSCODE, discriminator: DISCR },
  productDescription: { name: 'Bêta home', deviceType: AggregatorEndpoint.deviceType },
  basicInformation: { vendorName: 'Bêta home', vendorId: VendorId(0xfff1), nodeLabel: 'Bêta home', productName: 'Bêta home', productLabel: 'Bêta home', productId: 0x8000, serialNumber: 'BH-0001', uniqueId: 'beta-home-bridge' }
});
const aggregator = new Endpoint(AggregatorEndpoint, { id: 'aggregator' });
await server.add(aggregator);

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
  let data; try { data = await beta('/api/bridge/state'); } catch (e) { return console.warn(e.message); }
  const want = new Map((data.items || []).map(it => [it.key, it]));
  for (const [k, r] of live) if (!want.has(k)) { live.delete(k); await r.ep.delete().catch(() => { }); console.log('- ' + k); }
  for (const it of want.values()) {
    const r = live.get(it.key);
    if (!r) { try { await addItem(it); } catch (e) { console.warn('ajout ' + it.key + ' : ' + e.message); } continue; }
    const s = it.state || {}, changed = Object.keys(s).some(k => JSON.stringify(s[k]) !== JSON.stringify(r.last[k]));
    if (changed) { r.last = Object.assign({}, s); await r.ep.set(attrs(r.t, s)).catch(e => console.warn('maj ' + it.key + ' : ' + e.message)); }
  }
}
async function status() {
  const c = server.state.commissioning, codes = c.pairingCodes || {};
  await beta('/api/bridge/status', { manual: codes.manualPairingCode, qr: codes.qrPairingCode, commissioned: !!c.commissioned, fabrics: Object.values(c.fabrics || {}).map(f => f.label || ('fabric ' + f.fabricIndex)), devices: live.size, at: Date.now() }).catch(() => { });
}

await server.start();
await sync();
const codes = server.state.commissioning.pairingCodes;
console.log('Pont Matter Bêta home prêt — code d’appairage : ' + codes.manualPairingCode + ' — QR : ' + codes.qrPairingCode);
await status();
setInterval(sync, 2000);
setInterval(status, 30000);
