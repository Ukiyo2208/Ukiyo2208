// Côté site : reçoit les infos que le NAS envoie (PUBLICATION_URL) et les ressert à la page.
// Aucun port à ouvrir sur le NAS : c'est lui qui appelle le site.
//
//   JETON=le_PUBLICATION_JETON_du_NAS node recevoir-nas.mjs
//   puis dans .env du NAS :  PUBLICATION_URL=https://monsite.fr/api/nas  et  PUBLICATION_JETON=le même jeton
//
// À adapter à ton hébergement (Express, Next.js, PHP…) : le principe est le même, 2 routes.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const JETON = process.env.JETON || "";
const PORT = Number(process.env.PORT || 3000);
let dernier = null;

function jetonValide(entete) {
  const recu = Buffer.from(String(entete || "").replace(/^Bearer /, ""));
  const attendu = Buffer.from(JETON);
  return JETON !== "" && recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

createServer((req, res) => {
  if (req.url === "/api/nas" && req.method === "POST") {
    if (!jetonValide(req.headers.authorization)) return res.writeHead(401).end();
    let corps = "";
    req.on("data", (morceau) => { corps += morceau; if (corps.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { dernier = JSON.parse(corps); res.writeHead(204).end(); } catch { res.writeHead(400).end(); }
    });
    return;
  }
  if (req.url === "/api/nas" && req.method === "GET") {
    if (!dernier) return res.writeHead(404, { "Content-Type": "application/json" }).end('{"erreur":"pas encore reçu"}');
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(dernier));
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Infos du NAS : POST/GET http://localhost:${PORT}/api/nas`));
