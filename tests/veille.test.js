// Veille des marques : panne après le délai puis retour, réponse différente, nouvelle version, signal d'alerte, ticket GitHub
'use strict';
const test = require('node:test'), assert = require('node:assert'), path = require('path');
const { tmp, mocks, listen } = require('./helpers');

test('veille des marques : pannes, changements d’API, nouvelles, ticket', async () => {
  let tag = 'v1.0', issues = [], ticketBody = null;
  const gh = await listen((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    r.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/repos/arendst/Tasmota/releases/latest')) return r.end(JSON.stringify({ tag_name: tag, published_at: new Date().toISOString(), html_url: 'https://gh/rel/' + tag, body: 'notes' }));
    if (q.url.startsWith('/search/issues')) return r.end(JSON.stringify({ total_count: issues.length, items: issues }));
    if (q.url === '/repos/moi/maison/issues' && q.method === 'POST') { ticketBody = JSON.parse(b); r.writeHead(201); return r.end(JSON.stringify({ number: 7, html_url: 'https://gh/issues/7' })); }
    r.writeHead(404); r.end('{}');
  }); });
  process.env.VEILLE_GH = gh.url;
  const M = mocks({}), polls = [];
  const HUB = { onPoll: f => polls.push(f), configured: () => ['tasmota', 'melcloud'], states: async () => ({}), brand: id => ({ name: { tasmota: 'Tasmota', melcloud: 'MELCloud' }[id] }) };
  let out = null; const send = (res, code, b) => { out = b; };
  const V = require(path.join(__dirname, '..', 'server', 'veille'))(tmp('veille'), send, async () => ({}), { HUB, NOTIFY: M.NOTIFY, ENGINE: null, VERSION: 'test' });
  const poll = (id, err, list) => polls.forEach(f => f(id, err, list)), C = V._test.C;
  C.cfg.delay = 2;
  // marche, puis panne : rien avant le délai, une notification après, puis « refonctionne »
  poll('tasmota', null, [{ id: 'a', kind: 'light', state: { on: true, bri: 50 } }]);
  poll('tasmota', 'HTTP 401', null); await V._test.tick();
  assert.strictEqual(M.sent.length, 0);
  C.brands.tasmota.errSince = Date.now() - 3 * 6e4; await V._test.tick();
  assert.match(M.sent[0][1], /Tasmota en panne/); assert.match(M.sent[0][2], /HTTP 401/);
  await V._test.tick(); assert.strictEqual(M.sent.length, 1);   // une seule fois
  poll('tasmota', null, [{ id: 'a', kind: 'light', state: { on: true, bri: 50 } }]);
  assert.match(M.sent[1][1], /refonctionne/);
  // réponse différente : le champ « bri » disparaît
  poll('tasmota', null, [{ id: 'a', kind: 'light', state: { on: true } }]); poll('tasmota', null, [{ id: 'a', kind: 'light', state: { on: true } }]);
  assert.strictEqual(M.sent.length, 2);   // pas d'alerte sur 2 relevés : peut-être juste une mesure absente
  poll('tasmota', null, [{ id: 'a', kind: 'light', state: { on: true } }]);
  assert.match(M.sent[2][1], /a changé/); assert.match(M.sent[2][2], /light:bri,on/);
  // nouvelles : première lecture sans alerte, puis nouvelle version et ticket Home Assistant suspect (marque cloud)
  await V._test.upstream('tasmota'); await V._test.upstream('melcloud');
  const n0 = M.sent.length;
  tag = 'v1.1'; issues = [{ number: 99, title: 'MELCloud stopped working after update', html_url: 'https://gh/i/99', created_at: new Date().toISOString(), state: 'open' }];
  await V._test.upstream('tasmota'); await V._test.upstream('melcloud');
  assert.match(M.sent[n0][1], /Tasmota v1\.1/); assert.match(M.sent[n0 + 1][1], /MELCloud : signal/);
  // tableau de bord et rapport
  await V.api({ method: 'GET' }, {}, new URL('http://x/api/veille'));
  const t = out.brands.find(b => b.id === 'tasmota'); assert.strictEqual(t.ok, true); assert.strictEqual(t.up.tag, 'v1.1');
  assert.ok(out.events.some(e => e.type === 'change') && out.events.some(e => e.type === 'release'));
  assert.match(V.report('tasmota'), /server\/hub\/tasmota\.js/);
  // ticket GitHub : créé une fois, pas deux la même semaine ; le jeton n'est jamais renvoyé
  C.cfg.gh = { token: 'tok', repo: 'moi/maison', auto: false };
  const tk = await V._test.ticket('tasmota', 'change', 'champs disparus');
  assert.strictEqual(tk.n, 7); assert.match(ticketBody.title, /Tasmota : réponse différente/); assert.match(ticketBody.body, /server\/hub\/tasmota\.js/);
  ticketBody = null; await V._test.ticket('tasmota', 'change', 'x'); assert.strictEqual(ticketBody, null);
  await V.api({ method: 'GET' }, {}, new URL('http://x/api/veille')); assert.strictEqual(out.cfg.gh.token, '••••');
  gh.server.close(); delete process.env.VEILLE_GH;
});
