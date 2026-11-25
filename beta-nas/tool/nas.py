"""Outil « Santé du NAS » (administrateurs) : espace disque de chaque volume avec la tendance et la date
probable où il sera plein, processeur, mémoire, températures, état SMART des disques (si smartctl est
disponible), réseau et durée de fonctionnement. Prévient (cloche + push) quand un seuil est dépassé
et quand tout redevient normal.

Tout est lu dans /proc et /sys (pas de dépendance). Les relevés récents (24 h, toutes les 5 min)
et l'historique quotidien de l'espace disque sont dans DATA_DIR/nas.json."""

import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import date, timedelta

from flask import Blueprint, g, jsonify, request

import activity
import auth
import roots
import store

bp = Blueprint("nas", __name__)
KEY = "nas"
EMPTY = {"recent": [], "days": {}, "fired": {}, "settings": {}}
DEFAULTS = {"disk_pct": 90, "temp": 75, "mem_pct": 95, "smart": True, "on": True}
RECENT = 288
_last = {"cpu": None, "net": None, "smart": (0, None)}
_lock = threading.Lock()


@bp.before_request
def admins_only():
    if request.path.startswith("/api/nas") and g.user["role"] != "admin":
        return jsonify(error="Réservé aux administrateurs"), 403


def _read(path, default=""):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


# --- Mesures -----------------------------------------------------------------------------------

def cpu_pct():
    """Charge du processeur depuis la mesure précédente (lecture de /proc/stat)."""
    line = _read("/proc/stat").split("\n", 1)[0].split()[1:]
    if not line:
        return None
    vals = [int(x) for x in line]
    idle, total = vals[3] + (vals[4] if len(vals) > 4 else 0), sum(vals)
    prev, _last["cpu"] = _last["cpu"], (idle, total)
    if not prev:
        time.sleep(0.3)
        return cpu_pct()
    dt = total - prev[1]
    return round(100 * (1 - (idle - prev[0]) / dt), 1) if dt > 0 else 0.0


def memory():
    info = {}
    for line in _read("/proc/meminfo").splitlines():
        k, _, v = line.partition(":")
        if v.strip():
            info[k] = int(v.split()[0]) * 1024
    total = info.get("MemTotal") or 0
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    swap_t, swap_f = info.get("SwapTotal", 0), info.get("SwapFree", 0)
    return {"total": total, "used": total - avail, "pct": round(100 * (total - avail) / total, 1) if total else None,
            "swap_total": swap_t, "swap_used": swap_t - swap_f}


def uptime():
    try:
        return int(float(_read("/proc/uptime").split()[0]))
    except (IndexError, ValueError):
        return None


def load_avg():
    try:
        return [float(x) for x in _read("/proc/loadavg").split()[:3]]
    except ValueError:
        return None


def temperatures():
    """Capteurs de température : zones thermiques et puces hwmon (processeur, disques NVMe…)."""
    out = []
    for z in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        t = _read(z + "/temp").strip()
        if t.lstrip("-").isdigit() and int(t) > 0:
            out.append({"name": _read(z + "/type").strip() or os.path.basename(z), "c": round(int(t) / 1000, 1)})
    for h in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        chip = _read(h + "/name").strip()
        for f in sorted(glob.glob(h + "/temp*_input")):
            t = _read(f).strip()
            if not t.lstrip("-").isdigit() or int(t) <= 0:
                continue
            label = _read(f.replace("_input", "_label")).strip()
            out.append({"name": f"{chip} {label}".strip() or chip, "c": round(int(t) / 1000, 1)})
    seen, res = set(), []
    for x in out:
        if (x["name"], x["c"]) not in seen:
            seen.add((x["name"], x["c"]))
            res.append(x)
    return res[:16]


def network():
    """Débit réseau (octets/s) depuis la mesure précédente, toutes interfaces hors loopback."""
    rx = tx = 0
    for line in _read("/proc/net/dev").splitlines()[2:]:
        name, _, data = line.partition(":")
        name = name.strip()
        if name == "lo" or name.startswith(("veth", "docker", "br-")):
            continue
        f = data.split()
        if len(f) >= 9:
            rx, tx = rx + int(f[0]), tx + int(f[8])
    now, prev = time.time(), _last["net"]
    _last["net"] = (now, rx, tx)
    if not prev or now - prev[0] <= 0:
        return {"rx": None, "tx": None}
    return {"rx": max(0, round((rx - prev[1]) / (now - prev[0]))), "tx": max(0, round((tx - prev[2]) / (now - prev[0])))}


def disks():
    """Un élément par volume (plusieurs dossiers sur le même disque sont regroupés)."""
    out = {}
    for r in roots.all_roots():
        try:
            st, u = os.stat(r["path"]), shutil.disk_usage(r["path"])
        except OSError:
            continue
        # capacité utile = utilisé + libre (comme df : sans les blocs réservés au système)
        d = out.setdefault(str(st.st_dev), {"id": str(st.st_dev), "total": u.used + u.free, "used": u.used, "free": u.free, "roots": []})
        d["roots"].append(r["label"])
    for d in out.values():
        d["pct"] = round(100 * d["used"] / d["total"], 1) if d["total"] else None
    return list(out.values())


def top_processes(n=6):
    """Programmes qui utilisent le plus de mémoire (lecture de /proc/<pid>/status)."""
    procs = []
    for p in glob.glob("/proc/[0-9]*/status"):
        txt = _read(p)
        name = re.search(r"^Name:\s*(.+)$", txt, re.M)
        rss = re.search(r"^VmRSS:\s*(\d+)", txt, re.M)
        if name and rss:
            procs.append({"name": name.group(1).strip(), "rss": int(rss.group(1)) * 1024})
    agg = {}
    for x in procs:
        a = agg.setdefault(x["name"], {"name": x["name"], "rss": 0, "count": 0})
        a["rss"] += x["rss"]
        a["count"] += 1
    return sorted(agg.values(), key=lambda x: -x["rss"])[:n]


def smart(force=False):
    """État SMART des disques via smartctl (si installé et si le conteneur a accès aux disques). Cache 6 h."""
    ts, cached = _last["smart"]
    if not force and cached is not None and time.time() - ts < 6 * 3600:
        return cached
    exe = shutil.which("smartctl")
    if not exe:
        _last["smart"] = (time.time(), {"available": False, "disks": []})
        return _last["smart"][1]
    res = []
    try:
        scan = json.loads(subprocess.run([exe, "--scan-open", "-j"], capture_output=True, text=True, timeout=30).stdout or "{}")
        devs = [d["name"] for d in scan.get("devices", []) if d.get("name")]
    except (OSError, ValueError, subprocess.SubprocessError):
        devs = []
    for dev in devs[:12]:
        try:
            j = json.loads(subprocess.run([exe, "-H", "-A", "-i", "-j", dev], capture_output=True, text=True, timeout=60).stdout or "{}")
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
        attrs = {a.get("id"): a.get("raw", {}).get("value") for a in j.get("ata_smart_attributes", {}).get("table", [])}
        nv = j.get("nvme_smart_health_information_log", {})
        res.append({"dev": dev, "model": j.get("model_name") or j.get("model_family") or "", "serial": j.get("serial_number", ""),
                    "passed": j.get("smart_status", {}).get("passed"), "temp": j.get("temperature", {}).get("current"),
                    "hours": j.get("power_on_time", {}).get("hours"), "reallocated": attrs.get(5), "pending": attrs.get(197),
                    "uncorrectable": attrs.get(198), "wear": nv.get("percentage_used"),
                    "capacity": j.get("user_capacity", {}).get("bytes")})
    _last["smart"] = (time.time(), {"available": True, "disks": res})
    return _last["smart"][1]


# --- Tendance de l'espace disque -------------------------------------------------------------------

def forecast(samples):
    """Régression linéaire sur les 60 derniers jours : octets gagnés par jour et date où le disque sera plein."""
    pts = [(date.fromisoformat(d).toordinal(), u, t) for d, u, t in samples[-60:]]
    if len(pts) < 3:
        return None
    n = len(pts)
    mx, my = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    den = sum((p[0] - mx) ** 2 for p in pts)
    if not den:
        return None
    slope = sum((p[0] - mx) * (p[1] - my) for p in pts) / den
    last = pts[-1]
    out = {"per_day": round(slope), "per_month": round(slope * 30)}
    if slope > 0:
        days = (last[2] - last[1]) / slope
        if days < 3650:
            out["full_in"] = round(days)
            out["full_on"] = (date.today() + timedelta(days=days)).isoformat()
    return out


def settings_of(d):
    return {**DEFAULTS, **(d.get("settings") or {})}


# --- Relevé périodique et alertes ---------------------------------------------------------------

def sample():
    s = {"ts": int(time.time()), "cpu": cpu_pct(), "mem": memory()["pct"], "net": network()}
    t = temperatures()
    s["temp"] = max((x["c"] for x in t), default=None)
    dks = disks()

    def go(d):
        d["recent"] = (d.get("recent") or [])[-(RECENT - 1):] + [s]
        today = date.today().isoformat()
        for k in dks:
            arr = d.setdefault("days", {}).setdefault(k["id"], [])
            if arr and arr[-1][0] == today:
                arr[-1] = [today, k["used"], k["total"]]
            else:
                arr.append([today, k["used"], k["total"]])
            del arr[:-400]
    store.update(KEY, EMPTY, go)
    return s, t, dks


def recipients():
    if auth.mode() != "accounts":
        return ["*"]
    return [u["name"] for u in auth.users() if u["role"] == "admin"]


def problems(s, t, dks, sm, conf):
    """Liste des problèmes en cours : {clé: texte}."""
    out = {}
    for k in dks:
        if k["pct"] is not None and k["pct"] >= conf["disk_pct"]:
            out[f"disk-{k['id']}"] = f"Disque presque plein ({', '.join(k['roots'])}) : {k['pct']:.0f} % utilisé"
    hot = [x for x in t if x["c"] >= conf["temp"]]
    if hot:
        out["temp"] = f"Température élevée : {hot[0]['name']} à {hot[0]['c']:.0f} °C"
    if s.get("mem") is not None and s["mem"] >= conf["mem_pct"]:
        out["mem"] = f"Mémoire presque pleine : {s['mem']:.0f} %"
    if conf.get("smart"):
        for x in (sm or {}).get("disks", []):
            bad = x.get("passed") is False or (x.get("reallocated") or 0) > 0 or (x.get("pending") or 0) > 0
            if bad:
                out[f"smart-{x['serial'] or x['dev']}"] = f"Disque {x['model'] or x['dev']} : état SMART inquiétant, pense à sauvegarder et à le remplacer"
    return out


def check():
    s, t, dks = sample()
    sm = smart()
    d = store.load(KEY, EMPTY)
    conf = settings_of(d)
    if not conf.get("on", True):
        return
    now = problems(s, t, dks, sm, conf)
    fired = dict(d.get("fired") or {})
    for k, text in now.items():
        if k not in fired:
            for u in recipients():
                activity.log(u, "nas", text, "#/nas", "err", title="Santé du NAS")
            fired[k] = time.time()
    for k in list(fired):
        if k not in now:
            del fired[k]
            if k != "mem":
                for u in recipients():
                    activity.log(u, "nas", "Retour à la normale : " + {"temp": "température"}.get(k, "disque" if k.startswith("disk") else "état des disques"), "#/nas", "ok", title="Santé du NAS")
    store.update(KEY, EMPTY, lambda x: x.__setitem__("fired", fired))


def loop():
    time.sleep(20)
    while True:
        try:
            check()
        except Exception as e:  # noqa: BLE001
            print("Santé du NAS :", e, flush=True)
        time.sleep(300)


def start():
    threading.Thread(target=loop, daemon=True).start()


# --- API --------------------------------------------------------------------------------------

@bp.get("/api/nas")
def overview():
    with _lock:
        cpu, net = cpu_pct(), network()
    d = store.load(KEY, EMPTY)
    conf = settings_of(d)
    dks = disks()
    for k in dks:
        k["forecast"] = forecast(d.get("days", {}).get(k["id"], []))
        k["history"] = [[x[0], x[1]] for x in d.get("days", {}).get(k["id"], [])[-90:]]
    t = temperatures()
    mem = memory()
    sm = _last["smart"][1]
    return jsonify(cpu=cpu, cores=os.cpu_count(), load=load_avg(), mem=mem, uptime=uptime(), temps=t, net=net, disks=dks,
                   smart=sm, processes=top_processes(), recent=d.get("recent", [])[-RECENT:], settings=conf,
                   problems=problems({"mem": mem["pct"]}, t, dks, sm, conf), host=os.uname().nodename,
                   kernel=os.uname().release)


@bp.post("/api/nas/smart")
def smart_now():
    return jsonify(smart(force=True))


@bp.put("/api/nas/settings")
def save_settings():
    f = request.get_json(force=True)
    conf = {}
    for k, lo, hi in (("disk_pct", 50, 99), ("temp", 40, 110), ("mem_pct", 50, 100)):
        if k in f:
            conf[k] = max(lo, min(hi, int(float(f[k]))))
    for k in ("smart", "on"):
        if k in f:
            conf[k] = bool(f[k])
    store.update(KEY, EMPTY, lambda d: d.__setitem__("settings", {**(d.get("settings") or {}), **conf}))
    return jsonify(settings_of(store.load(KEY, EMPTY)))
