/* Bêta OS — démarrage */
(function () {
  const B = window.BOS;
  // préchargement des fonds pour des transitions sans flash
  ['lock', 'home', 'etage1', 'rdc', 'ext', 'generic'].forEach(n => { const i = new Image(); i.src = 'assets/bg/' + n + '.jpg'; });
  if (B.S.settings.skipLock) sessionStorage.setItem('betaos.unlocked', '1');
  B.show();
  B.loadWeather();
  setInterval(B.loadWeather, 15 * 60 * 1000);
  B.HA.sync();
  // simulation légère : l'événement « caméra cour » vieillit, la batterie du robot se recharge
  setInterval(() => {
    const st = B.camState('cam.cour');
    const ev = st.ev !== undefined ? st.ev : B.DATA.CAMS['cam.cour'].ev;
    if (ev && ev.ago < 59) { st.ev = Object.assign({}, ev, { ago: ev.ago + 1 }); B.emit('cam:cam.cour'); }
    const r = B.dev('rdc.robot');
    if (r.status === 'cleaning' && r.bat > 15) B.setDev('rdc.robot', { bat: r.bat - 1 }, { silent: true });
    else if (r.status === 'docked' && r.bat < 100) B.setDev('rdc.robot', { bat: r.bat + 1 }, { silent: true });
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { B.emit('clock'); B.HA.sync(); } });
})();
