"""Outil « Surveillance » : vérifie régulièrement des sites, des services (port TCP),
l'espace disque du NAS… Prévient (cloche + notification push) quand quelque chose
ne répond plus et quand ça revient. Page de statut publique optionnelle (/statut).

Les sondes sont dans DATA_DIR/monitor.json, l'historique récent de chacune dans
DATA_DIR/monitor/<id>.json (dernières vérifications + statistiques par jour)."""

import os
import re
import shutil
import socket
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from flask import Blueprint, g, jsonify, request

import activity
import auth
import roots
import store

bp = Blueprint("monitor", __name__)
TYPES = ("http", "keyword", "tcp", "ping", "disk")
HISTORY = 288  # dernières vérifications gardées (24 h toutes les 5 min)
_pool = ThreadPoolExecutor(max_workers=4)
_running = set()
_lock = threading.Lock()


@bp.before_request
def admins_only():
    if request.path.startswith("/api/monitor") and g.user["role"] != "admin":
        raise PermissionError("Réservé aux administrateurs")


def monitors():
    return store.load("monitor", {"monitors": {}})["monitors"]


def history(mid):
    return store.load(f"monitor/{mid}", {"checks": [], "days": {}, "events": []})


# --- Vérifications ----------------------------------------------------------

def check_http(m):
    url = m["target"]
    req = urllib.request.Request(url, headers={"User-Agent": "Beta-Tool-Surveillance/1.0"})
    ctx = ssl.create_default_context()
    if m.get("insecure"):
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=m.get("timeout", 10), context=ctx) as r:
            body = r.read(2 * 1024 * 1024) if m["type"] == "keyword" else r.read(1)
            code = r.status
    except urllib.error.HTTPError as e:
        code, body = e.code, b""
    ms = round((time.perf_counter() - start) * 1000)
    if code >= 400:
        return False, ms, f"Erreur HTTP {code}"
    if m["type"] == "keyword":
        found = m.get("keyword", "").lower() in body.decode("utf-8", "replace").lower()
        if found == bool(m.get("invert")):
            return False, ms, f"« {m.get('keyword')} » {'présent' if found else 'introuvable'} dans la page"
    return True, ms, f"HTTP {code}"


def cert_days(url):
    """Jours avant l'expiration du certificat HTTPS, ou None."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https":
        return None
    try:
        with socket.create_connection((u.hostname, u.port or 443), timeout=8) as sock:
            with ssl.create_default_context().wrap_socket(sock, server_hostname=u.hostname) as s:
                exp = ssl.cert_time_to_seconds(s.getpeercert()["notAfter"])
        return int((exp - time.time()) // 86400)
    except (OSError, ssl.SSLError, KeyError, ValueError):
        return None


def check_tcp(m):
    host, _, port = m["target"].rpartition(":")
    if not host or not port.isdigit():
        return False, None, "Adresse invalide (format hôte:port)"
    start = time.perf_counter()
    with socket.create_connection((host.strip("[]"), int(port)), timeout=m.get("timeout", 10)):
        pass
    return True, round((time.perf_counter() - start) * 1000), f"Port {port} ouvert"


def check_ping(m):
    if not shutil.which("ping"):
        return False, None, "La commande ping n'est pas disponible : utilise un contrôle de port (TCP)"
    proc = subprocess.run(["ping", "-c", "1", "-W", str(m.get("timeout", 10)), m["target"]], capture_output=True, text=True,
                          timeout=m.get("timeout", 10) + 5)
    found = re.search(r"time[=<]([\d.]+)", proc.stdout)
    if proc.returncode != 0:
        return False, None, "Aucune réponse au ping"
    return True, round(float(found.group(1))) if found else None, "Répond au ping"


def check_disk(m):
    worst = None
    for r in roots.all_roots():
        if m["target"] not in ("*", r["id"]):
            continue
        u = shutil.disk_usage(r["path"])
        free = u.free / u.total * 100
        if worst is None or free < worst[0]:
            worst = (free, r["label"], u.free)
    if worst is None:
        return False, None, "Dossier introuvable"
    free, label, left = worst
    gb = left / 1024 ** 3
    msg = f"{free:.0f} % libres ({gb:.0f} Go) sur {label}"
    return free >= m.get("threshold", 10), None, msg


def run(m):
    try:
        fn = {"http": check_http, "keyword": check_http, "tcp": check_tcp, "ping": check_ping, "disk": check_disk}[m["type"]]
        ok, ms, msg = fn(m)
    except socket.timeout:
        ok, ms, msg = False, None, "Délai dépassé"
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, "reason", e)
        ok, ms, msg = False, None, f"Injoignable ({reason})"[:200]
    except Exception as e:  # noqa: BLE001
        ok, ms, msg = False, None, str(e)[:200]
    return ok, ms, msg


def recipients():
    if auth.mode() != "accounts":
        return ["*"]
    return [u["name"] for u in auth.users() if u["role"] == "admin"]


def alert(text, kind):
    for user in recipients():
        activity.log(user, "surveillance", text, "#/surveillance", kind, title="Surveillance")


def probe(mid):
    m = monitors().get(mid)
    if not m:
        return
    ok, ms, msg = run(m)
    now = time.time()
    days = None
    if m["type"] in ("http", "keyword") and m["target"].startswith("https://") and now - m.get("cert_checked", 0) > 6 * 3600:
        days = cert_days(m["target"])

    def go(h):
        h["checks"].append([round(now), ok, ms])
        h["checks"] = h["checks"][-HISTORY:]
        day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
        d = h["days"].setdefault(day, [0, 0, 0, 0])  # réussies, total, somme des ms, nombre de ms
        d[0] += ok
        d[1] += 1
        if ms is not None:
            d[2] += ms
            d[3] += 1
        for old in sorted(h["days"])[:-90]:
            del h["days"][old]
    store.update(f"monitor/{mid}", {"checks": [], "days": {}, "events": []}, go)

    alerts = []

    def upd(data):
        m2 = data["monitors"].get(mid)
        if not m2:
            return
        m2.update(last_check=now, last_ok=ok, last_ms=ms, last_msg=msg)
        m2["fails"] = 0 if ok else m2.get("fails", 0) + 1
        if days is not None:
            m2.update(cert_days=days, cert_checked=now)
            if days <= 14 and m2.get("cert_warned") != datetime.now().strftime("%Y-%m-%d"):
                m2["cert_warned"] = datetime.now().strftime("%Y-%m-%d")
                alerts.append((f"Le certificat HTTPS de {m2['name']} expire dans {days} jour{'s' if days > 1 else ''}", "err", None))
        state = m2.get("state", "unknown")
        if not ok and m2["fails"] >= m2.get("retries", 2) and state != "down":
            m2.update(state="down", down_since=now)
            alerts.append((f"🔴 {m2['name']} ne répond plus : {msg}", "err", ("down", msg)))
        elif ok and state != "up":
            if state == "down":
                mins = max(1, round((now - m2.get("down_since", now)) / 60))
                alerts.append((f"🟢 {m2['name']} est de retour (panne de {mins} min)", "ok", ("up", f"Panne de {mins} min")))
            m2["state"] = "up"
            m2.pop("down_since", None)
    store.update("monitor", {"monitors": {}}, upd)
    for text, kind, event in alerts:
        if event:
            store.update(f"monitor/{mid}", {"checks": [], "days": {}, "events": []},
                         lambda h: h["events"].insert(0, {"ts": now, "kind": event[0], "msg": event[1]}) or h.update(events=h["events"][:50]))
        if monitors().get(mid, {}).get("notify", True):
            alert(text, kind)


def _probe_safe(mid):
    try:
        probe(mid)
    finally:
        with _lock:
            _running.discard(mid)


def scheduler():
    while True:
        time.sleep(5)
        now = time.time()
        for m in list(monitors().values()):
            if m.get("paused") or now - (m.get("last_check") or 0) < m.get("interval", 300):
                continue
            with _lock:
                if m["id"] in _running:
                    continue
                _running.add(m["id"])
            _pool.submit(_probe_safe, m["id"])


def start():
    os.makedirs(store.path("monitor"), exist_ok=True)
    threading.Thread(target=scheduler, daemon=True).start()


def stats(mid):
    h = history(mid)
    out = {}
    for label, n in (("24h", 1), ("7j", 7), ("30j", 30)):
        keys = sorted(h["days"])[-n:]
        ok = sum(h["days"][k][0] for k in keys)
        total = sum(h["days"][k][1] for k in keys)
        out[label] = round(ok / total * 100, 2) if total else None
    if h["checks"]:  # 24 h glissantes : à partir des vérifications détaillées
        recent = [c for c in h["checks"] if c[0] > time.time() - 86400]
        out["24h"] = round(sum(1 for c in recent if c[1]) / len(recent) * 100, 2) if recent else out["24h"]
    return out


def public(m, detail=False):
    h = history(m["id"])
    out = {**m, "uptime": stats(m["id"]), "spark": [[c[0], c[1], c[2]] for c in h["checks"][-60:]]}
    if detail:
        out["checks"] = h["checks"]
        out["events"] = h["events"]
        out["days"] = h["days"]
    return out


def clean(d, current=None):
    m = dict(current or {})
    t = d.get("type", m.get("type"))
    if t not in TYPES:
        raise ValueError("Type de surveillance inconnu")
    name = str(d.get("name") or "").strip()[:80]
    target = str(d.get("target") or "").strip()[:500]
    if not name:
        raise ValueError("Donne un nom à cette surveillance")
    if t in ("http", "keyword") and not re.match(r"^https?://\S+$", target):
        raise ValueError("Adresse invalide : elle doit commencer par http:// ou https://")
    if t == "tcp" and not re.match(r"^\S+:\d{1,5}$", target):
        raise ValueError("Indique l'hôte et le port, par exemple 192.168.1.1:80")
    if t == "ping" and not re.match(r"^[\w.-]+$", target):
        raise ValueError("Indique un nom d'hôte ou une adresse IP")
    if t == "disk" and target != "*" and not any(r["id"] == target for r in roots.all_roots()):
        target = "*"
    if t == "keyword" and not str(d.get("keyword") or "").strip():
        raise ValueError("Indique le mot à chercher dans la page")
    m.update(type=t, name=name, target=target, keyword=str(d.get("keyword") or "")[:200], invert=bool(d.get("invert")),
             interval=max(30, min(int(d.get("interval") or 300), 86400)), timeout=max(2, min(int(d.get("timeout") or 10), 60)),
             retries=max(1, min(int(d.get("retries") or 2), 10)), threshold=max(1, min(int(d.get("threshold") or 10), 90)),
             notify=bool(d.get("notify", True)), public=bool(d.get("public")), insecure=bool(d.get("insecure")),
             paused=bool(d.get("paused")))
    return m


# --- Routes -----------------------------------------------------------------

@bp.get("/api/monitor")
def list_monitors():
    ms = sorted(monitors().values(), key=lambda m: (m.get("state") != "down", m["name"].lower()))
    return jsonify(monitors=[public(m) for m in ms], ping=bool(shutil.which("ping")),
                   roots=[{"id": r["id"], "label": r["label"]} for r in roots.all_roots()])


@bp.get("/api/monitor/<mid>")
def detail(mid):
    m = monitors().get(mid)
    if not m:
        raise ValueError("Surveillance introuvable")
    return jsonify(public(m, detail=True))


@bp.post("/api/monitor")
def save():
    d = request.get_json(silent=True) or {}
    mid = d.get("id")

    def go(data):
        if mid:
            if mid not in data["monitors"]:
                raise ValueError("Surveillance introuvable")
            data["monitors"][mid] = clean(d, data["monitors"][mid])
            data["monitors"][mid]["last_check"] = 0  # revérifie tout de suite
            return data["monitors"][mid]
        m = clean(d)
        m.update(id=uuid.uuid4().hex[:8], created=time.time(), state="unknown", last_check=0)
        data["monitors"][m["id"]] = m
        return m
    m = store.update("monitor", {"monitors": {}}, go)
    return jsonify(m)


@bp.delete("/api/monitor/<mid>")
def delete(mid):
    store.update("monitor", {"monitors": {}}, lambda d: d["monitors"].pop(mid, None))
    try:
        os.remove(store.path("monitor", mid + ".json"))
    except OSError:
        pass
    return jsonify(ok=True)


@bp.post("/api/monitor/<mid>/check")
def check_now(mid):
    if mid not in monitors():
        raise ValueError("Surveillance introuvable")
    probe(mid)
    return jsonify(public(monitors()[mid]))


@bp.post("/api/monitor/test")
def test():
    """Essaie une configuration sans l'enregistrer."""
    ok, ms, msg = run(clean(request.get_json(silent=True) or {}))
    return jsonify(ok=ok, ms=ms, msg=msg)


@bp.get("/api/public/status")
def public_status():
    ms = [m for m in monitors().values() if m.get("public")]
    return jsonify(site=store.load("settings", {}).get("site_name") or "Bêta Tool",
                   monitors=[{"name": m["name"], "state": m.get("state", "unknown"), "uptime": stats(m["id"]),
                              "spark": [[c[0], c[1]] for c in history(m["id"])["checks"][-90:]]} for m in ms])


def summary():
    ms = list(monitors().values())
    return {"total": len(ms), "down": sum(1 for m in ms if m.get("state") == "down" and not m.get("paused"))}
