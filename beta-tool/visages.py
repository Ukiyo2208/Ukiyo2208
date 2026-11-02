"""Album photo intelligent : les visages et « il y a un an ».

Visages : repérés dans les photos par OpenCV (détecteur LBP fourni avec Bêta Tool), puis reconnus
grâce aux noms que tu donnes (modèle LBPH entraîné sur le NAS). Plus tu nommes de visages, plus les
suggestions sont justes. Aucune photo ne quitte le NAS, aucun modèle n'est téléchargé.

Il y a un an : les photos prises le même jour les années précédentes."""

import os
import threading
import time
import uuid
from datetime import date, datetime

from flask import Blueprint, jsonify, request, send_file

import roots
import store

bp = Blueprint("visages", __name__)
DIR = store.path("visages")
CASCADE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "lbpcascade_frontalface.xml")
SIZE = 120
THRESH = float(os.environ.get("FACE_THRESHOLD", "72"))  # distance LBPH en dessous de laquelle on propose un nom
_state = {"running": False, "done": 0, "total": 0, "error": None}
_lock = threading.Lock()
_model = {"rec": None, "at": 0, "labels": {}}
EMPTY = {"faces": [], "people": [], "scanned": {}}


def available():
    try:
        import cv2
        return hasattr(cv2, "face") and os.path.exists(CASCADE)
    except ImportError:
        return False


def load():
    d = store.load("visages", EMPTY)
    for k, v in EMPTY.items():
        d.setdefault(k, type(v)())
    return d


def _detector():
    import cv2
    c = cv2.CascadeClassifier(CASCADE)
    if c.empty():
        raise RuntimeError("Détecteur de visages illisible")
    return c


def detect(path):
    """[(boîte x, y, w, h dans l'image d'origine, visage gris SIZE×SIZE, vignette couleur)] d'une photo."""
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
    scale = min(1.0, 1100 / max(im.size))
    small = im.resize((int(im.width * scale), int(im.height * scale))) if scale < 1 else im
    gray = cv2.equalizeHist(cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2GRAY))
    boxes = _detector().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(max(40, int(min(small.size) * .06)),) * 2)
    out = []
    for (x, y, w, h) in boxes:
        m = int(w * .18)
        x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(small.width, x + w + m), min(small.height, y + h + m)
        face = cv2.resize(gray[y:y + h, x:x + w], (SIZE, SIZE))
        thumb = small.crop((x0, y0, x1, y1)).resize((160, 160))
        out.append(([int(v / scale) for v in (x, y, w, h)], face, thumb))
    return out


def _photos():
    return [p for p in store.load("photos-index", []) if not p.get("video")]


def scan(limit=400):
    """Analyse les photos pas encore vues (par paquets, en arrière-plan)."""
    import cv2
    try:
        base = os.path.realpath(roots.get("photos")["path"])
    except ValueError:
        return 0
    d = load()
    todo = [p for p in _photos() if d["scanned"].get(p["path"]) != p["mtime"]][:limit]
    _state.update(total=len(todo), done=0)
    os.makedirs(DIR, exist_ok=True)
    new_faces, scanned = [], {}
    for i, p in enumerate(todo):
        try:
            found = detect(os.path.join(base, p["path"]))
        except Exception:  # noqa: BLE001
            found = []
        for box, face, thumb in found:
            fid = uuid.uuid4().hex[:10]
            cv2.imwrite(os.path.join(DIR, fid + "-g.png"), face)
            thumb.save(os.path.join(DIR, fid + ".jpg"), "JPEG", quality=85)
            new_faces.append({"id": fid, "photo": p["path"], "taken": p["taken"], "box": box, "person": None, "rejected": [], "ignored": False})
        scanned[p["path"]] = p["mtime"]
        _state["done"] = i + 1
        if i % 25 == 24:
            time.sleep(.2)

    def go(x):
        gone = {f["photo"] for f in x["faces"]} & set(scanned)
        x["faces"] = [f for f in x["faces"] if f["photo"] not in gone or f["person"]] + new_faces
        x["scanned"].update(scanned)
    store.update("visages", EMPTY, go)
    if new_faces:
        suggest()
    return len(new_faces)


def _train(d):
    import cv2
    import numpy as np
    labeled = [f for f in d["faces"] if f.get("person") and not f.get("ignored")]
    people = sorted({f["person"] for f in labeled})
    if not labeled:
        _model.update(rec=None, labels={})
        return None
    idx = {pid: i for i, pid in enumerate(people)}
    imgs, labels = [], []
    for f in labeled:
        g = cv2.imread(os.path.join(DIR, f["id"] + "-g.png"), cv2.IMREAD_GRAYSCALE)
        if g is not None:
            imgs.append(g)
            labels.append(idx[f["person"]])
            imgs.append(cv2.flip(g, 1))  # miroir : double les exemples
            labels.append(idx[f["person"]])
    if not imgs:
        return None
    rec = cv2.face.LBPHFaceRecognizer_create(radius=1, neighbors=8, grid_x=8, grid_y=8)
    rec.train(imgs, np.array(labels))
    _model.update(rec=rec, labels={i: pid for pid, i in idx.items()}, at=time.time())
    return rec


def suggest():
    """Propose un nom pour chaque visage inconnu proche d'un visage déjà nommé."""
    import cv2
    with _lock:
        d = load()
        rec = _train(d)
        if not rec:
            return 0
        sugg = {}
        for f in d["faces"]:
            if f.get("person") or f.get("ignored"):
                continue
            g = cv2.imread(os.path.join(DIR, f["id"] + "-g.png"), cv2.IMREAD_GRAYSCALE)
            if g is None:
                continue
            label, dist = rec.predict(g)
            pid = _model["labels"].get(int(label))
            sugg[f["id"]] = {"person": pid, "dist": round(float(dist), 1)} if pid and dist < THRESH and pid not in f.get("rejected", []) else None

        def go(x):
            for f in x["faces"]:
                if f["id"] in sugg:
                    f["suggestion"] = sugg[f["id"]]
        store.update("visages", EMPTY, go)
        return sum(1 for v in sugg.values() if v)


def run_async():
    with _lock:
        if _state["running"] or not available():
            return
        _state["running"] = True

    def go():
        try:
            scan()
            _state["error"] = None
        except Exception as e:  # noqa: BLE001
            _state["error"] = str(e)[:200]
        finally:
            _state["running"] = False
    threading.Thread(target=go, daemon=True).start()


def loop():
    while True:
        time.sleep(1800)
        if store.load("visages-reglages", {}).get("on"):
            run_async()


def start():
    import journee
    journee.SOURCES["memories"] = ("photos", brief)
    threading.Thread(target=loop, daemon=True).start()


# --- Il y a un an ---------------------------------------------------------------------------------------------------

def memories(day=None):
    day = day or date.today()
    out = {}
    for p in store.load("photos-index", []):
        t = datetime.fromtimestamp(p["taken"])
        if t.month == day.month and t.day == day.day and t.year < day.year:
            out.setdefault(t.year, []).append(p["path"])
    return [{"year": y, "ago": day.year - y, "photos": ps[:24], "count": len(ps)} for y, ps in sorted(out.items(), reverse=True)]


def brief(user, today):
    m = memories(today)
    if not m:
        return None
    return [{"ago": x["ago"], "year": x["year"], "count": x["count"], "photos": x["photos"][:4]} for x in m[:3]]


# --- Routes ---------------------------------------------------------------------------------------------------------

def _person_public(p, faces):
    mine = [f for f in faces if f.get("person") == p["id"]]
    cover = next((f for f in mine if f["id"] == p.get("cover")), mine[0] if mine else None)
    return {"id": p["id"], "name": p["name"], "count": len({f["photo"] for f in mine}), "cover": cover["id"] if cover else None}


@bp.get("/api/photos/people")
def people():
    d = load()
    unknown = [f for f in d["faces"] if not f.get("person") and not f.get("ignored")]
    unknown.sort(key=lambda f: (f.get("suggestion") is None, (f.get("suggestion") or {}).get("dist", 999), -f.get("taken", 0)))
    return jsonify(available=available(), on=bool(store.load("visages-reglages", {}).get("on")), state=_state,
                   people=sorted([_person_public(p, d["faces"]) for p in d["people"]], key=lambda p: -p["count"]),
                   unknown=[{k: f.get(k) for k in ("id", "photo", "suggestion")} for f in unknown[:120]], unknown_total=len(unknown),
                   scanned=len(d["scanned"]), photos=len(_photos()))


@bp.put("/api/photos/people/settings")
def people_settings():
    on = bool((request.get_json(force=True) or {}).get("on"))
    store.save("visages-reglages", {"on": on})
    if on:
        run_async()
    return jsonify(on=on)


@bp.post("/api/photos/people/scan")
def scan_now():
    if not available():
        raise ValueError("La reconnaissance des visages demande OpenCV (installé avec la mise à jour)")
    run_async()
    return jsonify(state=_state)


@bp.get("/api/photos/people/<pid>")
def person(pid):
    d = load()
    p = next((x for x in d["people"] if x["id"] == pid), None)
    if not p:
        raise ValueError("Personne introuvable")
    photos = sorted({(f["photo"], f.get("taken", 0)) for f in d["faces"] if f.get("person") == pid}, key=lambda x: -x[1])
    return jsonify(person=_person_public(p, d["faces"]), photos=[x[0] for x in photos],
                   suggestions=[f["id"] for f in d["faces"] if not f.get("person") and (f.get("suggestion") or {}).get("person") == pid][:60])


@bp.post("/api/photos/faces/<fid>")
def name_face(fid):
    """{name} ou {person} : nommer ; {ignore: true} : pas un visage ; {reject: true} : refuser la suggestion."""
    f = request.get_json(force=True)
    out = {}

    def go(d):
        face = next((x for x in d["faces"] if x["id"] == fid), None)
        if not face:
            raise ValueError("Visage introuvable")
        if f.get("ignore"):
            face["ignored"], face["person"] = True, None
        elif f.get("reject"):
            if face.get("suggestion"):
                face.setdefault("rejected", []).append(face["suggestion"]["person"])
            face["suggestion"] = None
        else:
            pid = f.get("person")
            if not pid and str(f.get("name") or "").strip():
                name = str(f["name"]).strip()[:60]
                p = next((x for x in d["people"] if x["name"].lower() == name.lower()), None)
                if not p:
                    p = {"id": uuid.uuid4().hex[:8], "name": name, "cover": fid}
                    d["people"].append(p)
                pid = p["id"]
            if not pid:
                raise ValueError("Donne un nom")
            face["person"], face["suggestion"], face["ignored"] = pid, None, False
            out["person"] = pid
    store.update("visages", EMPTY, go)
    threading.Thread(target=suggest, daemon=True).start()
    return jsonify(ok=True, **out)


@bp.post("/api/photos/people/<pid>/accept")
def accept_all(pid):
    ids = set((request.get_json(force=True) or {}).get("faces") or [])

    def go(d):
        for f in d["faces"]:
            if not f.get("person") and (f.get("suggestion") or {}).get("person") == pid and (not ids or f["id"] in ids):
                f["person"], f["suggestion"] = pid, None
    store.update("visages", EMPTY, go)
    threading.Thread(target=suggest, daemon=True).start()
    return jsonify(ok=True)


@bp.put("/api/photos/people/<pid>")
def edit_person(pid):
    f = request.get_json(force=True)

    def go(d):
        p = next((x for x in d["people"] if x["id"] == pid), None)
        if not p:
            raise ValueError("Personne introuvable")
        if f.get("merge"):  # fusionner dans une autre personne
            for face in d["faces"]:
                if face.get("person") == pid:
                    face["person"] = f["merge"]
            d["people"].remove(p)
            return
        if f.get("name"):
            p["name"] = str(f["name"]).strip()[:60]
        if f.get("cover"):
            p["cover"] = f["cover"]
    store.update("visages", EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/photos/people/<pid>")
def del_person(pid):
    def go(d):
        d["people"] = [x for x in d["people"] if x["id"] != pid]
        for f in d["faces"]:
            if f.get("person") == pid:
                f["person"] = None
    store.update("visages", EMPTY, go)
    return jsonify(ok=True)


@bp.get("/api/photos/faces/<fid>.jpg")
def face_img(fid):
    path = os.path.join(DIR, "".join(c for c in fid if c.isalnum()) + ".jpg")
    if not os.path.exists(path):
        return jsonify(error="Introuvable"), 404
    return send_file(path, mimetype="image/jpeg", max_age=86400 * 30)


@bp.get("/api/photos/memories")
def memories_route():
    return jsonify(memories=memories())
