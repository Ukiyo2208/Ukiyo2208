// Serveur Bêta 7.16 — « Tester toute la maison » : chaque étape de l'installation et chaque service vérifiés,
// avec ✅ / ⚠️ / ❌ et quoi faire. Comprend un contrôle de sécurité (clé, mode sécurisé, écrans, fichiers secrets).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');

module.exports = function diag(DATA, send, M) {
  const { HUB, AUTH, KEY, MODS, ENGINE } = M;
  const T = (ms, p) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error('pas de réponse en ' + ms / 1000 + ' s')), ms))]);
  const get = (url, ms) => new Promise(ok => { const r = http.get(url, { timeout: ms || 3000 }, res => { res.resume(); ok(res.statusCode); }); r.on('timeout', () => { r.destroy(); ok(0); }); r.on('error', () => ok(0)); });
  async function run() {
    const out = [], add = (cat, id, st, title, detail, fix) => out.push({ cat, id, st, title, detail: detail || '', fix: fix || '' });
    const mods = typeof MODS === 'function' ? MODS() : MODS;

    /* ---------- serveur ---------- */
    add('Serveur', 'node', +process.versions.node.split('.')[0] >= 20 ? 'ok' : 'err', 'Node.js ' + process.version, '', 'Utilisez l’image Docker de Bêta home (Node 22).');
    let writable = true; try { fs.writeFileSync(path.join(DATA, '.diag'), 'ok'); fs.unlinkSync(path.join(DATA, '.diag')); } catch (e) { writable = false; }
    add('Serveur', 'data', writable ? 'ok' : 'err', 'Dossier des données', DATA, 'Vérifiez le volume « ./data:/data » du docker-compose et ses droits.');
    let disk = null; try { const s = fs.statfsSync(DATA); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (e) { }
    if (disk) add('Serveur', 'disk', disk.free < 1e9 ? 'err' : disk.free < 5e9 ? 'warn' : 'ok', 'Place libre sur le NAS', Math.round(disk.free / 1e9) + ' Go libres', 'Faites de la place sur le NAS ou réduisez le nombre de sauvegardes gardées.');
    const off = Object.keys(mods).filter(k => !mods[k]);
    add('Serveur', 'mods', off.length ? 'warn' : 'ok', 'Modules du serveur', off.length ? 'Coupés ou en erreur : ' + off.join(', ') : 'Tous chargés', 'Regardez le journal des erreurs (Administration) ou la variable BETA_OFF.');
    const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    add('Serveur', 'tz', /Paris|Europe/.test(tz) ? 'ok' : 'warn', 'Fuseau horaire', tz, 'Ajoutez « TZ=Europe/Paris » dans le docker-compose (heures des règles, du réveil…).');

    /* ---------- sécurité ---------- */
    add('Sécurité', 'key', !KEY ? 'err' : /changez-moi/i.test(KEY) || KEY.length < 16 ? 'warn' : 'ok', 'Clé du serveur (BETA_KEY)', !KEY ? 'Aucune clé : n’importe quel appareil du réseau peut tout piloter' : /changez-moi/i.test(KEY) ? 'Clé d’exemple encore utilisée' : KEY.length < 16 ? 'Clé courte (' + KEY.length + ' caractères)' : 'Clé longue et personnelle', 'Mettez une longue phrase à vous dans BETA_KEY (docker-compose), puis associez les écrans par code (Paramètres › Sécurité).');
    let au = {}; try { au = JSON.parse(fs.readFileSync(path.join(DATA, 'auth.json'), 'utf8')); } catch (e) { }
    const admins = Object.values(au.users || {}).filter(u => u.admin), withPin = admins.filter(u => u.hash);
    add('Sécurité', 'pin', withPin.length ? 'ok' : 'warn', 'Code PIN des administrateurs', withPin.length + ' / ' + admins.length + ' administrateur(s) avec un code', 'Paramètres › Sécurité : donnez un code à chaque parent.');
    add('Sécurité', 'secure', AUTH.secure() ? 'ok' : 'warn', 'Mode sécurisé', AUTH.secure() ? 'Les réglages demandent le code d’un administrateur' : 'Les réglages sont modifiables depuis n’importe quel écran relié', 'Paramètres › Sécurité › Mode sécurisé (recommandé avec des enfants ou une tablette dans l’entrée).');
    const devs = Object.values(au.devices || {}), old = devs.filter(d => d.last && Date.now() - d.last > 60 * 864e5);
    add('Sécurité', 'screens', old.length ? 'warn' : 'ok', 'Écrans associés', devs.length + ' écran(s)' + (old.length ? ', dont ' + old.length + ' pas vu(s) depuis 2 mois' : ''), 'Paramètres › Sécurité : retirez les écrans que vous n’utilisez plus (tablette perdue, ancien téléphone).');
    const loose = ['hub.json', 'auth.json', 'notify.json', 'plus.json', 'extra.json', 'famille.json', 'engine.json'].filter(f => { try { return (fs.statSync(path.join(DATA, f)).mode & 0o077) !== 0; } catch (e) { return false; } });
    add('Sécurité', 'perms', loose.length ? 'warn' : 'ok', 'Fichiers des mots de passe', loose.length ? 'Lisibles par d’autres comptes du NAS : ' + loose.join(', ') : 'Protégés (lecture par le serveur seulement)', 'Ils seront corrigés au prochain enregistrement ; ou « chmod 600 data/*.json » sur le NAS.');
    const tsIp = Object.values(os.networkInterfaces()).flat().some(i => i && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address));
    add('Sécurité', 'remote', tsIp ? 'ok' : 'off', 'Accès depuis l’extérieur', tsIp ? 'Tailscale actif sur le NAS : accès chiffré sans ouvrir la box' : 'Pas de Tailscale détecté (normal si vous n’en avez pas besoin)', 'Pour utiliser Bêta hors de la maison, activez le bloc Tailscale du docker-compose. N’ouvrez jamais le port 8090 sur la box.');

    /* ---------- internet et services ---------- */
    let net = false; try { const r = await T(6000, fetch('https://1.1.1.1/cdn-cgi/trace')); net = r.ok; } catch (e) { }
    add('Internet', 'net', net ? 'ok' : 'err', 'Accès à internet depuis le NAS', net ? 'OK' : 'Le NAS ne joint pas internet', 'Vérifiez le réseau du NAS (DNS, passerelle) et le mode réseau « host » du conteneur.');
    const svc = async (id, title, url, fix) => { if (!net) return add('Internet', id, 'off', title, 'non testé (pas d’internet)'); try { const r = await T(8000, fetch(url)); add('Internet', id, r.status < 500 ? 'ok' : 'warn', title, 'joignable (HTTP ' + r.status + ')', fix); } catch (e) { add('Internet', id, 'warn', title, e.message, fix); } };
    await Promise.all([svc('meteo', 'Météo (Open-Meteo)', 'https://api.open-meteo.com/v1/forecast?latitude=48.49&longitude=7.68&current=temperature_2m', 'Arrosage, réveil et tableau du matin en dépendent.'), svc('tempo', 'EDF Tempo', 'https://www.api-couleur-tempo.fr/api/jourTempo/today', 'Le service peut être momentanément indisponible.')]);
    let nt = null; try { nt = JSON.parse(fs.readFileSync(path.join(DATA, 'notify.json'), 'utf8')); } catch (e) { }
    const topics = nt ? Object.values(nt.users || {}).filter(u => u.topic).length : 0;
    add('Notifications', 'ntfy', topics ? 'ok' : 'warn', 'Notifications sur les téléphones', topics ? topics + ' téléphone(s) abonné(s) à ntfy' : 'Aucun téléphone abonné', 'Paramètres › Notifs : installez l’app ntfy sur chaque iPhone et suivez les étapes.');
    if (nt && net && topics) { try { const r = await T(8000, fetch(String(nt.ntfy.url || 'https://ntfy.sh').replace(/\/+$/, '') + '/v1/health')); add('Notifications', 'ntfysrv', r.ok ? 'ok' : 'warn', 'Serveur ntfy', nt.ntfy.url || 'ntfy.sh', 'Vérifiez l’adresse du serveur ntfy.'); } catch (e) { add('Notifications', 'ntfysrv', 'warn', 'Serveur ntfy', e.message, 'Vérifiez l’adresse du serveur ntfy.'); } }

    /* ---------- marques ---------- */
    const conf = HUB.configured();
    if (!conf.length) add('Appareils', 'none', 'warn', 'Marques reliées', 'Aucune marque reliée en direct', 'Marques › Plug & play : Bêta cherche vos appareils sur le réseau.');
    await Promise.all(conf.map(async id => {
      const b = HUB.brand(id); if (!b || !b.test) return;
      try { const info = await T(12000, b.test(HUB.cfg(id), { save() { }, async auth() { return {}; } })); add('Appareils', 'b:' + id, 'ok', b.name, String(info || 'OK')); }
      catch (e) { add('Appareils', 'b:' + id, 'err', b.name, e.message, 'Marques › ' + b.name + ' : vérifiez l’adresse, le mot de passe ou relancez l’appairage.'); }
    }));
    if (conf.includes('fully')) { try { const s = (await T(8000, HUB.states('fully'))).s || {}; const ips = Object.keys(s); add('Tablettes', 'fully', ips.length ? 'ok' : 'warn', 'Tablettes Fully Kiosk', ips.length ? ips.length + ' tablette(s) répondent : ' + ips.join(', ') : 'Aucune tablette ne répond', 'Fully Kiosk › Remote Administration activée, même mot de passe que dans Marques › Fully Kiosk.'); } catch (e) { add('Tablettes', 'fully', 'err', 'Tablettes Fully Kiosk', e.message); } }
    else add('Tablettes', 'fully', 'off', 'Tablettes Fully Kiosk', 'Non reliées : annonces, réveil et sonnette ne passeront pas par les tablettes', 'Marques › Fully Kiosk : adresses IP des tablettes et mot de passe de l’administration à distance.');

    /* ---------- conteneurs voisins ---------- */
    const go = process.env.GO2RTC_URL || 'http://127.0.0.1:1984';
    const g = await get(go + '/api', 2500); add('Caméras', 'go2rtc', g ? 'ok' : 'warn', 'go2rtc (vidéo des caméras)', g ? 'en marche' : 'ne répond pas sur ' + go, 'Démarrez le service go2rtc du docker-compose.');
    let br = null; try { br = JSON.parse(fs.readFileSync(path.join(DATA, 'bridge.json'), 'utf8')); } catch (e) { }
    const st = br && br.status; add('Alexa et Maison', 'bridge', !st ? 'off' : Date.now() - (st.at || 0) > 120000 ? 'warn' : st.matterErr ? 'warn' : 'ok', 'Pont Matter / HomeKit', !st ? 'Non installé (facultatif)' : Date.now() - (st.at || 0) > 120000 ? 'Ne donne plus de nouvelles' : st.matterErr ? 'HomeKit OK, Matter : ' + st.matterErr : 'En marche', 'Service matter-bridge du docker-compose ; Matter a besoin de l’IPv6 sur le réseau du NAS.');

    /* ---------- moteur ---------- */
    if (ENGINE) { const s = ENGINE.status(); add('Maison', 'engine', 'ok', 'Cerveau du NAS', 'Alarme : ' + s.alarm.status + ' · ' + Object.keys(s.presence || {}).length + ' personne(s) suivie(s)'); }
    const sum = { ok: out.filter(x => x.st === 'ok').length, warn: out.filter(x => x.st === 'warn').length, err: out.filter(x => x.st === 'err').length };
    return { at: Date.now(), version: process.env.BETA_SHA || 'dev', host: os.hostname(), sum, checks: out };
  }
  let last = null, busy = null;
  async function api(req, res, url) {
    if (url.pathname === '/api/diag' && req.method === 'GET') {
      if (!busy) busy = run().then(r => { last = r; busy = null; return r; }, e => { busy = null; throw e; });
      try { return send(res, 200, url.searchParams.get('cached') && last ? last : await busy); } catch (e) { return send(res, 500, { error: e.message }); }
    }
    return false;
  }
  return { api };
};
