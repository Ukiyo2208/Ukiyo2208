// Accueil du Studio PDF et aiguillage vers chaque outil.
import { icon, esc } from "../ui.js";
import * as editor from "./editor.js";
import * as organize from "./organize.js";
import * as merge from "./merge.js";
import * as split from "./split.js";
import * as stamp from "./stamp.js";
import * as server from "./server.js";

export const TOOLS = {
  editer: { title: "Éditer & signer", icon: "edit", desc: "Texte, signature, images, surlignage, dessin, formulaires.", run: (c, t) => editor.render(c, t) },
  formulaire: { title: "Remplir un formulaire", icon: "form", desc: "Complète les champs d'un PDF interactif.", run: (c, t) => editor.render(c, t)},
  filigrane: { title: "Filigrane", icon: "droplet", desc: "Un texte en transparence sur chaque page.", run: (c, t) => stamp.render(c, t, "watermark") },
  numeroter: { title: "Numéroter les pages", icon: "hash", desc: "Ajoute « Page 1 sur 12 » automatiquement.", run: (c, t) => stamp.render(c, t, "numbers") },
  organiser: { title: "Organiser les pages", icon: "layers", desc: "Réordonner, pivoter, supprimer, insérer.", run: (c, t) => organize.render(c, t) },
  fusionner: { title: "Fusionner", icon: "merge", desc: "Assembler plusieurs PDF en un seul.", run: (c, t) => merge.render(c, t) },
  decouper: { title: "Découper / extraire", icon: "scissors", desc: "Séparer un PDF ou extraire des pages.", run: (c, t) => split.render(c, t) },
  compresser: { title: "Compresser", icon: "compress", desc: "Réduire le poids du fichier.", run: (c, t) => server.render(c, t, "compress") },
  proteger: { title: "Protéger", icon: "lock", desc: "Mot de passe et autorisations.", run: (c, t) => server.render(c, t, "protect") },
  deverrouiller: { title: "Déverrouiller", icon: "unlock", desc: "Retirer un mot de passe connu.", run: (c, t) => server.render(c, t, "unlock") },
  ocr: { title: "OCR", icon: "scan", desc: "Rendre un scan cherchable et copiable.", run: (c, t) => server.render(c, t, "ocr") },
};

const SECTIONS = [
  ["Modifier", ["editer", "formulaire", "filigrane", "numeroter"]],
  ["Organiser", ["organiser", "fusionner", "decouper"]],
  ["Optimiser & sécuriser", ["compresser", "proteger", "deverrouiller", "ocr"]],
];

export function showHub(container) {
  if (container.dataset.ready) return;
  container.dataset.ready = "1";
  container.innerHTML = SECTIONS.map(([label, keys]) => `
    <div class="pdf-section">${esc(label)}</div>
    <div class="pdf-grid">${keys.map(k => `
      <a class="card tool" href="#/pdf/${k}">
        <span class="tile rose">${icon(TOOLS[k].icon)}</span>
        <h2>${esc(TOOLS[k].title)}</h2><p>${esc(TOOLS[k].desc)}</p>
      </a>`).join("")}
    </div>`).join("") + `
    <div class="pdf-section">Convertir</div>
    <div class="pdf-grid">
      <a class="card tool" href="#/convertir"><span class="tile violet">${icon("image")}</span><h2>PDF → images / texte</h2><p>Une image PNG/JPG par page, ou le texte brut.</p></a>
      <a class="card tool" href="#/convertir"><span class="tile violet">${icon("convert")}</span><h2>Word, images → PDF</h2><p>Word, Excel, PowerPoint, photos… vers PDF.</p></a>
    </div>`;
}

export function showTool(name, container) {
  const tool = TOOLS[name];
  if (!tool) { location.hash = "#/pdf"; return; }
  tool.run(container, tool);
}

export function head(name) {
  return TOOLS[name];
}
