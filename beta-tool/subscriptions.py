"""Outil « Abonnements » : suit des chaînes YouTube, playlists, podcasts (flux RSS)
ou chaînes d'autres sites. À chaque nouvelle vidéo : notification sur l'appli
(avec la miniature) et, si on le souhaite, téléchargement automatique sur le NAS."""

import hashlib
import re
import threading
import time
import uuid

import yt_dlp
from flask import Blueprint, g, jsonify, request

import activity
import downloader
import store

bp = Blueprint("subscriptions", __name__)
INTERVALS = (1, 3, 6, 12, 24)
FEED_SIZE = 40  # éléments gardés par chaîne
_check_lock = threading.Lock()
YT_CHANNEL = re.compile(r"^https?://(www\.|m\.)?youtube\.com/(@[^/?#]+|channel/[^/?#]+|c/[^/?#]+|user/[^/?#]+)/?(\?.*)?$", re.I)


def load():
    return store.load("subscriptions", {"subs": {}})


def save_sub(sub):
    store.update("subscriptions", {"subs": {}}, lambda d: d["subs"].__setitem__(sub["id"], sub))


def own(sub_id):
    sub = load()["subs"].get(sub_id)
    if not sub or (sub["owner"] != g.user["name"] and g.user["role"] != "admin"):
        raise ValueError("Abonnement introuvable")
    return sub


def normalize(url):
    url = url.strip()
    m = YT_CHANNEL.match(url)
    if m:  # page d'une chaîne YouTube → son onglet « Vidéos »
        return re.sub(r"/?(\?.*)?$", "", url) + "/videos"
    return url


def thumb_of(entry):
    vid = entry.get("id") or ""
    if "youtube" in (entry.get("ie_key") or entry.get("extractor_key") or "").lower():
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    thumbs = [t for t in entry.get("thumbnails") or [] if t.get("url")]
    return (thumbs[-1]["url"] if thumbs else entry.get("thumbnail")) or None


def avatar_of(info):
    thumbs = [t for t in info.get("thumbnails") or [] if t.get("url")]
    for t in thumbs:
        if t.get("id") in ("avatar_uncropped", "avatar"):
            return t["url"]
    square = [t for t in thumbs if t.get("width") and t.get("width") == t.get("height")]
    return (square[-1] if square else thumbs[0])["url"] if thumbs else None


def fetch(url, limit=15):
    """Dernières entrées d'une chaîne / playlist / flux, sans rien télécharger."""
    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": limit,
            "skip_download": True, "ignoreerrors": True, "socket_timeout": 30}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise ValueError("Impossible de lire ce lien : vérifie qu'il s'agit d'une chaîne, d'une playlist ou d'un flux")
    entries = [e for e in (info.get("entries") or [info]) if e and (e.get("id") or e.get("url"))][:limit]
    items = []
    for e in entries:
        raw = str(e.get("id") or e["url"])
        e["id"] = raw if re.fullmatch(r"[\w-]{1,40}", raw) else hashlib.sha1(raw.encode()).hexdigest()[:16]
        link = e.get("webpage_url") or e.get("url") or ""
        if not link.startswith("http"):
            link = f"https://www.youtube.com/watch?v={e['id']}" if re.match(r"^[\w-]{11}$", e["id"]) else link
        items.append({"id": e["id"], "title": e.get("title") or link, "url": link, "link": link.split("#__youtubedl")[0], "thumb": thumb_of(e),
                      "duration": e.get("duration"), "published": e.get("timestamp") or e.get("release_timestamp"),
                      "live": e.get("live_status") in ("is_upcoming", "is_live")})
    title = info.get("channel") or info.get("uploader") or info.get("title") or url
    title = re.sub(r"\s+-\s+(Videos|Vidéos)$", "", title)
    return {"title": title, "avatar": avatar_of(info), "items": items,
            "link": info.get("channel_url") or info.get("uploader_url") or info.get("webpage_url") or url}


def wanted(sub, item):
    if item["live"]:
        return False  # première ou direct pas encore disponible : on réessaiera
    if sub.get("skip_shorts") and item.get("duration") and item["duration"] <= 70:
        return False
    title = item["title"].lower()
    include = [w.strip().lower() for w in sub.get("include", "").split(",") if w.strip()]
    exclude = [w.strip().lower() for w in sub.get("exclude", "").split(",") if w.strip()]
    if include and not any(w in title for w in include):
        return False
    return not any(w in title for w in exclude)


def subfolder(sub):
    name = re.sub(r'[\\/:*?"<>|]+', " ", sub["title"]).strip()[:80] or sub["id"]
    return f"Abonnements/{name}"


def download_item(sub, item):
    ids = downloader.submit(item["url"], sub.get("format", "video"), subfolder(sub), keep=True, user=sub["owner"], title=item["title"])
    item["status"], item["job"] = "queued", ids[0]


def check(sub_id, first=False):
    """Va chercher les nouveautés d'un abonnement ; renvoie le nombre de nouvelles vidéos."""
    with _check_lock:
        sub = load()["subs"].get(sub_id)
        if not sub:
            return 0
        try:
            data = fetch(sub["source"])
        except Exception as e:  # noqa: BLE001
            sub.update(last_check=time.time(), error=str(e)[:300])
            save_sub(sub)
            return 0
        sub.update(title=sub.get("custom_title") or data["title"], avatar=data["avatar"] or sub.get("avatar"),
                   link=data["link"], last_check=time.time(), error=None)
        known = {i["id"] for i in sub["items"]} | set(sub.get("seen", []))
        fresh, added = [], []
        for item in data["items"]:
            if item["id"] in known or item["live"]:
                continue
            item.update(found=time.time(), status="new")
            if first:
                item["status"] = "old"  # vidéos déjà en ligne au moment de l'abonnement
            elif wanted(sub, item):
                fresh.append(item)
                if sub.get("mode") == "download":
                    download_item(sub, item)
            else:
                item["status"] = "filtered"
            added.append(item)
        sub["items"] = (added + sub["items"])[:FEED_SIZE]
        sub["seen"] = list(dict.fromkeys([i["id"] for i in data["items"] if not i["live"]] + sub.get("seen", [])))[:300]
        save_sub(sub)
    if fresh and sub.get("notify", True):
        dl = sub.get("mode") == "download"
        if len(fresh) == 1:
            it = fresh[0]
            text = f"{sub['title']} a publié « {it['title']} »" + (" · téléchargement lancé" if dl else "")
            activity.log(sub["owner"], "abonnements", text, "#/abonnements", title=f"Nouvelle vidéo · {sub['title']}",
                         image=it.get("thumb"), icon=sub.get("avatar"))
        else:
            activity.log(sub["owner"], "abonnements", f"{len(fresh)} nouvelles vidéos de {sub['title']}" + (" · téléchargement lancé" if dl else ""),
                         "#/abonnements", title=sub["title"], image=fresh[0].get("thumb"), icon=sub.get("avatar"))
    return len(fresh)


def scheduler():
    while True:
        time.sleep(60)
        now = time.time()
        for sub in list(load()["subs"].values()):
            if sub.get("paused"):
                continue
            if now - (sub.get("last_check") or 0) >= sub.get("interval", 3) * 3600:
                check(sub["id"])
                time.sleep(5)  # ménage les sites suivis


def start():
    threading.Thread(target=scheduler, daemon=True).start()


def item_status(item):
    job = downloader.jobs.get(item.get("job") or "")
    if job:
        return {"queued": "queued", "starting": "queued", "downloading": "downloading", "processing": "downloading",
                "done": "downloaded", "error": "error"}.get(job["status"], item["status"]), job.get("progress")
    if item["status"] in ("queued", "downloading"):
        return "downloaded", None  # tâche terminée et oubliée par le téléchargeur
    return item["status"], None


def public(sub):
    out = {k: v for k, v in sub.items() if k not in ("seen", "items")}
    out["new"] = sum(1 for i in sub["items"] if i["status"] == "new")
    out["count"] = len(sub["items"])
    return out


# --- Routes -------------------------------------------------------------------

@bp.get("/api/subs")
def list_subs():
    subs = [public(s) for s in load()["subs"].values() if s["owner"] == g.user["name"]]
    return jsonify(sorted(subs, key=lambda s: s["title"].lower()))


@bp.get("/api/subs/feed")
def feed():
    sub_filter = request.args.get("sub")
    out = []
    for s in load()["subs"].values():
        if s["owner"] != g.user["name"] or (sub_filter and s["id"] != sub_filter):
            continue
        for it in s["items"]:
            if it["status"] in ("old", "filtered") and not sub_filter:
                continue
            status, pct = item_status(it)
            out.append({**it, "status": status, "progress": pct, "sub": s["id"], "channel": s["title"], "avatar": s.get("avatar")})
    out.sort(key=lambda i: -(i.get("published") or i.get("found") or 0))
    return jsonify(out[:120])


@bp.post("/api/subs")
def add():
    d = request.get_json(silent=True) or {}
    url = str(d.get("url") or "").strip()
    if not re.match(r"^https?://\S+$", url):
        raise ValueError("Colle le lien d'une chaîne, d'une playlist ou d'un flux de podcast")
    source = normalize(url)
    if any(s["source"] == source and s["owner"] == g.user["name"] for s in load()["subs"].values()):
        raise ValueError("Tu es déjà abonné à cette chaîne")
    data = fetch(source)  # vérifie le lien et récupère le nom
    sub = {"id": uuid.uuid4().hex[:8], "url": url, "source": source, "owner": g.user["name"], "title": data["title"],
           "avatar": data["avatar"], "link": data["link"], "mode": d.get("mode") if d.get("mode") in ("notify", "download") else "notify",
           "format": "audio" if d.get("format") == "audio" else "video", "interval": 3, "notify": True, "skip_shorts": False,
           "include": "", "exclude": "", "created": time.time(), "last_check": None, "error": None, "items": [], "seen": []}
    save_sub(sub)
    check(sub["id"], first=True)
    backlog = max(0, min(int(d.get("backlog") or 0), 15))
    if backlog:  # télécharger tout de suite les N dernières
        def go(data_):
            s = data_["subs"][sub["id"]]
            for it in [i for i in s["items"] if wanted(s, i)][:backlog]:
                download_item(s, it)
        store.update("subscriptions", {"subs": {}}, go)
    activity.log(g.user["name"], "abonnements", f"Abonné à {data['title']}", "#/abonnements", push=False)
    return jsonify(public(load()["subs"][sub["id"]]))


@bp.put("/api/subs/<sub_id>")
def edit(sub_id):
    sub = own(sub_id)
    d = request.get_json(silent=True) or {}
    if d.get("mode") in ("notify", "download"):
        sub["mode"] = d["mode"]
    if d.get("format") in ("video", "audio"):
        sub["format"] = d["format"]
    if "interval" in d and int(d["interval"]) in INTERVALS:
        sub["interval"] = int(d["interval"])
    for key in ("notify", "skip_shorts", "paused"):
        if key in d:
            sub[key] = bool(d[key])
    for key in ("include", "exclude"):
        if key in d:
            sub[key] = str(d[key] or "")[:300]
    if d.get("title"):
        sub["custom_title"] = sub["title"] = str(d["title"]).strip()[:100]
    save_sub(sub)
    return jsonify(public(sub))


@bp.delete("/api/subs/<sub_id>")
def remove(sub_id):
    own(sub_id)
    store.update("subscriptions", {"subs": {}}, lambda d: d["subs"].pop(sub_id, None))
    return jsonify(ok=True)


@bp.post("/api/subs/<sub_id>/check")
def check_now(sub_id):
    own(sub_id)
    n = check(sub_id)
    sub = load()["subs"][sub_id]
    if sub.get("error"):
        raise ValueError(sub["error"])
    return jsonify(new=n)


@bp.post("/api/subs/check-all")
def check_all():
    subs = [s for s in load()["subs"].values() if s["owner"] == g.user["name"]]
    threading.Thread(target=lambda: [check(s["id"]) for s in subs], daemon=True).start()
    return jsonify(count=len(subs))


@bp.post("/api/subs/<sub_id>/items/<item_id>")
def item_action(sub_id, item_id):
    own(sub_id)
    action = (request.get_json(silent=True) or {}).get("action")

    def go(d):
        sub = d["subs"][sub_id]
        it = next((i for i in sub["items"] if i["id"] == item_id), None)
        if not it:
            raise ValueError("Vidéo introuvable")
        if action == "download":
            download_item(sub, it)
        elif action == "ignore":
            it["status"] = "ignored"
        elif action == "seen":
            it["status"] = "seen" if it["status"] == "new" else it["status"]
        else:
            raise ValueError("Action inconnue")
        return it
    return jsonify(store.update("subscriptions", {"subs": {}}, go))


@bp.post("/api/subs/seen")
def all_seen():
    def go(d):
        for s in d["subs"].values():
            if s["owner"] == g.user["name"]:
                for it in s["items"]:
                    if it["status"] == "new":
                        it["status"] = "seen"
    store.update("subscriptions", {"subs": {}}, go)
    return jsonify(ok=True)


def search(q, user):
    out = []
    for s in load()["subs"].values():
        if s["owner"] != user:
            continue
        if q in s["title"].lower():
            out.append({"type": "sub", "title": s["title"], "sub": "Chaîne suivie", "link": "#/abonnements"})
        out += [{"type": "sub", "title": i["title"], "sub": s["title"], "link": "#/abonnements"} for i in s["items"] if q in i["title"].lower()][:3]
    return out[:8]


def count(user):
    return sum(1 for s in load()["subs"].values() if s["owner"] == user)
