/* Pont Bêta home → Bêta IA, ajouté par Bêta à la page de Bêta home (http://IP_DU_NAS:8800/home/).
   L'assistant de Bêta home répond tout de suite à ce qu'il sait faire. Ce qu'il ne comprend pas part à
   Bêta IA (Home Assistant, puis l'IA de discussion), et la réponse arrive dans la conversation. */
(function () {
  const B = window.BOS;
  if (!B || !(B.iaX || B.ia)) return;
  const INCOMPRIS = /^Je n[’']ai pas compris/;
  const ATTENTE = "Je demande à Bêta IA…";

  function jeton() {
    try { return localStorage.getItem("beta_jeton") || sessionStorage.getItem("beta_jeton") || ""; } catch (e) { return ""; }
  }

  async function demander(texte) {
    const entetes = { "Content-Type": "application/json" };
    if (jeton()) entetes.Authorization = "Bearer " + jeton();
    const r = await fetch("/v1/texte", { method: "POST", headers: entetes, body: JSON.stringify({ texte }) });
    if (r.status === 401) return "Hors de la maison, Bêta IA demande ton jeton : connecte-toi une fois sur la page d'accueil de Bêta.";
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.json()).reponse || "Bêta IA n'a pas de réponse.";
  }

  function remplacer(nouveau) {
    const chat = (B.S && B.S.chat) || [];
    for (let i = chat.length - 1; i >= 0; i--) {
      if (!chat[i].me && chat[i].t === ATTENTE) { chat[i].t = nouveau; break; }
    }
    if (B.save) B.save();
    if (B.emit) B.emit("chat");
    if (B.toast) B.toast(nouveau, "ai");
    if (B.speak && document.querySelector(".vst")) B.speak(nouveau); // mode vocal ouvert : réponse lue
  }

  const precedent = B.iaX || B.ia;
  B.iaX = function (texte) {
    const r = precedent(texte);
    if (!INCOMPRIS.test(r || "")) return r;
    demander(texte).then(remplacer, () => remplacer("Bêta IA ne répond pas pour l'instant."));
    return ATTENTE;
  };
  B.betaIA = true;
})();
