// Calculs du serveur : soleil, énergie et Tempo, chauffage, rappels, colis, calendriers, sauvegarde chiffrée
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, mocks } = require('./helpers');
const R = path.join(__dirname, '..', 'server') + '/';
const DATA = tmp('logic'), M = mocks({ h1: { on: true, temp: 19 }, t1: { val: 19.5 }, w1: { on: false }, p1: { w: 0 } });
const ENGINE = require(R + 'engine')(DATA, () => { }, async () => ({}), { HUB: M.HUB, NOTIFY: M.NOTIFY, GEO: M.GEO });
const PLUS = require(R + 'plus')(DATA, () => { }, async () => ({}), { HUB: M.HUB, NOTIFY: M.NOTIFY, ENGINE, AUTH: {} });
const EXTRA = require(R + 'extra')(DATA, () => { }, async () => ({}), { HUB: M.HUB, NOTIFY: M.NOTIFY, ENGINE, PLUS, LOGS: [], MODS: () => ({}) });
const FAM = require(R + 'famille')(DATA, () => { }, async () => ({}), { HUB: M.HUB, NOTIFY: M.NOTIFY, ENGINE, PLUS, EXTRA });
const X = ENGINE.X;

test('lever et coucher du soleil à Fegersheim (30 octobre)', () => {
  const s = ENGINE._test.sun(48.4917, 7.6806, new Date(2026, 9, 30));
  const h = d => d.getUTCHours() * 60 + d.getUTCMinutes();
  assert.ok(Math.abs(h(s.rise) - (6 * 60 + 10)) < 15, 'lever vers 7 h 10 (heure de Paris)');
  assert.ok(Math.abs(h(s.set) - (16 * 60 + 15)) < 15, 'coucher vers 17 h 15');
});

test('énergie : kWh et euros avec Tempo (jour rouge, heures pleines / creuses)', () => {
  Object.assign(X.C.devices, { p1: { brand: 'x', bid: 'p1', kind: 'plug', name: 'Lave-linge' } });
  const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(20, 0, 0, 0);
  const pts = []; for (let m = 0; m <= 60; m += 10) pts.push([Math.round(+y / 1000) + m * 60, m === 60 ? 0 : 2000]);
  const y2 = new Date(+y); y2.setHours(23); for (let m = 0; m <= 60; m += 10) pts.push([Math.round(+y2 / 1000) + m * 60, m === 60 ? 0 : 1000]);
  fs.writeFileSync(path.join(X.HDIR, 'p1.jsonl'), pts.map(p => JSON.stringify(p)).join('\n') + '\n');
  PLUS.C.tempoDays[X.ymd(y)] = 'rouge'; PLUS.C.tariff.mode = 'tempo';
  const d = PLUS._test.energy(7).days.find(x => x.date === X.ymd(y));
  assert.strictEqual(d.kwh, 3);
  assert.ok(Math.abs(d.eur - (2 * 0.6586 + 0.1518)) < 0.01);
});

test('chauffage : confort, absence, jour rouge, fenêtre ouverte', () => {
  const z = { id: 'z', devs: ['h1'], windows: ['w1'], comfort: 20, eco: 17, frost: 12, sched: [{ days: [], from: '00:00', to: '23:59' }], winDelay: 0, tempoRed: -1 };
  const T = PLUS._test.heatTarget;
  assert.strictEqual(T(z, new Date()).target, 20);
  M.NOTIFY.setAway(true); assert.strictEqual(T(z, new Date()).target, 17); M.NOTIFY.setAway(false);
  X.S.tempo = { today: 'rouge' }; const d10 = new Date(); d10.setHours(10); assert.strictEqual(T(z, d10).target, 19); X.S.tempo = null;
});

test('rappels : 31 janvier + 1 mois = 28 février', () => {
  assert.strictEqual(EXTRA._test.nextDue({ last: '2026-01-31', every: 1 }), '2026-02-28');
  assert.strictEqual(EXTRA._test.nextDue({ last: '2026-10-15', every: 6 }), '2027-04-15');
});

test('contrôle parental : plages qui passent minuit', () => {
  const k = { sched: [{ days: [], from: '21:00', to: '07:00' }] }, at = h => new Date(2026, 9, 30, h);
  assert.ok(EXTRA._test.kidWant(k, at(22))); assert.ok(EXTRA._test.kidWant(k, at(6))); assert.ok(!EXTRA._test.kidWant(k, at(12)));
});

test('colis : état d’après l’objet du mail', () => {
  const s = FAM._test.stateOf;
  assert.strictEqual(s('Votre colis a été livré'), 'delivered');
  assert.strictEqual(s('Colis livré !'), 'delivered');
  assert.strictEqual(s('Il sera livré demain'), 'transit');
  assert.strictEqual(s("Votre livreur arrive aujourd'hui"), 'today');
  assert.strictEqual(s('En cours de livraison'), 'today');
  assert.ok(FAM._test.mailText('Content-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('<p>Bonjour, votre colis Colissimo <b>6A12345678901</b> est en route.</p>').toString('base64') + '\r\n').includes('6A12345678901'));
  assert.strictEqual(FAM._test.decWord('=?UTF-8?B?Q29saXMgbGl2csOp?='), 'Colis livré');
});

test('calendrier : séries hebdomadaires, exceptions, journées entières', () => {
  const ics = 'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=Europe/Paris:20261005T180000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE;TZID=Europe/Paris:20261104T180000\r\nSUMMARY:Judo\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:Armistice\r\nEND:VEVENT';
  const ev = FAM._test.parseIcs(ics, { id: 'x', name: 'Famille' }, +new Date(2026, 10, 1), +new Date(2026, 10, 12));
  assert.deepStrictEqual(ev.filter(e => e.title === 'Judo').map(e => e.date), ['2026-11-02', '2026-11-09', '2026-11-11']);
  assert.ok(ev.some(e => e.title === 'Armistice' && e.time === ''));
});

test('recharge : les 4 heures les moins chères avant 7 h (HP/HC)', () => {
  PLUS.C.tariff.mode = 'hphc'; FAM._test.planEV(new Date(2026, 9, 30, 18, 10));
  assert.deepStrictEqual(FAM._test.evPlan().slots.filter(s => s.on).map(s => new Date(s.t).getHours()), [22, 23, 0, 1]);
});

test('sauvegarde chiffrée : relecture, mauvais mot de passe refusé, secrets illisibles', () => {
  fs.writeFileSync(path.join(DATA, 'hub.json'), '{"x":{"token":"s3cret"}}');
  const enc = PLUS._test.encrypt(PLUS._test.collect(true), 'motdepasse');
  assert.ok(!JSON.stringify(enc).includes('s3cret'));
  assert.throws(() => PLUS._test.decrypt(enc, 'faux'), /mot de passe incorrect/);
  assert.strictEqual(JSON.parse(PLUS._test.decrypt(enc, 'motdepasse').files['hub.json']).x.token, 's3cret');
});

test('règles : une condition non remplie est expliquée (mode test)', async () => {
  let out = null; const D2 = tmp('rules'), M2 = mocks({});
  const E2 = require(R + 'engine')(D2, (res, code, body) => { out = body; }, async () => ({ kind: 'doorbell' }), { HUB: M2.HUB, NOTIFY: M2.NOTIFY, GEO: M2.GEO });
  E2.X.C.rules = [{ id: 'r1', name: 'Sonnette absent', when: [{ type: 'doorbell' }], if: [{ type: 'away', is: true }], then: [{ type: 'say', text: 'x' }] }];
  await E2.api({ method: 'POST' }, {}, new URL('http://x/api/engine/sim'));
  assert.strictEqual(out.dry, true);
  assert.strictEqual(out.trace[0].ok, false);
  assert.strictEqual(out.trace[0].failed[0].type, 'away');
});
