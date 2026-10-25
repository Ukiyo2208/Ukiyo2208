// Siemens / Bosch / Neff — API officielle Home Connect (OAuth). Lecture de l'état des appareils :
// le départ à distance d'un programme exige d'activer « Démarrage à distance » sur la machine à chaque fois.
// Quota : 1 000 appels par jour, l'état est relu toutes les 3 minutes.
'use strict';
const { json } = require('./net');
const API = 'https://api.home-connect.com/api';
const H = async h => Object.assign({ Accept: 'application/vnd.bsh.sdk.v1+json' }, await h.auth());
const OP = { Inactive: 'Éteint', Ready: 'Prêt', DelayedStart: 'Départ différé', Run: 'En cours', Pause: 'En pause', ActionRequired: 'Action requise', Finished: 'Terminé', Error: 'Erreur', Aborting: 'Annulation' };

module.exports = {
  id: 'homeconnect', name: 'Home Connect (Siemens)', poll: 180000, secrets: ['clientSecret', 'tokens'],
  oauth: { auth: 'https://api.home-connect.com/security/oauth/authorize', token: 'https://api.home-connect.com/security/oauth/token', scope: 'IdentifyAppliance Monitor Settings' },
  async test(c, h) { const r = await json(API + '/homeappliances', { headers: await H(h) }); return r.data.homeappliances.length + ' appareil(s)'; },
  async devices(c, h) {
    const hd = await H(h), r = await json(API + '/homeappliances', { headers: hd }), out = [];
    for (const a of r.data.homeappliances) {
      const s = {};
      if (a.connected) try {
        const st = (await json(API + '/homeappliances/' + a.haId + '/status', { headers: hd })).data.status;
        const op = ((st.find(x => x.key === 'BSH.Common.Status.OperationState') || {}).value || '').split('.').pop();
        s.on = op === 'Run'; s.prog = OP[op] || op || '—';
        if (op === 'Run') try {
          const opt = (await json(API + '/homeappliances/' + a.haId + '/programs/active', { headers: hd })).data.options || [];
          const rem = (opt.find(x => x.key === 'BSH.Common.Option.RemainingProgramTime') || {}).value;
          if (rem) s.prog += ' · ' + Math.round(rem / 60) + ' min restantes';
        } catch (e) { }
      } catch (e) { } else { s.on = false; s.prog = 'Hors ligne'; }
      out.push({ id: a.haId, name: a.name || a.type, kind: 'app', info: a.brand + ' ' + a.type, state: s });
    }
    return out;
  },
  async command() { throw new Error('Home Connect : lecture seule dans Bêta home (lancez le programme depuis la machine)'); }
};
