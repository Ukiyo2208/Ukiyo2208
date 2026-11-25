// Commandes vocales : micro du navigateur (ou texte tapé) → /api/command → réponse lue à voix haute.
import { esc, icon, modal } from "./ui.js";
import { api } from "./state.js";

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

export function open() {
  const m = modal("Que veux-tu faire ?", `<form class="vc">
    <button type="button" class="vc-mic" ${Rec ? "" : "hidden"} title="Parler">${icon("mic")}</button>
    <p class="vc-heard meta">${Rec ? "Appuie sur le micro et parle, ou écris ta demande." : "Écris ta demande (la dictée n'est pas disponible dans ce navigateur : utilise le micro du clavier)."}</p>
    <div class="vc-row"><input type="text" name="text" placeholder="Ex. ajoute du lait à la liste de courses" autocomplete="off"><button class="btn">${icon("send")}</button></div>
    <div class="vc-answer" hidden></div>
    <div class="vc-ex"></div></form>`, { ic: "mic" });
  const f = m.querySelector("form"), heard = m.querySelector(".vc-heard"), answer = m.querySelector(".vc-answer"), mic = m.querySelector(".vc-mic");
  api("/api/command/examples").then(ex => {
    m.querySelector(".vc-ex").innerHTML = ex.slice(0, 6).map(e => `<button type="button" class="chip">${esc(e)}</button>`).join("");
  }).catch(() => {});
  m.querySelector(".vc-ex").onclick = e => { const b = e.target.closest(".chip"); if (b) { f.text.value = b.textContent; send(); } };
  async function send() {
    const text = f.text.value.trim();
    if (!text) return;
    answer.hidden = false;
    answer.innerHTML = `<span class="spinner"></span>`;
    try {
      const r = await api("/api/command", { json: { text } });
      answer.innerHTML = `<p>${esc(r.speech)}</p>${r.link ? `<a class="btn ghost small" href="${esc(r.link)}" data-close>${icon("right")}Ouvrir</a>` : ""}`;
      answer.className = `vc-answer ${r.action === "unknown" ? "unknown" : ""}`;
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(r.speech);
        u.lang = "fr-FR";
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
      if (r.action !== "unknown" && r.action !== "ask") f.text.value = "";
    } catch (err) { answer.innerHTML = `<p>${esc(err.message)}</p>`; }
  }
  f.onsubmit = e => { e.preventDefault(); send(); };
  if (!Rec) return f.text.focus();
  let rec = null;
  mic.onclick = () => {
    if (rec) return rec.stop();
    rec = new Rec();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    mic.classList.add("on");
    heard.textContent = "Je t'écoute…";
    rec.onresult = e => {
      const t = [...e.results].map(r => r[0].transcript).join(" ");
      f.text.value = t;
      heard.textContent = `« ${t} »`;
      if (e.results[e.results.length - 1].isFinal) { rec.stop(); send(); }
    };
    rec.onerror = e => { heard.textContent = e.error === "not-allowed" ? "Micro refusé : autorise-le dans le navigateur (il faut une adresse https://)." : "Je n'ai rien entendu, réessaie."; };
    rec.onend = () => { mic.classList.remove("on"); rec = null; };
    rec.start();
  };
  mic.click();
}
