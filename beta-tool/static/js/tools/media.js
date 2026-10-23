// Outil « Médiathèque » : vidéos et musique du NAS, avec un lecteur audio
// qui continue de jouer pendant qu'on utilise les autres outils.
import { $, esc, icon, toast, modal, sizeStr } from "../ui.js";
import { api, ago, enabled } from "../state.js";
import { pageHead } from "../main.js";

const enc = encodeURIComponent;
const raw = m => `/api/fs/raw?root=${enc(m.root)}&path=${enc(m.path)}`;
let lib = null, filter = "";
const P = { queue: [], index: -1, audio: null, shuffle: false, errors: 0 };

export async function render(root, parts, query) {
  const tab = parts[0] === "musique" ? "musique" : "videos";
  root.innerHTML = pageHead("medias", `<button class="btn ghost" id="md-refresh">${icon("refresh")}Actualiser</button>`) + `
    <nav class="tabs"><a href="#/medias" class="${tab === "videos" ? "on" : ""}">${icon("film")}Vidéos</a>
      <a href="#/medias/musique" class="${tab === "musique" ? "on" : ""}">${icon("music")}Musique</a></nav>
    <div class="row" style="margin-top:0"><input type="text" class="grow" id="md-q" placeholder="Rechercher…" value="${esc(filter)}"></div>
    <div id="md-body"><div class="loading"><span class="spinner"></span>Recherche de tes médias…</div></div>`;
  $("#md-refresh").onclick = async () => { lib = await api("/api/media/library?refresh=1"); draw(tab); toast("Médiathèque actualisée"); };
  $("#md-q").oninput = e => { filter = e.target.value.toLowerCase(); draw(tab); };
  lib ||= await api("/api/media/library");
  draw(tab);
  if (parts[0] === "video" && query.path) playVideo({ root: query.root, path: query.path, name: query.path.split("/").pop() });
}

function draw(tab) {
  const body = $("#md-body");
  if (!body) return;
  const match = m => !filter || `${m.name} ${m.folder} ${m.artist || ""}`.toLowerCase().includes(filter);
  if (tab === "videos") {
    const vids = lib.videos.filter(match);
    body.innerHTML = vids.length ? `<div class="vgrid">${vids.slice(0, 600).map((v, i) => `
      <button class="vcard" data-i="${i}">
        <span class="vthumb"><img loading="lazy" src="/api/fs/thumb?root=${enc(v.root)}&path=${enc(v.path)}&s=360" alt="" onerror="this.remove()">${icon("film")}<span class="play">${icon("play")}</span></span>
        <b title="${esc(v.name)}">${esc(v.name)}</b><small>${esc(v.folder)} · ${sizeStr(v.size)} · ${ago(v.mtime)}</small>
      </button>`).join("")}</div>`
      : `<div class="card"><div class="empty">${icon("film")}Aucune vidéo trouvée. Le Téléchargeur et les dossiers ajoutés (EXTRA_ROOTS) alimentent la médiathèque.</div></div>`;
    body.onclick = e => { const c = e.target.closest(".vcard"); if (c) playVideo(vids[+c.dataset.i]); };
    return;
  }
  const songs = lib.music.filter(match);
  body.innerHTML = songs.length ? `<div class="card">
      <div class="row" style="margin-top:0"><b class="grow">${songs.length} morceau${songs.length > 1 ? "x" : ""}</b>
        <button class="btn small" data-a="all">${icon("play")}Tout lire</button>
        <button class="btn small ghost" data-a="shuffle">${icon("shuffle")}Aléatoire</button></div>
      <div class="songs">${songs.slice(0, 2000).map((s, i) => `
        <button class="song ${P.queue[P.index]?.path === s.path ? "on" : ""}" data-i="${i}" data-path="${esc(s.path)}">
          <span class="num">${i + 1}</span><span class="t"><b>${esc(s.title)}</b><small>${esc(s.artist || "Artiste inconnu")}${s.album ? " · " + esc(s.album) : ""}</small></span>
          <span class="meta">${esc(s.ext.toUpperCase())}</span></button>`).join("")}</div></div>`
    : `<div class="card"><div class="empty">${icon("music")}Aucune musique trouvée. Astuce : le Téléchargeur en mode « Audio seul ».</div></div>`;
  body.onclick = e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "all") play(songs, 0, false);
    if (a === "shuffle") play(songs, Math.floor(Math.random() * songs.length), true);
    const s = e.target.closest(".song");
    if (s) play(songs, +s.dataset.i, P.shuffle);
  };
}

function playVideo(v) {
  P.audio?.pause();
  const m = modal(v.name, `<div class="pv pv-video"><video src="${raw(v)}" controls autoplay playsinline></video></div>
    <div id="vf" hidden class="intro" style="margin:12px 0 0"><span class="tile ambre">${icon("alert")}</span>
      <p>Ton navigateur ne sait pas lire ce format (souvent MKV ou AVI). Convertis-la en MP4 pour la regarder ici.</p>
      ${enabled("convertir") ? `<button class="btn small" id="vf-go">${icon("convert")}Convertir en MP4</button>` : ""}</div>
    <div class="modal-foot"><a class="btn ghost" href="${raw(v)}&dl=1">${icon("download")}Télécharger</a></div>`, { ic: "film", large: true });
  const video = m.querySelector("video");
  video.addEventListener("error", () => { m.querySelector("#vf").hidden = false; });
  // Certaines vidéos se chargent mais restent noires (codec non pris en charge) : on le détecte aussi
  video.addEventListener("loadedmetadata", () => { if (!video.videoWidth) m.querySelector("#vf").hidden = false; });
  m.querySelector("#vf-go")?.addEventListener("click", async () => {
    try { await api("/api/files/convert", { json: { root: v.root, path: v.path, target: "mp4", nas: true } }); toast("Conversion lancée : tu seras prévenu à la fin"); }
    catch (err) { toast(err.message, "err"); }
  });
  m.addEventListener("closed", () => video.pause());
}

// --- Lecteur audio persistant -------------------------------------------------

function play(queue, index, shuffle) {
  P.queue = queue.slice();
  P.shuffle = shuffle;
  P.index = index;
  if (!P.audio) {
    P.audio = new Audio();
    P.audio.addEventListener("ended", () => step(1));
    P.audio.addEventListener("timeupdate", progress);
    P.audio.addEventListener("play", paintBar);
    P.audio.addEventListener("pause", paintBar);
    P.audio.addEventListener("playing", () => { P.errors = 0; });
    P.audio.addEventListener("error", () => {
      toast("Impossible de lire ce morceau", "err");
      if (++P.errors < Math.min(P.queue.length, 5)) step(1);  // on n'enchaîne pas les erreurs à l'infini
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    }
  }
  load();
}

function load() {
  const s = P.queue[P.index];
  if (!s) return;
  P.audio.src = raw(s);
  P.audio.play().catch(() => {});
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: s.album,
    artwork: [{ src: "/brand/apple-touch-icon.png", sizes: "180x180" }] });
  document.querySelectorAll(".song").forEach(el => el.classList.toggle("on", el.dataset.path === s.path));
  paintBar();
}

function step(d) {
  if (!P.queue.length) return;
  P.index = P.shuffle && d > 0 ? Math.floor(Math.random() * P.queue.length) : (P.index + d + P.queue.length) % P.queue.length;
  load();
}

function paintBar() {
  let bar = $("#mini-player");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "mini-player";
    bar.className = "mini-player";
    document.body.append(bar);
    bar.addEventListener("click", e => {
      const a = e.target.closest("[data-p]")?.dataset.p;
      if (a === "toggle") P.audio.paused ? P.audio.play() : P.audio.pause();
      if (a === "next") step(1);
      if (a === "prev") step(-1);
      if (a === "shuffle") { P.shuffle = !P.shuffle; paintBar(); }
      if (a === "close") { P.audio.pause(); bar.remove(); document.body.classList.remove("has-player"); }
      const track = e.target.closest(".mp-track");
      if (track && P.audio.duration) { const r = track.getBoundingClientRect(); P.audio.currentTime = (e.clientX - r.left) / r.width * P.audio.duration; }
    });
  }
  document.body.classList.add("has-player");
  const s = P.queue[P.index] || {};
  bar.innerHTML = `<span class="tile vert">${icon("music")}</span>
    <span class="mp-t"><b>${esc(s.title || "")}</b><small>${esc(s.artist || "")}</small></span>
    <button class="icon-btn plain" data-p="prev" title="Précédent">${icon("prev")}</button>
    <button class="icon-btn mp-main" data-p="toggle" title="Lecture / pause">${icon(P.audio.paused ? "play" : "pause")}</button>
    <button class="icon-btn plain" data-p="next" title="Suivant">${icon("next")}</button>
    <button class="icon-btn plain ${P.shuffle ? "on" : ""}" data-p="shuffle" title="Aléatoire">${icon("shuffle")}</button>
    <span class="mp-track"><span class="mp-fill"></span></span>
    <button class="icon-btn plain" data-p="close" title="Fermer">${icon("x")}</button>`;
  progress();
}

function progress() {
  const fill = document.querySelector(".mp-fill");
  if (fill && P.audio.duration) fill.style.width = (P.audio.currentTime / P.audio.duration * 100) + "%";
}

export function leave() { /* la musique continue : le lecteur reste en bas de page */ }
