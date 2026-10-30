// Linky (Enedis) — consommation électrique via le service gratuit conso.boris.sh (jeton lié à votre compteur).
// Données de la veille (Enedis les publie le lendemain) : consommation du jour et courbe de puissance par 30 min.
'use strict';
const { json } = require('./net');
const API = 'https://conso.boris.sh/api/';
const d = t => new Date(t).toISOString().slice(0, 10);
const get = (c, path, start, end) => json(API + path + '?prm=' + encodeURIComponent(c.prm) + '&start=' + start + '&end=' + end, { headers: { Authorization: 'Bearer ' + c.token, 'User-Agent': 'beta-home' }, timeout: 20000 });
module.exports = {
  id: 'linky', name: 'Linky', poll: 3600e3, secrets: ['token'],
  async test(c) { if (!c.token || !c.prm) throw new Error('jeton et numéro de compteur (PRM) requis'); const r = await get(c, 'daily_consumption', d(Date.now() - 3 * 864e5), d(Date.now())); return (r.interval_reading || []).length + ' jour(s) lu(s) · compteur ' + c.prm; },
  async devices(c) {
    if (!c.token || !c.prm) return [];
    const [day, curve] = await Promise.all([get(c, 'daily_consumption', d(Date.now() - 8 * 864e5), d(Date.now())), get(c, 'consumption_load_curve', d(Date.now() - 864e5), d(Date.now())).catch(() => ({}))]);
    const days = day.interval_reading || [], last = days[days.length - 1], pts = curve.interval_reading || [], p = pts[pts.length - 1];
    const week = days.slice(-7).reduce((a, x) => a + (+x.value || 0), 0);
    return [
      { id: 'jour', name: 'Linky — hier', kind: 'meter', info: last ? 'Journée du ' + last.date : 'Pas encore de données', state: { val: last ? Math.round(+last.value / 100) / 10 : 0, unit: 'kWh', week: Math.round(week / 1000) } },
      { id: 'puissance', name: 'Linky — puissance', kind: 'meter', info: p ? 'Dernière demi-heure connue : ' + p.date : 'Courbe de charge non activée', state: { val: p ? Math.round(+p.value) : 0, unit: 'W' } }
    ];
  },
  async command() { }
};
