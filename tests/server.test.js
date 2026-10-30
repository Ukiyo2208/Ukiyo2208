// Serveur complet (processus séparé) : fichiers compressés et regroupés, chemins interdits, clé, limitation des essais, diagnostic
'use strict';
const test = require('node:test'), assert = require('node:assert'), { spawn } = require('child_process'), path = require('path'), zlib = require('zlib'), http = require('http');
const { tmp } = require('./helpers');
const PORT = 18000 + Math.floor(Math.random() * 900), U = 'http://127.0.0.1:' + PORT;
let proc;
const req = (p, h) => new Promise((ok, ko) => http.get(U + p, { headers: h || {} }, r => { const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(ch) })); }).on('error', ko));
test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: tmp('srv'), BETA_KEY: 'une-longue-cle-de-test-1234', GO2RTC_URL: 'http://127.0.0.1:9' }), stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await req('/api/ping', { 'X-Beta-Key': 'une-longue-cle-de-test-1234' }); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
});
test.after(() => proc && proc.kill());

test('page d’accueil : un seul script regroupé, compressé', async () => {
  const r = await req('/', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(r.headers['content-encoding'], 'gzip');
  const html = zlib.gunzipSync(r.body).toString();
  assert.strictEqual((html.match(/<script/g) || []).length, 1); assert.match(html, /bundle\.js\?v=/);
  const b = await req('/bundle.js?v=1', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(b.status, 200); assert.match(b.headers['cache-control'], /immutable/);
  const js = zlib.gunzipSync(b.body).toString(); assert.match(js, /js\/core\.js/); assert.match(js, /js\/app\.js/);
});
test('ETag : un fichier inchangé n’est pas renvoyé', async () => {
  const a = await req('/css/beta.css'); const b = await req('/css/beta.css', { 'If-None-Match': a.headers.etag });
  assert.strictEqual(b.status, 304);
});
test('chemins interdits : .git, archives, sources du serveur', async () => {
  for (const p of ['/.git/config', '/livrable/x.zip', '/server/server.js', '/tests/helpers.js']) assert.strictEqual((await req(p)).status, 403, p);
  assert.notStrictEqual((await req('/%2e%2e/%2e%2e/etc/passwd')).status, 200);
});
test('API : clé exigée', async () => {
  assert.strictEqual((await req('/api/hub')).status, 401);
  assert.strictEqual((await req('/api/hub', { 'X-Beta-Key': 'une-longue-cle-de-test-1234' })).status, 200);
});
test('diagnostic : les étapes sont vérifiées', async () => {
  const r = JSON.parse((await req('/api/diag', { 'X-Beta-Key': 'une-longue-cle-de-test-1234' })).body);
  assert.ok(r.checks.find(c => c.id === 'key').st === 'ok'); assert.ok(r.checks.find(c => c.id === 'data').st === 'ok');
});
test('trop d’essais refusés : blocage', async () => {
  for (let i = 0; i < 31; i++) await req('/api/hub', { 'X-Beta-Key': 'faux' });
  assert.strictEqual((await req('/api/hub', { 'X-Beta-Key': 'faux' })).status, 429);
});
