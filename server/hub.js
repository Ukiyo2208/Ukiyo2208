// Serveur Bêta — connexion directe aux marques, sans Home Assistant.
// Chaque marque a son connecteur dans server/hub/. Les identifiants restent sur le NAS (data/hub.json),
// le navigateur ne reçoit jamais les jetons.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { request } = require('./hub/net');

const BRANDS = {};
['tahoma', 'hue', 'elgato', 'govee', 'smartthings', 'homeconnect', 'shelly', 'esphome', 'sonos', 'cast', 'wled', 'nanoleaf', 'yeelight', 'wiz', 'tasmota', 'denon', 'fully', 'daikin', 'roku', 'z2m', 'kasa', 'tapo', 'lifx', 'broadlink', 'philipstv', 'samsungtv', 'lgtv', 'musicassistant', 'matter', 'frigate', 'reolink', 'unifiprotect', 'hikvision', 'dahua', 'freebox', 'livebox', 'bbox', 'linky', 'solaire', 'wallbox', 'easee', 'ocpp', 'cozytouch', 'netatmo', 'tado', 'sensibo', 'ecowitt', 'viessmann', 'tuya', 'dirigera', 'zwavejs', 'deconz', 'switchbot', 'mqttha', 'nuki', 'verisure', 'spotify', 'musiccast', 'bose', 'bravia', 'jellyfin', 'androidtv', 'husqvarna', 'valetudo'].forEach(n => { const m = require('./hub/' + n); BRANDS[m.id] = m; });

module.exports = function hub(DATA, send, readBody) {
  const FILE = path.join(DATA, 'hub.json');
  let CFG = {}; try { CFG = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(CFG, null, 1), { mode: 0o600 });
  const cfg = id => (CFG[id] = CFG[id] || {});
  const update = (id, patch) => { Object.assign(cfg(id), patch); persist(); };
  const pending = {};           // états OAuth en attente : state → { brand, redirect, at }
  const cache = {};             // états des appareils par marque : { at, data, busy }
  // connecteurs qui écoutent en continu (flux d'évènements des caméras, bornes OCPP) : démarrés dès le lancement
  setTimeout(() => Object.keys(BRANDS).forEach(id => { if (BRANDS[id].init && CFG[id]) try { BRANDS[id].init(CFG[id], helper(BRANDS[id])); } catch (e) { console.warn(id + ' : ' + e.message); } }), 1000);

  /* ---------- OAuth (SmartThings, Home Connect) ---------- */
  async function oauthToken(b, form) {
    const c = cfg(b.id), o = b.oauth, headers = {};
    if (o.basic) headers.Authorization = 'Basic ' + Buffer.from(c.clientId + ':' + c.clientSecret).toString('base64');
    else { form.client_id = c.clientId; if (c.clientSecret) form.client_secret = c.clientSecret; }   // PKCE (Viessmann) : pas de secret
    const r = (await request(o.token, { form, headers })).json();
    if (!r || !r.access_token) throw new Error('jeton refusé');
    update(b.id, { tokens: { access: r.access_token, refresh: r.refresh_token || (c.tokens && c.tokens.refresh), exp: Date.now() + (r.expires_in || 3600) * 1000 } });
  }
  const helper = b => ({
    save(patch) { update(b.id, patch || {}); },   // jetons renouvelés par le connecteur (Tado, Linky…)
    async auth() {
      const c = cfg(b.id);
      if (!c.tokens || !c.tokens.access) throw new Error('compte non relié : utilisez « Se connecter »');
      if (Date.now() > c.tokens.exp - 120000) await oauthToken(b, { grant_type: 'refresh_token', refresh_token: c.tokens.refresh });
      return { Authorization: 'Bearer ' + cfg(b.id).tokens.access };
    }
  });

  /* ---------- vue publique de la configuration (secrets masqués) ---------- */
  function view(b) {
    const c = cfg(b.id), out = {};
    for (const k in c) if (!['status', 'info', 'tokens'].includes(k)) out[k] = (b.secrets || []).includes(k) && c[k] ? '••••' : c[k];
    return { id: b.id, name: b.name, oauth: !!b.oauth, linked: b.oauth ? !!(c.tokens && c.tokens.access) : undefined, status: c.status || '', info: c.info || '', cfg: out };
  }
  // états relus au rythme de chaque marque (quotas) ; on répond tout de suite avec la dernière lecture
  async function states(id) {
    const b = BRANDS[id], c = cache[id] = cache[id] || { at: 0, data: {}, err: '' };
    if (Date.now() - c.at >= b.poll && !c.busy) c.busy = b.devices(cfg(id), helper(b)).then(list => { c.data = {}; list.forEach(d => { c.data[d.id] = d.state; }); c.err = ''; }, e => { c.err = e.message; }).then(() => { c.at = Date.now(); c.busy = null; });
    if (!c.at && c.busy) await c.busy;
    return { s: c.data, err: c.err };
  }

  // retour de la page de connexion de la marque (ouverte dans le navigateur, sans la clé Bêta)
  async function callback(req, res, url) {
    const st = pending[url.searchParams.get('state') || ''], page = (t, ok) => send(res, ok ? 200 : 400, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;background:#050c20;color:#fff;display:grid;place-items:center;height:90vh;text-align:center"><div><h2>' + (ok ? '✅ ' : '⚠️ ') + String(t).replace(/[<>&"]/g, '') + '</h2><p>Vous pouvez fermer cette page et revenir dans Bêta home.</p></div>', 'text/html; charset=utf-8');
    if (!st || Date.now() - st.at > 15 * 6e4) return page('Lien expiré, recommencez depuis Bêta home', false);
    delete pending[url.searchParams.get('state')];
    if (url.searchParams.get('error')) return page('Connexion refusée : ' + url.searchParams.get('error'), false);
    try { await oauthToken(BRANDS[st.brand], Object.assign({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: st.redirect }, st.verifier ? { code_verifier: st.verifier } : {})); update(st.brand, { status: 'ok', info: 'Compte relié' }); return page(BRANDS[st.brand].name + ' est relié', true); }
    catch (e) { return page('Échec : ' + e.message, false); }
  }

  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    let r;
    if (p === '/api/hub' && m === 'GET') return send(res, 200, Object.values(BRANDS).map(view));
    if (p === '/api/hub/states' && m === 'GET') {
      const want = (url.searchParams.get('brands') || '').split(',').filter(id => BRANDS[id]), out = {};
      await Promise.all(want.map(async id => { out[id] = await states(id); }));
      return send(res, 200, out);
    }
    if (p === '/api/hub/command' && m === 'POST') {
      const b = await readBody(req), br = BRANDS[b && b.brand]; if (!br) return send(res, 400, { error: 'marque inconnue' });
      await br.command(cfg(br.id), b.id, b.patch || {}, b.cur || {}, helper(br));
      if (cache[br.id]) cache[br.id].at = Math.min(cache[br.id].at, Date.now() - br.poll + 1500);  // relecture rapide après une commande
      return send(res, 200, { ok: true });
    }
    if (!(r = p.match(/^\/api\/hub\/(\w+)(?:\/(\w+)(?:\/(\w+))?)?$/)) || !BRANDS[r[1]]) return send(res, 404, { error: 'marque inconnue' });
    const b = BRANDS[r[1]], c = cfg(b.id), what = r[2] || '';
    if (!what && m === 'PUT') { const body = await readBody(req) || {}; for (const k in body) if (body[k] !== '••••' && !['tokens', 'status', 'info'].includes(k)) c[k] = typeof body[k] === 'string' ? body[k].trim() : body[k]; persist(); return send(res, 200, view(b)); }
    if (!what && m === 'DELETE') { CFG[b.id] = {}; delete cache[b.id]; persist(); return send(res, 200, view(b)); }
    if (what === 'test' && m === 'POST') {
      try { const info = await b.test(c, helper(b)); update(b.id, { status: 'ok', info }); } catch (e) { update(b.id, { status: 'err', info: e.message }); }
      return send(res, 200, view(b));
    }
    if (what === 'devices' && m === 'GET') { const list = await b.devices(c, helper(b)); return send(res, 200, list); }
    if (what === 'action' && m === 'POST' && b.actions && b.actions[r[3]]) { const patch = await b.actions[r[3]](c, await readBody(req) || {}); update(b.id, patch || {}); return send(res, 200, view(b)); }
    if (what === 'oauth' && m === 'GET' && b.oauth) {
      if (!c.clientId || (!c.clientSecret && !b.oauth.pkce)) return send(res, 400, { error: 'Client ID et secret à renseigner d’abord' });
      const redirect = url.searchParams.get('redirect') || '', state = crypto.randomBytes(16).toString('hex');
      if (!/^https?:\/\/.+\/api\/hub\/oauth\/callback$/.test(redirect)) return send(res, 400, { error: 'adresse de retour invalide' });
      const verifier = b.oauth.pkce ? crypto.randomBytes(48).toString('base64url') : '';
      pending[state] = { brand: b.id, redirect, at: Date.now(), verifier };
      const q = { client_id: c.clientId, response_type: 'code', redirect_uri: redirect, scope: b.oauth.scope, state };
      if (verifier) Object.assign(q, { code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return send(res, 200, { url: b.oauth.auth + '?' + new URLSearchParams(Object.assign(q, b.oauth.extra || {})) });
    }
    return send(res, 404, { error: 'route inconnue' });
  }

  // pour les autres modules du serveur (notifications 24 h/24, pont Alexa)
  async function command(brand, id, patch, cur) { const b = BRANDS[brand]; if (!b) throw new Error('marque inconnue'); await b.command(cfg(brand), id, patch || {}, cur || {}, helper(b)); if (cache[brand]) cache[brand].at = 0; }
  const configured = () => Object.keys(BRANDS).filter(id => CFG[id] && Object.keys(CFG[id]).some(k => !['status', 'info'].includes(k)));
  return { callback, api, states, command, configured, cfg: id => cfg(id) };
};
