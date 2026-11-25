// Script des pages : repère les fiches produit (prix), ajoute le bouton « Sur le NAS » des vidéos,
// et répond à l'extension (colis repérés, contenu de la page, téléchargement avec la session du site).
(() => {
  if (window.__betaTool) return;
  window.__betaTool = true;
  const send = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const eur = n => n == null ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // --- Fiche produit ---------------------------------------------------------------------------------
  function isProduct() {
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].some(s => /"@type"\s*:\s*\[?\s*"(Product|ProductGroup|IndividualProduct)"/.test(s.textContent));
    const og = document.querySelector('meta[property="og:type"]')?.content === "product" || !!document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
    const amazon = /amazon\./.test(location.hostname) && /\/(dp|gp\/product)\//.test(location.pathname) && !!document.getElementById("productTitle");
    const micro = !!document.querySelector('[itemtype*="schema.org/Product"] [itemprop="price"]');
    return ld || og || amazon || micro;
  }

  // Extrait léger de la page (balises utiles seulement) : le NAS le lit comme une page complète
  function digest() {
    const parts = [`<title>${esc(document.title)}</title>`];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => parts.push(s.outerHTML.slice(0, 200000)));
    document.querySelectorAll('meta[property^="og:"], meta[property^="product:"], meta[itemprop]').forEach(m => parts.push(m.outerHTML));
    document.querySelectorAll('[itemprop="price"], [itemprop="priceCurrency"]').forEach(e =>
      parts.push(`<meta itemprop="${e.getAttribute("itemprop")}" content="${esc((e.getAttribute("content") || e.textContent || "").trim())}">`));
    if (/amazon\./.test(location.hostname)) {
      ["productTitle", "corePriceDisplay_desktop_feature_div", "corePrice_feature_div", "apex_desktop", "outOfStock"].forEach(id => {
        const el = document.getElementById(id);
        if (el) parts.push(el.outerHTML.slice(0, 30000));
      });
      const img = document.getElementById("landingImage");
      if (img) parts.push(`<img id="landingImage" src="${esc(img.dataset.oldHires || img.src)}">`);
      const asin = document.querySelector('input[name="ASIN"]');
      if (asin) parts.push(`<input name="ASIN" value="${esc(asin.value)}">`);
    }
    return parts.join("\n");
  }

  let pill = null;
  function showPill(p) {
    if (!p) return;
    const cur = p.offers.find(o => o.current) || p.offers[0];
    const cheaper = p.offers.filter(o => !o.current && o.price && cur?.price && o.price < cur.price - 0.01 && o.available !== false).sort((a, b) => a.price - b.price)[0];
    const v = cur?.verdict;
    if (!cheaper && !p.followed && (!v || v.level === "info")) return;  // rien d'intéressant à dire
    pill?.remove();
    pill = document.createElement("div");
    const root = pill.attachShadow({ mode: "closed" });
    const color = cheaper ? "#0e9f6e" : v?.level === "ok" ? "#0e9f6e" : v?.level === "bad" ? "#e02424" : "#2563eb";
    root.innerHTML = `<style>
      .b{position:fixed;right:16px;bottom:16px;z-index:2147483646;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#111;border-radius:14px;
         box-shadow:0 8px 30px rgba(0,0,0,.18);border:1px solid #e5e7eb;max-width:320px;overflow:hidden}
      .h{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;cursor:pointer}
      .h img{width:18px;height:18px;border-radius:5px}.t{flex:1;font-weight:600}.dot{width:8px;height:8px;border-radius:50%;background:${color}}
      .x{border:0;background:none;font-size:16px;cursor:pointer;color:#6b7280;padding:0 4px}
      .c{padding:0 12px 10px;display:none}.open .c{display:block}.r{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
      .r a{color:#111;text-decoration:none}.r a:hover{text-decoration:underline}.m{color:#6b7280;font-size:12px}
      .btns{display:flex;gap:6px;margin-top:8px}.btn{flex:1;border:1px solid #d1d5db;background:#f9fafb;border-radius:9px;padding:6px;cursor:pointer;font:inherit}
      .btn.p{background:#2563eb;color:#fff;border-color:#2563eb}
      @media (prefers-color-scheme: dark){.b{background:#1f2937;color:#f3f4f6;border-color:#374151}.r a{color:#f3f4f6}.btn{background:#111827;color:#f3f4f6;border-color:#4b5563}}
    </style>
    <div class="b"><div class="h"><img src="${chrome.runtime.getURL("icons/icon32.png")}" alt=""><span class="dot"></span>
      <span class="t">${cheaper ? `${eur(cheaper.price)} chez ${esc(cheaper.shop)}` : esc(v?.text || "Produit suivi")}</span><button class="x" title="Fermer">×</button></div>
      <div class="c">${v ? `<div class="m">${esc(v.text)}</div>` : ""}
        ${p.offers.slice(0, 6).map(o => `<div class="r"><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.shop)}${o.current ? " (ici)" : ""}</a><b>${eur(o.price)}</b></div>`).join("")}
        <div class="btns"><button class="btn ${p.followed ? "" : "p"}" data-a="follow">${p.followed ? "Suivi ✓" : "Suivre le prix"}</button><button class="btn" data-a="compare">Comparer</button></div></div></div>`;
    root.querySelector(".h").onclick = e => { if (!e.target.closest(".x")) root.querySelector(".b").classList.toggle("open"); };
    root.querySelector(".x").onclick = () => pill.remove();
    root.querySelector('[data-a="follow"]').onclick = async e => {
      const r = await send({ type: "follow", pid: p.id, followed: !p.followed });
      if (r?.product) showPill(r.product); else e.target.textContent = "Erreur";
    };
    root.querySelector('[data-a="compare"]').onclick = async e => {
      e.target.textContent = "Recherche…"; e.target.disabled = true;
      const r = await send({ type: "compare", pid: p.id });
      if (r?.product) showPill(r.product); else e.target.textContent = r?.error || "Rien trouvé";
    };
    document.documentElement.appendChild(pill);
  }

  async function checkProduct() {
    if (!isProduct()) return;
    const r = await send({ type: "product", url: location.href, html: digest() });
    if (r?.product && r.pill) showPill(r.product);
  }

  // --- Vidéo (YouTube) -------------------------------------------------------------------------------
  let vbtn = null;
  async function videoButton() {
    const on = /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === "/watch";
    if (!on) { vbtn?.remove(); vbtn = null; return; }
    if (vbtn) return;
    const opts = await send({ type: "opts" });
    if (!opts?.video) return;
    vbtn = document.createElement("div");
    const root = vbtn.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>button{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:7px;border:0;border-radius:99px;
      padding:9px 14px;background:#111;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:.85}
      button:hover{opacity:1}img{width:16px;height:16px;border-radius:4px}</style>
      <button title="Télécharger cette vidéo sur le NAS (meilleure qualité)"><img src="${chrome.runtime.getURL("icons/icon32.png")}" alt="">Sur le NAS</button>`;
    const b = root.querySelector("button");
    b.onclick = async () => {
      b.textContent = "Envoi…";
      const r = await send({ type: "video", url: location.href });
      b.textContent = r?.ok ? "✓ Téléchargement lancé" : (r?.error || "Erreur");
      setTimeout(() => { vbtn?.remove(); vbtn = null; videoButton(); }, 4000);
    };
    document.documentElement.appendChild(vbtn);
  }

  // --- Demandes de l'extension ---------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "scan-parcels") {
      const text = document.body?.innerText || "";
      const found = new Map();
      for (const [carrier, pat] of msg.patterns) for (const m of text.matchAll(new RegExp(pat, "g"))) found.set(m[0], carrier);
      if (msg.context) for (const m of text.matchAll(new RegExp(msg.context, "gi"))) if (!found.has(m[1].toUpperCase())) found.set(m[1].toUpperCase(), "");
      reply([...found].slice(0, 10).map(([number, carrier]) => ({ number, carrier })));
    } else if (msg.type === "page") {
      reply({ html: msg.full ? document.documentElement.outerHTML.slice(0, 5_000_000) : digest(), title: document.title, url: location.href,
              selection: String(getSelection() || "").slice(0, 20000), text: msg.text ? (document.body?.innerText || "").slice(0, 100000) : undefined, product: isProduct() });
    } else if (msg.type === "fetch") {  // téléchargement avec la session du site (même origine)
      fetch(msg.url, { credentials: "include" }).then(async r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        const blob = await r.blob();
        const fr = new FileReader();
        fr.onload = () => reply({ data: fr.result, type: blob.type, disposition: r.headers.get("content-disposition") || "" });
        fr.readAsDataURL(blob);
      }).catch(e => reply({ error: e.message }));
      return true;
    } else if (msg.type === "show-pill") {
      showPill(msg.product);
    }
  });

  setTimeout(checkProduct, 1200);
  videoButton();
  let last = location.href;  // sites « une seule page » (YouTube, Amazon…) : l'adresse change sans rechargement
  setInterval(() => { if (location.href !== last) { last = location.href; pill?.remove(); pill = null; setTimeout(checkProduct, 1500); videoButton(); } }, 1000);
})();
