"""Pont Python du serveur Bêta : appareils dont la seule bonne bibliothèque est en Python.

- HomePod / Apple TV : pyatv (local, AirPlay / Companion)
- Roborock : python-roborock (compte Roborock, code reçu par e-mail)

Petit serveur HTTP (port 8099) appelé uniquement par le serveur Bêta, protégé par la même clé BETA_KEY.
Les identifiants (jetons Roborock, appairages Apple) sont gardés dans /data.
"""

import asyncio
import json
import os
from pathlib import Path

from aiohttp import web

KEY = os.environ.get("BETA_KEY", "")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
DATA.mkdir(parents=True, exist_ok=True)


def ok(data=None):
    return web.json_response(data if data is not None else {"ok": True})


def fail(msg, code=400):
    return web.json_response({"error": str(msg)}, status=code)


@web.middleware
async def guard(request, handler):
    if request.path != "/health" and KEY and request.headers.get("X-Beta-Key") != KEY:
        return fail("clé invalide", 401)
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except Exception as e:  # message lisible renvoyé à Bêta OS
        return fail(e, 500)


# ======================= HomePod / Apple TV (pyatv) =======================
import pyatv
from pyatv.const import DeviceState, Protocol
from pyatv.storage.file_storage import FileStorage

ATV = {"confs": {}, "conns": {}, "pairing": {}, "storage": None}


async def storage():
    if ATV["storage"] is None:
        ATV["storage"] = FileStorage(str(DATA / "pyatv.json"), asyncio.get_running_loop())
        await ATV["storage"].load()
    return ATV["storage"]


async def find(ident, hosts=None):
    if ident in ATV["confs"]:
        return ATV["confs"][ident]
    found = await pyatv.scan(asyncio.get_running_loop(), timeout=5, identifier=ident, hosts=hosts, storage=await storage())
    if not found:
        raise RuntimeError("appareil Apple introuvable sur le réseau")
    ATV["confs"][ident] = found[0]
    return found[0]


async def conn(ident):
    a = ATV["conns"].get(ident)
    if a is not None:
        return a
    a = await pyatv.connect(await find(ident), asyncio.get_running_loop(), storage=await storage())
    ATV["conns"][ident] = a
    return a


def drop(ident):
    a = ATV["conns"].pop(ident, None)
    if a is not None:
        a.close()


def apple_kind(conf):
    model = str(conf.device_info.model)
    return "speaker" if "HomePod" in model or "AirPort" in model else "tv"


async def homepod_scan(request):
    body = await request.json() if request.can_read_body else {}
    hosts = [h.strip() for h in str(body.get("hosts") or "").split(",") if h.strip()] or None
    found = await pyatv.scan(asyncio.get_running_loop(), timeout=6, hosts=hosts, storage=await storage())
    out = []
    for c in found:
        ATV["confs"][c.identifier] = c
        out.append({"id": c.identifier, "name": c.name, "address": str(c.address), "model": str(c.device_info.model).replace("DeviceModel.", ""), "kind": apple_kind(c)})
    return ok(out)


async def homepod_pair_start(request):
    b = await request.json()
    conf = await find(b["id"])
    proto = Protocol.AirPlay if b.get("protocol", "airplay") == "airplay" else Protocol.Companion
    h = await pyatv.pair(conf, proto, asyncio.get_running_loop(), storage=await storage())
    await h.begin()
    ATV["pairing"][b["id"]] = h
    return ok({"pin": h.device_provides_pin})


async def homepod_pair_finish(request):
    b = await request.json()
    h = ATV["pairing"].pop(b["id"], None)
    if h is None:
        raise RuntimeError("aucun appairage en cours")
    if b.get("pin"):
        h.pin(int(b["pin"]))
    await h.finish()
    await h.close()
    if not h.has_paired:
        raise RuntimeError("appairage refusé (code incorrect ?)")
    await (await storage()).save()
    drop(b["id"])
    return ok()


async def homepod_state(ident):
    try:
        a = await conn(ident)
        p = await a.metadata.playing()
        s = {"on": p.device_state in (DeviceState.Playing, DeviceState.Loading), "src": " — ".join(x for x in (p.title, p.artist) if x) or "—"}
        try:
            s["vol"] = round(a.audio.volume)
        except Exception:
            pass
        return s
    except Exception as e:
        drop(ident)
        return {"error": str(e)}


async def homepod_states(request):
    ids = [i for i in request.query.get("ids", "").split(",") if i]
    res = await asyncio.gather(*(homepod_state(i) for i in ids))
    return ok(dict(zip(ids, res)))


async def homepod_command(request):
    b = await request.json()
    a, p = await conn(b["id"]), b.get("patch") or {}
    try:
        if "vol" in p:
            await a.audio.set_volume(float(p["vol"]))
        if "on" in p:
            await (a.remote_control.play() if p["on"] else a.remote_control.pause())
    except Exception:
        drop(b["id"])
        raise
    return ok()


# ======================= Roborock (python-roborock) =======================
from roborock.data import UserData
from roborock.devices.device_manager import UserParams, create_device_manager
from roborock.web_api import RoborockApiClient

RR_FILE = DATA / "roborock.json"
RR = {"client": None, "manager": None}
RR_STATE = {5: "cleaning", 7: "cleaning", 11: "cleaning", 16: "cleaning", 17: "cleaning", 18: "cleaning", 6: "returning", 15: "returning", 10: "paused"}


async def rr_manager():
    if RR["manager"] is None:
        if not RR_FILE.exists():
            raise RuntimeError("compte Roborock non relié : demandez un code puis connectez-vous")
        saved = json.loads(RR_FILE.read_text())
        params = UserParams(username=saved["email"], user_data=UserData.from_dict(saved["user_data"]), base_url=saved.get("base_url"))
        RR["manager"] = await create_device_manager(params)
    return RR["manager"]


async def roborock_code(request):
    b = await request.json()
    RR["client"] = RoborockApiClient(username=b["email"])
    await RR["client"].request_code()
    return ok()


async def roborock_login(request):
    b = await request.json()
    client = RR["client"] if RR["client"] and RR["client"]._username == b["email"] else RoborockApiClient(username=b["email"])
    user_data = await client.code_login(str(b["code"]).strip())
    RR_FILE.write_text(json.dumps({"email": b["email"], "user_data": user_data.as_dict(), "base_url": await client.base_url}))
    os.chmod(RR_FILE, 0o600)
    if RR["manager"] is not None:
        await RR["manager"].close()
    RR["manager"] = None
    return ok()


async def roborock_devices(request):
    m = await rr_manager()
    out = []
    for d in await m.get_devices():
        item = {"id": d.duid, "name": d.name, "model": d.product.model, "state": {}}
        props = d.v1_properties
        if props is None:
            item["error"] = "modèle pas encore pris en charge"
        else:
            try:
                await props.status.refresh()
                st = props.status
                code = int(st.state) if st.state is not None else None
                item["state"] = {"status": RR_STATE.get(code, "docked"), "bat": st.battery}
            except Exception as e:
                item["error"] = str(e)
        out.append(item)
    return ok(out)


async def roborock_command(request):
    b = await request.json()
    d = await (await rr_manager()).get_device(b["id"])
    if d is None or d.v1_properties is None:
        raise RuntimeError("aspirateur introuvable ou non pris en charge")
    status = (b.get("patch") or {}).get("status")
    cmd = {"cleaning": "app_start", "returning": "app_charge", "docked": "app_charge", "paused": "app_pause"}.get(status)
    if cmd:
        await d.v1_properties.command.send(cmd)
    return ok()


async def health(request):
    return ok({"ok": True, "name": "Pont Python Bêta"})


app = web.Application(middlewares=[guard])
app.add_routes([
    web.get("/health", health),
    web.post("/homepod/scan", homepod_scan),
    web.post("/homepod/pair/start", homepod_pair_start),
    web.post("/homepod/pair/finish", homepod_pair_finish),
    web.get("/homepod/states", homepod_states),
    web.post("/homepod/command", homepod_command),
    web.post("/roborock/code", roborock_code),
    web.post("/roborock/login", roborock_login),
    web.get("/roborock/devices", roborock_devices),
    web.post("/roborock/command", roborock_command),
])

if __name__ == "__main__":
    if not KEY:
        print("⚠️  BETA_KEY n’est pas défini : le pont Python est ouvert à tout le réseau.")
    web.run_app(app, port=int(os.environ.get("PORT", "8099")))
