// Bêta home — pont HomeKit (app Maison d'Apple, Siri) pour les appareils du tableau de bord, comme celui des caméras.
// Même liste que le pont Matter (Connexions › Alexa et Maison), case « Maison » cochée. Basé sur HAP-NodeJS (Homebridge).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import hap from 'hap-nodejs';
const { Bridge, Accessory, Service, Characteristic, uuid, Categories, HAPStorage } = hap;

const MODE = { 'Arrêt': 0, Chaud: 1, Froid: 2, Auto: 3 }, BACK = ['Arrêt', 'Chaud', 'Froid', 'Auto'];
// type Bêta → accessoire HomeKit
function typeOf(it) {
  if (it.type === 'button') return 'button';
  if (it.type === 'trigger') return 'contact';
  return ({ light: 'light', rgb: 'light', plug: 'outlet', power: 'outlet', computer: 'switch', app: 'switch', tv: 'switch', speaker: 'switch', valve: 'switch', fan: 'fan', cover: 'cover', awning: 'cover', garage: 'cover', lock: 'lock', clim: 'thermostat', temp: 'temp', hum: 'hum', co2: 'co2', door: 'contact', motion: 'motion', leak: 'leak' })[it.kind] || 'switch';
}
const C = Characteristic;
const SVC = { light: Service.Lightbulb, outlet: Service.Outlet, switch: Service.Switch, button: Service.Switch, fan: Service.Fanv2, cover: Service.WindowCovering, lock: Service.LockMechanism, thermostat: Service.Thermostat, temp: Service.TemperatureSensor, hum: Service.HumiditySensor, co2: Service.CarbonDioxideSensor, contact: Service.ContactSensor, motion: Service.MotionSensor, leak: Service.LeakSensor };
const CAT = { light: Categories.LIGHTBULB, outlet: Categories.OUTLET, fan: Categories.FAN, cover: Categories.WINDOW_COVERING, lock: Categories.DOOR_LOCK, thermostat: Categories.THERMOSTAT, contact: Categories.SENSOR, motion: Categories.SENSOR, temp: Categories.SENSOR, hum: Categories.SENSOR, co2: Categories.SENSOR, leak: Categories.SENSOR };
// état Bêta → caractéristiques HomeKit
function apply(svc, t, s) {
  s = s || {}; const set = (c, v) => { if (v !== undefined && v !== null && !Number.isNaN(v)) svc.updateCharacteristic(c, v); };
  switch (t) {
    case 'light': set(C.On, !!s.on); set(C.Brightness, Math.max(0, Math.min(100, Math.round(s.bri == null ? 100 : s.bri)))); break;
    case 'outlet': case 'switch': set(C.On, !!s.on); if (t === 'outlet') set(C.OutletInUse, !!s.on); break;
    case 'button': set(C.On, false); break;
    case 'fan': set(C.Active, s.on ? 1 : 0); if (s.pct != null) set(C.RotationSpeed, s.pct); break;
    case 'cover': { const p = Math.max(0, Math.min(100, Math.round(s.pos || 0))); set(C.CurrentPosition, p); set(C.TargetPosition, p); set(C.PositionState, 2); break; }
    case 'lock': { const v = s.locked ? 1 : 0; set(C.LockCurrentState, v); set(C.LockTargetState, v); break; }
    case 'thermostat': { const m = s.on === false ? 0 : (MODE[s.hvac] ?? 3); set(C.TargetHeatingCoolingState, m); set(C.CurrentHeatingCoolingState, Math.min(2, m === 3 ? 1 : m)); if (s.temp != null) set(C.TargetTemperature, Math.max(10, Math.min(38, s.temp))); set(C.CurrentTemperature, s.cur != null ? s.cur : s.temp != null ? s.temp : 20); break; }
    case 'temp': set(C.CurrentTemperature, s.val != null ? +s.val : 0); break;
    case 'hum': set(C.CurrentRelativeHumidity, s.val != null ? +s.val : 0); break;
    case 'co2': set(C.CarbonDioxideLevel, s.val != null ? +s.val : 0); set(C.CarbonDioxideDetected, (+s.val || 0) > 1200 ? 1 : 0); break;
    case 'contact': set(C.ContactSensorState, s.on ? 1 : 0); break;                 // 1 = ouvert
    case 'motion': set(C.MotionDetected, !!s.on); break;
    case 'leak': set(C.LeakDetected, s.on ? 1 : 0); break;
  }
}

export async function startHomeKit({ beta, send, store, port }) {
  HAPStorage.setCustomStoragePath(path.join(store, 'homekit'));
  // identité du pont et code d'appairage : créés une fois, gardés pour que l'appairage tienne après un redémarrage
  const file = path.join(store, 'homekit.json');
  let id = {}; try { id = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { }
  if (!id.username) {
    const b = crypto.randomBytes(6); b[0] = (b[0] & 0xfe) | 0x02;
    const d = () => crypto.randomInt(0, 10); let pin; do { pin = Array.from({ length: 8 }, d).join(''); } while (/^(\d)\1+$/.test(pin) || ['12345678', '87654321'].includes(pin));
    id = { username: [...b].map(x => x.toString(16).padStart(2, '0')).join(':').toUpperCase(), pin: pin.slice(0, 3) + '-' + pin.slice(3, 5) + '-' + pin.slice(5), setupID: crypto.randomBytes(2).toString('hex').toUpperCase() };
    fs.mkdirSync(store, { recursive: true }); fs.writeFileSync(file, JSON.stringify(id));
  }
  const bridge = new Bridge('Bêta home', uuid.generate('beta-home-bridge'));
  bridge.getService(Service.AccessoryInformation).setCharacteristic(C.Manufacturer, 'Bêta home').setCharacteristic(C.Model, 'Pont Bêta home').setCharacteristic(C.SerialNumber, id.username.replace(/:/g, ''));
  const live = new Map();   // clé → { acc, svc, t, last }
  function add(it) {
    const t = typeOf(it), name = String(it.name || it.key).replace(/[^\p{L}\p{N} '’.-]/gu, ' ').trim().slice(0, 60) || 'Appareil';
    const acc = new Accessory(name, uuid.generate('beta:' + it.key));
    acc.category = CAT[t] || Categories.SWITCH;
    acc.getService(Service.AccessoryInformation).setCharacteristic(C.Manufacturer, 'Bêta home').setCharacteristic(C.Model, it.kind || it.type || 'appareil').setCharacteristic(C.SerialNumber, crypto.createHash('md5').update(it.key).digest('hex').slice(0, 12));
    const svc = acc.addService(SVC[t], name), rec = { acc, svc, t, key: it.key, last: Object.assign({}, it.state) };
    if (t === 'thermostat') svc.getCharacteristic(C.TargetTemperature).setProps({ minValue: 10, maxValue: 38, minStep: 0.5 });
    // ordres venus de l'app Maison / Siri
    const on = (c, fn) => svc.getCharacteristic(c).onSet(v => { fn(v); });
    if (t === 'light' || t === 'outlet' || t === 'switch') on(C.On, v => send(it.key, { on: !!v }));
    if (t === 'light') on(C.Brightness, v => send(it.key, { bri: v }));
    if (t === 'button') on(C.On, v => { if (v) { send(it.key, { run: true }); setTimeout(() => svc.updateCharacteristic(C.On, false), 1000); } });
    if (t === 'fan') { on(C.Active, v => send(it.key, { on: !!v })); on(C.RotationSpeed, v => send(it.key, { pct: v })); }
    if (t === 'cover') on(C.TargetPosition, v => send(it.key, { pos: v }));
    if (t === 'lock') on(C.LockTargetState, v => send(it.key, { locked: v === 1 }));
    if (t === 'thermostat') { on(C.TargetHeatingCoolingState, v => send(it.key, v === 0 ? { on: false } : { on: true, hvac: BACK[v] })); on(C.TargetTemperature, v => send(it.key, { temp: v })); }
    apply(svc, t, it.state);
    live.set(it.key, rec);
    return acc;
  }
  async function sync() {
    let data; try { data = await beta('/api/bridge/state?to=homekit'); } catch (e) { return; }
    const items = (data.items || []).filter(i => i.homekit), want = new Map(items.map(i => [i.key, i]));
    const gone = [...live.keys()].filter(k => !want.has(k));
    if (gone.length) { bridge.removeBridgedAccessories(gone.map(k => live.get(k).acc)); gone.forEach(k => live.delete(k)); }
    const fresh = items.filter(i => !live.has(i.key)).map(add);
    if (fresh.length) bridge.addBridgedAccessories(fresh);
    items.forEach(i => { const r = live.get(i.key); if (r && JSON.stringify(i.state) !== JSON.stringify(r.last)) { r.last = Object.assign({}, i.state); apply(r.svc, r.t, i.state); } });
  }
  await sync();
  await bridge.publish({ username: id.username, pincode: id.pin, port: port || 51826, category: Categories.BRIDGE, setupID: id.setupID, advertiser: process.env.HK_ADVERTISER || 'ciao' });
  setInterval(sync, 2000);
  const status = () => ({ pin: id.pin, uri: bridge.setupURI(), paired: bridge._accessoryInfo ? bridge._accessoryInfo.paired() : false, devices: live.size });
  console.log('Pont HomeKit Bêta home prêt — code : ' + id.pin + ' — ' + live.size + ' appareil(s)');
  return { status, live };
}
