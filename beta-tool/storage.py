"""Outil « Stockage » : où part la place (carte des dossiers, plus gros fichiers),
fichiers en double, et suggestions de rangement d'un dossier (photos par date,
installateurs, archives, documents reconnus envoyés à Paperasse…).

Les analyses tournent en arrière-plan ; une seule de chaque sorte à la fois.
Les suppressions passent par la corbeille (.corbeille) de chaque racine."""

import hashlib
import os
import re
import shutil
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime

from flask import Blueprint, g, jsonify, request

import activity
import doctype
import roots
import settings
import store
from converter import unique_path

bp = Blueprint("storage", __name__)
SKIP = {".corbeille", "@eaDir", "#recycle", "#snapshot", ".a-valider", "@Recycle", ".snapshot"}
GROUPS = {
    "video": ("Vidéos", {"mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "m2ts"}),
    "photo": ("Photos et images", {"jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif", "raw", "cr2", "nef", "arw", "dng", "svg"}),
    "audio": ("Musique et audio", {"mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff", "alac"}),
    "doc": ("Documents", {"pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "epub", "pages", "numbers", "key"}),
    "archive": ("Archives et images disque", {"zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "img", "dmg"}),
    "app": ("Installateurs", {"exe", "msi", "apk", "deb", "rpm", "pkg", "appimage"}),
}
TEMP_EXT = {"part", "crdownload", "tmp", "download", "partial", "!ut", "opdownload"}
_state = {"scan": {"status": "idle"}, "dupes": {"status": "idle"}, "tidy": {"status": "idle"}}
_lock = threading.Lock()


def group_of(name):
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    return next((k for k, (_, exts) in GROUPS.items() if ext in exts), "other")


def walk(base):
    """os.walk sans les dossiers cachés, corbeilles et dossiers système des NAS."""
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith(".")]
        yield dirpath, dirnames, [f for f in filenames if not f.startswith(".")]


def run_bg(kind, fn, *args):
    with _lock:
        if _state[kind].get("status") == "running":
            raise ValueError("Une analyse est déjà en cours")
        _state[kind] = {"status": "running", "started": time.time(), "progress": 0, "step": "Démarrage…", "user": g.user["name"]}

    def go():
        try:
            result = fn(*args)
            with _lock:
                _state[kind].update(status="done", finished=time.time(), result=result)
        except Exception as e:  # noqa: BLE001
            with _lock:
                _state[kind].update(status="error", error=str(e)[:300])
    threading.Thread(target=go, daemon=True).start()


def progress(kind, **kw):
    with _lock:
        _state[kind].update(**kw)


def to_trash(root_id, rel):
    path = roots.resolve(root_id, rel)
    base = roots.resolve(root_id)
    trash = os.path.join(base, ".corbeille")
    if path == base or path.startswith(trash):
        raise ValueError("Impossible de supprimer cet élément")
    os.makedirs(trash, exist_ok=True)
    shutil.move(path, unique_path(trash, os.path.basename(path)))


# --- Carte de l'espace ---------------------------------------------------------

def analyze_space():
    out = {"roots": [], "types": defaultdict(int), "largest": [], "old": [], "files": 0}
    year_ago = time.time() - 2 * 365 * 86400
    for r in roots.all_roots():
        base = os.path.realpath(r["path"])
        sizes = defaultdict(int)  # chemin relatif du dossier → taille totale
        largest = []
        for dirpath, _, filenames in walk(base):
            rel = os.path.relpath(dirpath, base).replace(os.sep, "/")
            rel = "" if rel == "." else rel
            total = 0
            for f in filenames:
                try:
                    st = os.lstat(os.path.join(dirpath, f))
                except OSError:
                    continue
                if not os.path.isfile(os.path.join(dirpath, f)):
                    continue
                total += st.st_size
                out["files"] += 1
                out["types"][group_of(f)] += st.st_size
                path = f"{rel}/{f}".lstrip("/")
                if st.st_size > 20 * 1024 ** 2:
                    largest.append((st.st_size, path, st.st_mtime))
                    if st.st_mtime < year_ago and st.st_size > 200 * 1024 ** 2:
                        out["old"].append({"root": r["id"], "label": r["label"], "path": path, "size": st.st_size, "mtime": st.st_mtime})
                if out["files"] % 2000 == 0:
                    progress("scan", progress=out["files"], step=f"{out['files']} fichiers · {r['label']}")
            # ajoute la taille à ce dossier et à tous ses parents
            parts = rel.split("/") if rel else []
            for i in range(len(parts) + 1):
                sizes["/".join(parts[:i])] += total
        children = defaultdict(list)
        for path, size in sizes.items():
            if path:
                children[os.path.dirname(path)].append((path, size))
        store.save(f"storage/tree-{r['id']}", {"sizes": dict(sizes), "children": {k: sorted(v, key=lambda x: -x[1])[:80] for k, v in children.items()}})
        try:
            usage = shutil.disk_usage(base)
            dev = os.stat(base).st_dev
        except OSError:
            continue
        out["roots"].append({"id": r["id"], "label": r["label"], "size": sizes.get("", 0), "disk_total": usage.total, "disk_free": usage.free, "dev": dev})
        out["largest"] += [{"root": r["id"], "label": r["label"], "path": p, "size": s, "mtime": m} for s, p, m in largest]
    out["largest"] = sorted(out["largest"], key=lambda x: -x["size"])[:60]
    out["old"] = sorted(out["old"], key=lambda x: -x["size"])[:40]
    out["types"] = dict(out["types"])
    out["at"] = time.time()
    store.save("storage/space", out)
    return {"files": out["files"]}


@bp.get("/api/storage")
def overview():
    data = store.load("storage/space", None)
    with _lock:
        st = {k: {kk: vv for kk, vv in v.items() if kk != "result"} for k, v in _state.items()}
    return jsonify(space=data, state=st, groups={k: v[0] for k, v in GROUPS.items()} | {"other": "Autres"})


@bp.post("/api/storage/scan")
def scan():
    run_bg("scan", analyze_space)
    return jsonify(ok=True)


@bp.get("/api/storage/tree")
def tree():
    root_id = request.args.get("root")
    path = request.args.get("path", "").strip("/")
    roots.get(root_id)
    t = store.load(f"storage/tree-{root_id}", None)
    if not t:
        raise ValueError("Lance d'abord une analyse")
    kids = t["children"].get(path, [])
    files = []
    try:  # fichiers posés directement dans ce dossier
        base = roots.resolve(root_id, path)
        for f in os.listdir(base):
            p = os.path.join(base, f)
            if not f.startswith(".") and os.path.isfile(p):
                files.append((f"{path}/{f}".lstrip("/"), os.path.getsize(p)))
    except (OSError, ValueError):
        pass
    files.sort(key=lambda x: -x[1])
    items = [{"path": p, "name": os.path.basename(p), "size": s, "dir": True} for p, s in kids] + \
            [{"path": p, "name": os.path.basename(p), "size": s, "dir": False, "group": group_of(p)} for p, s in files[:60]]
    return jsonify(total=t["sizes"].get(path, 0), items=sorted(items, key=lambda x: -x["size"]))


# --- Doublons -------------------------------------------------------------------

def quick_hash(path, size):
    h = hashlib.sha1(str(size).encode())
    with open(path, "rb") as f:
        h.update(f.read(65536))
        if size > 131072:
            f.seek(-65536, os.SEEK_END)
            h.update(f.read(65536))
    return h.hexdigest()


def full_hash(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def find_dupes(root_ids, min_size):
    by_size = defaultdict(list)
    n = 0
    for r in roots.all_roots():
        if root_ids and r["id"] not in root_ids:
            continue
        base = os.path.realpath(r["path"])
        for dirpath, _, filenames in walk(base):
            for f in filenames:
                p = os.path.join(dirpath, f)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if st.st_size >= min_size and os.path.isfile(p):
                    by_size[st.st_size].append((r["id"], r["label"], p, st.st_mtime, st.st_ino, st.st_dev))
                    n += 1
                    if n % 2000 == 0:
                        progress("dupes", step=f"Inventaire : {n} fichiers", progress=0)
    candidates = [v for v in by_size.values() if len(v) > 1]
    total = sum(len(v) for v in candidates) or 1
    done = 0
    groups = []
    for files in candidates:
        files = list({(f[4], f[5]): f for f in files}.values())  # liens physiques = même fichier, pas un doublon
        if len(files) < 2:
            continue
        quick = defaultdict(list)
        for f in files:
            try:
                quick[quick_hash(f[2], os.path.getsize(f[2]))].append(f)
            except OSError:
                pass
            done += 1
        progress("dupes", step=f"Comparaison : {done} / {total}", progress=round(done * 100 / total))
        for same in quick.values():
            if len(same) < 2:
                continue
            full = defaultdict(list)
            for f in same:
                try:
                    full[full_hash(f[2])].append(f)
                except OSError:
                    pass
            for h, dup in full.items():
                if len(dup) > 1:
                    size = os.path.getsize(dup[0][2])
                    dup.sort(key=lambda f: (f[3], len(f[2])))  # le plus ancien en premier : on le garde
                    groups.append({"hash": h[:12], "size": size, "files": [{"root": f[0], "label": f[1], "path": roots.relative(f[0], f[2]),
                                                                           "mtime": f[3]} for f in dup]})
    groups.sort(key=lambda g_: -g_["size"] * (len(g_["files"]) - 1))
    return {"groups": groups[:500], "wasted": sum(g_["size"] * (len(g_["files"]) - 1) for g_ in groups), "count": len(groups)}


@bp.post("/api/storage/dupes")
def dupes():
    d = request.get_json(silent=True) or {}
    min_size = max(0, int(float(d.get("min_mb") or 1) * 1024 ** 2))
    run_bg("dupes", find_dupes, [r for r in d.get("roots") or []], min_size)
    return jsonify(ok=True)


@bp.get("/api/storage/dupes")
def dupes_result():
    with _lock:
        return jsonify(_state["dupes"])


@bp.post("/api/storage/delete")
def delete():
    items = (request.get_json(silent=True) or {}).get("items", [])
    freed = 0
    for it in items:
        try:
            p = roots.resolve(it["root"], it["path"])
            freed += os.path.getsize(p) if os.path.isfile(p) else 0
            to_trash(it["root"], it["path"])
        except (ValueError, OSError) as e:
            raise ValueError(f"{it.get('path')} : {e}") from None
    with _lock:  # retire les fichiers supprimés des résultats affichés
        res = _state["dupes"].get("result")
        if res:
            gone = {(i["root"], i["path"]) for i in items}
            for grp in res["groups"]:
                grp["files"] = [f for f in grp["files"] if (f["root"], f["path"]) not in gone]
            res["groups"] = [grp for grp in res["groups"] if len(grp["files"]) > 1]
    try:
        import files
        files.invalidate()
    except Exception:  # noqa: BLE001
        pass
    return jsonify(freed=freed, count=len(items))


# --- Rangement --------------------------------------------------------------------

def exif_date(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            ex = im.getexif()
            raw = ex.get_ifd(0x8769).get(36867) or ex.get(306)
            model = ex.get(272)
        if raw:
            return datetime.strptime(str(raw)[:19], "%Y:%m:%d %H:%M:%S"), model
    except Exception:  # noqa: BLE001
        pass
    return None, None


def plan_tidy(root_id, rel, recursive, read_docs, user):
    base = roots.resolve(root_id, rel)
    if not os.path.isdir(base):
        raise ValueError("Ce n'est pas un dossier")
    photo_root = next((r for r in roots.all_roots() if r["id"] == "photos"), None)
    paperasse_on = settings.enabled("paperasse")
    plan = []
    seen = {}
    entries = []
    if recursive:
        for dirpath, _, filenames in walk(base):
            entries += [os.path.join(dirpath, f) for f in filenames]
    else:
        entries = [os.path.join(base, f) for f in sorted(os.listdir(base)) if not f.startswith(".") and os.path.isfile(os.path.join(base, f))]
    # les noms « copie » passent en dernier : en cas de doublon, c'est eux qu'on propose de supprimer
    copyish = re.compile(r"\(\d+\)|\bcop(y|ie)\b| - copie|\bcopy of\b", re.I)
    entries.sort(key=lambda p: (bool(copyish.search(os.path.basename(p))), p.lower()))
    total = len(entries) or 1
    in_place = lambda *parts: (root_id, "/".join(x for x in [rel.strip("/"), *parts] if x))  # noqa: E731

    def add(path, action, reason, group, dest=None, extra=None):
        st = os.stat(path)
        item = {"id": uuid.uuid4().hex[:8], "root": root_id, "path": roots.relative(root_id, path), "name": os.path.basename(path),
                "size": st.st_size, "action": action, "reason": reason, "group": group}
        if dest:
            item["dest_root"], item["dest_path"] = dest
            if os.path.dirname(os.path.realpath(path)) == os.path.realpath(roots.resolve(dest[0], dest[1], must_exist=False)):
                return  # déjà rangé au bon endroit
        item.update(extra or {})
        plan.append(item)

    for i, path in enumerate(entries):
        if i % 25 == 0:
            progress("tidy", progress=round(i * 100 / total), step=f"{i} / {total} fichiers")
        name = os.path.basename(path)
        low = name.lower()
        ext = os.path.splitext(low)[1].lstrip(".")
        try:
            st = os.stat(path)
        except OSError:
            continue
        if ext in TEMP_EXT or low.startswith(("~$", ".~lock")):
            add(path, "delete", "Fichier temporaire ou téléchargement interrompu", "À supprimer")
            continue
        if st.st_size == 0:
            add(path, "delete", "Fichier vide", "À supprimer")
            continue
        key = (st.st_size, None)
        if st.st_size > 4096:
            try:
                key = (st.st_size, quick_hash(path, st.st_size))
            except OSError:
                pass
            if key in seen:
                add(path, "delete", f"Copie identique de « {os.path.basename(seen[key])} »", "À supprimer")
                continue
            seen[key] = path
        grp = group_of(name)
        age_days = (time.time() - st.st_mtime) / 86400
        if grp == "app":
            if age_days > 180:
                add(path, "delete", f"Installateur téléchargé il y a {int(age_days // 30)} mois", "À supprimer")
            else:
                add(path, "move", "Installateur de logiciel", "Installateurs", in_place("Installateurs"))
        elif grp == "archive":
            stem = re.sub(r"\.(tar\.gz|tar\.xz|tgz|zip|rar|7z|tar|gz|iso)$", "", name, flags=re.I)
            if os.path.isdir(os.path.join(os.path.dirname(path), stem)):
                add(path, "delete", f"Déjà décompressée dans « {stem} »", "À supprimer")
            else:
                add(path, "move", "Archive compressée", "Archives", in_place("Archives"))
        elif grp == "photo":
            when, model = exif_date(path) if ext in ("jpg", "jpeg", "heic", "heif", "tif", "tiff", "dng", "png") else (None, None)
            if re.search(r"screenshot|capture d.?[ée]cran|capture_|screen ?shot|^scr_", low):
                add(path, "move", "Capture d'écran", "Captures d'écran", in_place("Images", "Captures d'écran"))
            elif when and photo_root:
                add(path, "move", f"Photo du {when.strftime('%d/%m/%Y')}" + (f" ({model})" if model else ""), "Album photo",
                    ("photos", f"{when:%Y}/{when:%Y-%m}"))
            elif when:
                add(path, "move", f"Photo du {when.strftime('%d/%m/%Y')}", "Photos", in_place("Photos", f"{when:%Y}"))
            else:
                add(path, "move", "Image", "Images", in_place("Images"))
        elif grp == "video":
            m = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
            if m and re.match(r"^(vid|pxl|img|mov|video)[_-]?", low) and photo_root:
                add(path, "move", f"Vidéo de téléphone du {m.group(3)}/{m.group(2)}/{m.group(1)}", "Album photo", ("photos", f"{m.group(1)}/{m.group(1)}-{m.group(2)}"))
            else:
                add(path, "move", "Vidéo", "Vidéos", in_place("Vidéos"))
        elif grp == "audio":
            add(path, "move", "Musique ou audio", "Musique", in_place("Musique"))
        elif grp == "doc":
            info = None
            if read_docs and ext in ("pdf", "docx", "odt", "txt"):
                progress("tidy", step=f"Lecture de « {name} »")
                info = doctype.analyze(doctype.quick_text(path) if ext == "pdf" else doctype.text_of(path, ocr=False), name)
            if info and info["category"] != "Autres" and info["score"] >= 6 and paperasse_on and ext == "pdf":
                desc = ", ".join(x for x in (info["issuer"], info["date"] and datetime.fromisoformat(info["date"]).strftime("%d/%m/%Y")) if x)
                add(path, "paperasse", f"Ressemble à : {info['type']}" + (f" ({desc})" if desc else ""), "Paperasse",
                    extra={"category": info["category"]})
            elif info and info["category"] != "Autres" and info["score"] >= 6:
                add(path, "move", f"{info['type']}", f"Documents / {info['category']}", in_place("Documents", info["category"]))
            else:
                add(path, "move", "Document", "Documents", in_place("Documents"))
        elif age_days > 3 * 365 and st.st_size > 500 * 1024 ** 2:
            add(path, "info", f"Gros fichier pas modifié depuis {int(age_days // 365)} ans", "À vérifier")
    # dossiers vides
    for dirpath, dirnames, filenames in os.walk(base, topdown=False):
        if dirpath != base and not os.listdir(dirpath) and os.path.basename(dirpath) not in SKIP:
            plan.append({"id": uuid.uuid4().hex[:8], "root": root_id, "path": roots.relative(root_id, dirpath), "name": os.path.basename(dirpath),
                         "size": 0, "action": "rmdir", "reason": "Dossier vide", "group": "À supprimer"})
        if not recursive:
            break
    return {"root": root_id, "path": rel, "items": plan, "user": user}


@bp.post("/api/storage/tidy")
def tidy():
    d = request.get_json(silent=True) or {}
    roots.get(d.get("root"))
    run_bg("tidy", plan_tidy, d.get("root"), str(d.get("path") or "").strip("/"), bool(d.get("recursive")), bool(d.get("read_docs", True)), g.user["name"])
    return jsonify(ok=True)


@bp.get("/api/storage/tidy")
def tidy_result():
    with _lock:
        return jsonify(_state["tidy"])


@bp.post("/api/storage/tidy/apply")
def tidy_apply():
    ids = set((request.get_json(silent=True) or {}).get("ids", []))
    with _lock:
        res = _state["tidy"].get("result")
    if not res:
        raise ValueError("Lance d'abord une analyse")
    undo, done, errors = [], 0, []
    for it in [i for i in res["items"] if i["id"] in ids]:
        try:
            src = roots.resolve(it["root"], it["path"])
            if it["action"] == "move":
                dest_dir = roots.resolve(it["dest_root"], it["dest_path"], must_exist=False)
                os.makedirs(dest_dir, exist_ok=True)
                dest = unique_path(dest_dir, os.path.basename(src))
                shutil.move(src, dest)
                undo.append({"from": dest, "to": src})
            elif it["action"] == "delete":
                to_trash(it["root"], it["path"])
            elif it["action"] == "rmdir":
                os.rmdir(src)
            elif it["action"] == "paperasse":
                import paperasse
                paperasse.ingest_file(src, g.user["name"], "rangement")
            else:
                continue
            it["applied"] = True
            done += 1
        except (OSError, ValueError) as e:
            errors.append(f"{it['name']} : {e}")
    store.save(f"storage/undo-{g.user['name']}", {"at": time.time(), "moves": undo})
    try:
        import files
        files.invalidate()
    except Exception:  # noqa: BLE001
        pass
    if done:
        activity.log(g.user["name"], "stockage", f"Rangement : {done} élément{'s' if done > 1 else ''} rangé{'s' if done > 1 else ''}", "#/stockage/rangement", push=False)
    return jsonify(done=done, errors=errors[:20], undo=len(undo))


@bp.post("/api/storage/tidy/undo")
def tidy_undo():
    log = store.load(f"storage/undo-{g.user['name']}", {"moves": []})
    n = 0
    bases = {os.path.realpath(r["path"]) for r in roots.all_roots()}
    for m in reversed(log["moves"]):
        if os.path.exists(m["from"]) and not os.path.exists(m["to"]):
            os.makedirs(os.path.dirname(m["to"]), exist_ok=True)
            shutil.move(m["from"], m["to"])
            n += 1
            parent = os.path.dirname(m["from"])
            try:  # supprime les dossiers créés par le rangement s'ils sont redevenus vides
                while parent and os.path.realpath(parent) not in bases and not os.listdir(parent):
                    os.rmdir(parent)
                    parent = os.path.dirname(parent)
            except OSError:
                pass
    store.save(f"storage/undo-{g.user['name']}", {"moves": []})
    return jsonify(restored=n)
