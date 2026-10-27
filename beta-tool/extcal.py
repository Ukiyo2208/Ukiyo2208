"""Agendas raccordés à l'outil Agenda : iCloud et serveurs CalDAV (Nextcloud, Synology, Fastmail…),
Google Agenda, Outlook / Microsoft 365, et abonnements .ics (lecture seule).

Les événements ne sont pas copiés : ils sont lus chez le fournisseur (avec un court cache) et
les modifications faites dans Bêta Tool y sont écrites directement."""

import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urljoin

import requests
import xml.etree.ElementTree as ET

import accounts
import agenda

GRAPH = os.environ.get("GRAPH_URL", "https://graph.microsoft.com/v1.0").rstrip("/")
GAPI = os.environ.get("GOOGLE_API_URL", "https://www.googleapis.com/calendar/v3").rstrip("/")
NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav", "a": "http://apple.com/ns/ical/", "cs": "http://calendarserver.org/ns/"}
UA = {"User-Agent": "BetaTool/2 (+agenda)"}
_cache = {}  # (calendrier, début, fin) → (heure, événements)
_ics = {}  # url → (heure, texte)
_errors = {}  # calendrier → dernière erreur
_lock = threading.Lock()


def cal_id(acc, c):
    return f"x-{acc['id']}-{c['id']}"


def _short(s):
    import hashlib
    return hashlib.sha1(s.encode()).hexdigest()[:8]


# --- CalDAV ---------------------------------------------------------------------------

def _dav(acc, method, url, body=None, depth=None, headers=None):
    h = {**UA, "Content-Type": "application/xml; charset=utf-8"}
    if depth is not None:
        h["Depth"] = str(depth)
    h.update(headers or {})
    user = acc.get("username") or acc.get("email")
    try:
        r = requests.request(method, url, data=body.encode() if isinstance(body, str) else body, headers=h,
                             auth=(user, accounts.secret(acc).get("password", "")), timeout=30, allow_redirects=False)
        for _ in range(3):  # suit les redirections en gardant la méthode (PROPFIND…)
            if r.status_code in (301, 302, 307, 308) and r.headers.get("Location"):
                url = urljoin(url, r.headers["Location"])
                r = requests.request(method, url, data=body.encode() if isinstance(body, str) else body, headers=h,
                                     auth=(user, accounts.secret(acc).get("password", "")), timeout=30, allow_redirects=False)
    except requests.RequestException as e:
        raise ValueError(f"Serveur d'agenda injoignable ({e.__class__.__name__})") from None
    if r.status_code == 401:
        raise ValueError("Identifiant ou mot de passe refusé" + (" (il faut un mot de passe d'application)" if acc["provider"] == "icloud" else ""))
    return r, url


def _propfind(acc, url, props, depth=0):
    body = f'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/"><d:prop>{props}</d:prop></d:propfind>'
    r, url = _dav(acc, "PROPFIND", url, body, depth)
    if r.status_code != 207:
        raise ValueError(f"Le serveur d'agenda ne répond pas en CalDAV ({r.status_code}) : vérifie l'adresse")
    return ET.fromstring(r.content), url


def _href(root, path, base):
    el = root.find(path, NS)
    return urljoin(base, el.text.strip()) if el is not None and el.text else None


def discover_caldav(acc):
    base = acc["cal"]["url"]
    try:
        root, base = _propfind(acc, base, "<d:current-user-principal/>")
    except ValueError:
        root, base = _propfind(acc, urljoin(base, "/.well-known/caldav"), "<d:current-user-principal/>")
    principal = _href(root, ".//d:current-user-principal/d:href", base) or base
    root, principal = _propfind(acc, principal, "<c:calendar-home-set/>")
    home = _href(root, ".//c:calendar-home-set/d:href", principal) or principal
    root, home = _propfind(acc, home, "<d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/>", 1)
    out = []
    for resp in root.findall("d:response", NS):
        href = urljoin(home, resp.findtext("d:href", "", NS))
        prop = resp.find(".//d:prop", NS)
        if prop is None or prop.find("d:resourcetype/c:calendar", NS) is None:
            continue
        comps = [c.get("name") for c in prop.findall("c:supported-calendar-component-set/c:comp", NS)]
        if comps and "VEVENT" not in comps:
            continue  # listes de rappels iCloud…
        privs = [p.tag.split("}")[-1] for p in prop.findall("d:current-user-privilege-set/d:privilege/*", NS)]
        color = (prop.findtext("a:calendar-color", "", NS) or "")[:7]
        out.append({"id": _short(href), "href": href, "name": prop.findtext("d:displayname", "", NS) or href.rstrip("/").rsplit("/", 1)[-1],
                    "color": color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else None,
                    "ro": bool(privs) and not ({"write", "write-content", "all", "bind"} & set(privs)), "on": True})
    if not out:
        raise ValueError("Aucun agenda trouvé sur ce compte")
    return out


def caldav_events(acc, c, start, end):
    fmt = lambda d: d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    s, e = start.replace(tzinfo=agenda.LOCAL_TZ), end.replace(tzinfo=agenda.LOCAL_TZ)
    body = f"""<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
<c:time-range start="{fmt(s)}" end="{fmt(e)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"""
    r, _ = _dav(acc, "REPORT", c["href"], body, 1)
    if r.status_code != 207:
        raise ValueError(f"Lecture de l'agenda impossible ({r.status_code})")
    vobject = agenda._vobj()
    out = []
    for resp in ET.fromstring(r.content).findall("d:response", NS):
        href = urljoin(c["href"], resp.findtext("d:href", "", NS))
        data = resp.findtext(".//c:calendar-data", "", NS)
        if not data:
            continue
        try:
            cal = vobject.readOne(data)
        except Exception:  # noqa: BLE001
            continue
        out += _expand(cal, start, end, href)
    return out


def _expand(cal, start, end, ref):
    out = []
    evs = list(getattr(cal, "vevent_list", []))
    overrides = {}
    for ev in evs:  # occurrences modifiées (RECURRENCE-ID)
        if hasattr(ev, "recurrence_id"):
            overrides[agenda.to_local(ev.recurrence_id.value) if isinstance(ev.recurrence_id.value, datetime) else
                      datetime.combine(ev.recurrence_id.value, datetime.min.time())] = ev
    for ev in evs:
        is_override = hasattr(ev, "recurrence_id")
        for s, e, allday in agenda.occurrences(ev, start, end):
            if not is_override and s in overrides:
                continue
            out.append({"ref": ref, "title": agenda.text(ev, "summary") or "(sans titre)", "start": s.isoformat(), "end": e.isoformat(),
                        "allday": allday, "location": agenda.text(ev, "location"), "notes": agenda.text(ev, "description"),
                        "recur": agenda.rrule_kind(ev) if not is_override else "", "reminder": agenda.reminder_of(ev)})
    return out


def caldav_write(acc, c, d, ref=None, orig_start=None):
    vobject = agenda._vobj()
    if ref:
        r, _ = _dav(acc, "GET", ref, headers={"Accept": "text/calendar"})
        if r.status_code != 200:
            raise ValueError("Événement introuvable chez le fournisseur (supprimé ?)")
        etag = r.headers.get("ETag")
        cal = vobject.readOne(r.content.decode("utf-8", "replace"))
        master = next((ev for ev in cal.vevent_list if not hasattr(ev, "recurrence_id")), cal.vevent_list[0])
        apply_fields(master, d, orig_start)
        data, url, hdr = cal.serialize(), ref, ({"If-Match": etag} if etag else {})
    else:
        uid, data = agenda.build_ics(d, by=None)
        url, hdr = c["href"].rstrip("/") + "/" + quote(re.sub(r"[^\w.@-]", "_", uid)) + ".ics", {"If-None-Match": "*"}
    r, _ = _dav(acc, "PUT", url, data, headers={**hdr, "Content-Type": "text/calendar; charset=utf-8"})
    if r.status_code == 412:
        raise ValueError("Cet événement a été modifié ailleurs entre-temps : recharge et recommence")
    if r.status_code not in (200, 201, 204):
        raise ValueError(f"Le fournisseur a refusé l'enregistrement ({r.status_code})")


def apply_fields(ev, d, orig_start):
    """Modifie un VEVENT existant en gardant le reste (invités, fuseau, exceptions…)."""
    from dateutil.tz import tzutc
    title = str(d.get("title") or "").strip()[:200]
    if not title:
        raise ValueError("Donne un titre à l'événement")
    s, e, allday = agenda.parse_range(d)
    recurring = hasattr(ev, "rrule")
    if recurring and orig_start and not allday and isinstance(ev.dtstart.value, datetime):
        # série : on décale toute la série du même écart que l'occurrence modifiée
        delta = s.replace(tzinfo=None) - datetime.fromisoformat(orig_start[:19])
        length = e - s
        ev.dtstart.value = ev.dtstart.value + delta
        new_end = ev.dtstart.value + length
    else:
        ev.dtstart.value = s if allday else s.astimezone(tzutc())
        new_end = e if allday else e.astimezone(tzutc())
        ev.dtstart.params.pop("TZID", None)
        ev.dtstart.params.pop("VALUE", None)
    if hasattr(ev, "duration"):
        ev.remove(ev.duration)
    if hasattr(ev, "dtend"):
        ev.dtend.value = new_end
        if not isinstance(new_end, datetime) or new_end.tzinfo == tzutc():
            ev.dtend.params.pop("TZID", None)
            ev.dtend.params.pop("VALUE", None)
    else:
        ev.add("dtend").value = new_end
    _set(ev, "summary", title)
    _set(ev, "location", str(d.get("location") or "")[:300])
    _set(ev, "description", str(d.get("notes") or "")[:5000])
    kind = agenda.rrule_kind(ev)
    want = d.get("recur") or ""
    if want in ("daily", "weekly", "monthly", "yearly") and want != kind:
        _set(ev, "rrule", f"FREQ={want.upper()}")
    elif not want and kind and kind != "custom":
        ev.remove(ev.rrule)
    for al in list(getattr(ev, "valarm_list", [])):
        ev.remove(al)
    if str(d.get("reminder") or "").strip() not in ("", "None"):
        al = ev.add("valarm")
        al.add("action").value = "DISPLAY"
        al.add("description").value = title
        al.add("trigger").value = timedelta(minutes=-int(d["reminder"]))
    seq = int(agenda.text(ev, "sequence") or 0) + 1
    _set(ev, "sequence", str(seq))
    _set(ev, "dtstamp", datetime.now(tzutc()))


def _set(ev, key, value):
    cur = getattr(ev, key.replace("-", "_"), None)
    if value in ("", None):
        if cur is not None:
            ev.remove(cur)
        return
    if cur is None:
        cur = ev.add(key)
    cur.value = value


def caldav_delete(acc, ref):
    r, _ = _dav(acc, "DELETE", ref)
    if r.status_code not in (200, 204, 404):
        raise ValueError(f"Le fournisseur a refusé la suppression ({r.status_code})")


# --- Liens .ics (abonnements, lecture seule) ----------------------------------------------

def ics_text(url, fresh=False):
    hit = _ics.get(url)
    if hit and not fresh and time.time() - hit[0] < 900:
        return hit[1]
    tries = [re.sub(r"^webcals?://", "https://", url), re.sub(r"^webcals?://", "http://", url)] if re.match(r"webcals?://", url) else [url]
    for i, u in enumerate(tries):  # webcal:// : https d'abord, puis http
        try:
            r = requests.get(u, headers=UA, timeout=30)
            break
        except requests.RequestException as e:
            if i == len(tries) - 1:
                raise ValueError(f"Lien injoignable ({e.__class__.__name__})") from None
    if r.status_code != 200 or "BEGIN:VCALENDAR" not in r.text[:2000]:
        raise ValueError(f"Ce lien ne renvoie pas un calendrier .ics ({r.status_code})")
    r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
    _ics[url] = (time.time(), r.text)
    return r.text


def ics_events(acc, start, end):
    vobject = agenda._vobj()
    try:
        cal = vobject.readOne(ics_text(acc["cal"]["url"]))
    except ValueError:
        raise
    except Exception:  # noqa: BLE001
        raise ValueError("Calendrier .ics illisible") from None
    return _expand(cal, start, end, "")


# --- Microsoft Graph (Outlook) ----------------------------------------------------------------

def _graph(acc, method, path, **kw):
    try:
        r = requests.request(method, path if path.startswith("http") else GRAPH + path, timeout=30,
                             headers={"Authorization": "Bearer " + accounts.token(acc, "ms_cal"), **UA, **kw.pop("headers", {})}, **kw)
    except requests.RequestException as e:
        raise ValueError(f"Outlook injoignable ({e.__class__.__name__})") from None
    if r.status_code >= 400:
        try:
            msg = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = str(r.status_code)
        raise ValueError(f"Outlook a refusé la demande : {msg}")
    return r.json() if r.content else {}


def _gtime(t):
    """{dateTime, timeZone} (UTC) → datetime local naïf."""
    v = datetime.fromisoformat(t["dateTime"][:19])
    return v.replace(tzinfo=timezone.utc).astimezone(agenda.LOCAL_TZ).replace(tzinfo=None) if (t.get("timeZone") or "UTC") == "UTC" else v


def graph_discover(acc):
    cals = _graph(acc, "GET", "/me/calendars?$top=100").get("value", [])
    return [{"id": _short(c["id"]), "gid": c["id"], "name": c.get("name") or "Agenda", "ro": not c.get("canEdit", True),
             "color": c.get("hexColor") if re.fullmatch(r"#[0-9a-fA-F]{6}", c.get("hexColor") or "") else None, "on": True} for c in cals]


def graph_events(acc, c, start, end):
    s = start.replace(tzinfo=agenda.LOCAL_TZ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    e = end.replace(tzinfo=agenda.LOCAL_TZ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = f"/me/calendars/{c['gid']}/calendarView?startDateTime={s}&endDateTime={e}&$top=500" \
          "&$select=id,subject,start,end,isAllDay,location,bodyPreview,seriesMasterId,type,isReminderOn,reminderMinutesBeforeStart,isCancelled"
    out = []
    while url and len(out) < 2000:
        page = _graph(acc, "GET", url, headers={"Prefer": 'outlook.timezone="UTC"'})
        for ev in page.get("value", []):
            if ev.get("isCancelled"):
                continue
            allday = ev.get("isAllDay")
            st, en = _gtime(ev["start"]), _gtime(ev["end"])
            if allday:
                st, en = datetime.fromisoformat(ev["start"]["dateTime"][:10]), datetime.fromisoformat(ev["end"]["dateTime"][:10])
            out.append({"ref": ev.get("seriesMasterId") or ev["id"], "title": ev.get("subject") or "(sans titre)", "start": st.isoformat(),
                        "end": en.isoformat(), "allday": bool(allday), "location": (ev.get("location") or {}).get("displayName", ""),
                        "notes": ev.get("bodyPreview", ""), "recur": "custom" if ev.get("seriesMasterId") else "",
                        "reminder": ev.get("reminderMinutesBeforeStart") if ev.get("isReminderOn") else None})
        url = page.get("@odata.nextLink")
    return out


def _graph_body(d, s, e, allday):
    fmt = lambda v: (v.strftime("%Y-%m-%dT00:00:00") if allday else v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"))
    body = {"subject": str(d.get("title") or "").strip()[:200], "isAllDay": allday,
            "start": {"dateTime": fmt(s), "timeZone": "UTC"}, "end": {"dateTime": fmt(e), "timeZone": "UTC"},
            "location": {"displayName": str(d.get("location") or "")[:300]}, "body": {"contentType": "text", "content": str(d.get("notes") or "")[:5000]}}
    rem = str(d.get("reminder") or "").strip()
    body["isReminderOn"] = rem not in ("", "None")
    if body["isReminderOn"]:
        body["reminderMinutesBeforeStart"] = int(rem)
    return body


def _recurrence(kind, s):
    day = s if isinstance(s, date) else s.date()
    pat = {"daily": {"type": "daily", "interval": 1}, "weekly": {"type": "weekly", "interval": 1, "daysOfWeek": [day.strftime("%A").lower()]},
           "monthly": {"type": "absoluteMonthly", "interval": 1, "dayOfMonth": day.day},
           "yearly": {"type": "absoluteYearly", "interval": 1, "dayOfMonth": day.day, "month": day.month}}[kind]
    return {"pattern": pat, "range": {"type": "noEnd", "startDate": day.isoformat()}}


def graph_write(acc, c, d, ref=None, orig_start=None):
    s, e, allday = agenda.parse_range(d)
    body = _graph_body(d, s, e, allday)
    if ref:
        cur = _graph(acc, "GET", f"/me/events/{ref}?$select=start,end,recurrence,type,isAllDay", headers={"Prefer": 'outlook.timezone="UTC"'})
        if cur.get("recurrence") and orig_start and not allday:  # série : décalage de toute la série
            delta = s.replace(tzinfo=None) - datetime.fromisoformat(orig_start[:19])
            ms = _gtime(cur["start"]) + delta
            ms_aware = ms.replace(tzinfo=agenda.LOCAL_TZ)
            body["start"] = {"dateTime": ms_aware.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}
            body["end"] = {"dateTime": (ms_aware + (e - s)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}
        elif d.get("recur") in ("daily", "weekly", "monthly", "yearly"):
            body["recurrence"] = _recurrence(d["recur"], s)
        elif not d.get("recur") and cur.get("recurrence") and d.get("recur") != "custom":
            body["recurrence"] = None
        _graph(acc, "PATCH", f"/me/events/{ref}", json=body)
    else:
        if d.get("recur") in ("daily", "weekly", "monthly", "yearly"):
            body["recurrence"] = _recurrence(d["recur"], s)
        _graph(acc, "POST", f"/me/calendars/{c['gid']}/events", json=body)


# --- Google Agenda ----------------------------------------------------------------------------

def _google(acc, method, path, **kw):
    try:
        r = requests.request(method, GAPI + path, timeout=30, headers={"Authorization": "Bearer " + accounts.token(acc, "google"), **UA}, **kw)
    except requests.RequestException as e:
        raise ValueError(f"Google Agenda injoignable ({e.__class__.__name__})") from None
    if r.status_code >= 400:
        try:
            msg = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = str(r.status_code)
        raise ValueError(f"Google a refusé la demande : {msg}")
    return r.json() if r.content else {}


def google_discover(acc):
    items = _google(acc, "GET", "/users/me/calendarList?maxResults=250").get("items", [])
    return [{"id": _short(c["id"]), "gid": c["id"], "name": c.get("summaryOverride") or c.get("summary") or "Agenda",
             "ro": c.get("accessRole") not in ("owner", "writer"), "color": c.get("backgroundColor") if re.fullmatch(r"#[0-9a-fA-F]{6}", c.get("backgroundColor") or "") else None,
             "on": c.get("selected", True)} for c in items]


def _gparse(t):
    if "date" in t:
        return datetime.fromisoformat(t["date"]), True
    return datetime.fromisoformat(t["dateTime"].replace("Z", "+00:00")).astimezone(agenda.LOCAL_TZ).replace(tzinfo=None), False


def google_events(acc, c, start, end):
    tmin = start.replace(tzinfo=agenda.LOCAL_TZ).isoformat()
    tmax = end.replace(tzinfo=agenda.LOCAL_TZ).isoformat()
    out, token = [], None
    while True:
        params = {"timeMin": tmin, "timeMax": tmax, "singleEvents": "true", "maxResults": 2500, "orderBy": "startTime"}
        if token:
            params["pageToken"] = token
        page = _google(acc, "GET", f"/calendars/{quote(c['gid'], safe='')}/events", params=params)
        for ev in page.get("items", []):
            if ev.get("status") == "cancelled":
                continue
            st, allday = _gparse(ev["start"])
            en, _ = _gparse(ev["end"])
            rem = ev.get("reminders") or {}
            mins = next((o["minutes"] for o in rem.get("overrides", []) if o.get("method") == "popup"), None) if not rem.get("useDefault") else None
            out.append({"ref": ev.get("recurringEventId") or ev["id"], "title": ev.get("summary") or "(sans titre)", "start": st.isoformat(),
                        "end": en.isoformat(), "allday": allday, "location": ev.get("location", ""), "notes": ev.get("description", ""),
                        "recur": "custom" if ev.get("recurringEventId") else "", "reminder": mins})
        token = page.get("nextPageToken")
        if not token:
            return out


def google_write(acc, c, d, ref=None, orig_start=None):
    s, e, allday = agenda.parse_range(d)
    if allday:
        body = {"start": {"date": s.isoformat()}, "end": {"date": e.isoformat()}}
    else:
        body = {"start": {"dateTime": s.isoformat()}, "end": {"dateTime": e.isoformat()}}
    body.update(summary=str(d.get("title") or "").strip()[:200], location=str(d.get("location") or "")[:300], description=str(d.get("notes") or "")[:5000])
    rem = str(d.get("reminder") or "").strip()
    body["reminders"] = {"useDefault": False, "overrides": [{"method": "popup", "minutes": int(rem)}] if rem not in ("", "None") else []}
    path = f"/calendars/{quote(c['gid'], safe='')}/events"
    if ref:
        cur = _google(acc, "GET", f"{path}/{quote(ref, safe='')}")
        if cur.get("recurrence") and orig_start and not allday and "dateTime" in cur.get("start", {}):
            delta = s.replace(tzinfo=None) - datetime.fromisoformat(orig_start[:19])
            ms = datetime.fromisoformat(cur["start"]["dateTime"].replace("Z", "+00:00")) + delta
            body["start"] = {"dateTime": ms.isoformat(), "timeZone": cur["start"].get("timeZone")} if cur["start"].get("timeZone") else {"dateTime": ms.isoformat()}
            body["end"] = {**body["start"], "dateTime": (ms + (e - s)).isoformat()}
        elif d.get("recur") in ("daily", "weekly", "monthly", "yearly"):
            body["recurrence"] = [f"RRULE:FREQ={d['recur'].upper()}"]
        elif not d.get("recur") and cur.get("recurrence"):
            body["recurrence"] = []
        _google(acc, "PATCH", f"{path}/{quote(ref, safe='')}", json=body)
    else:
        if d.get("recur") in ("daily", "weekly", "monthly", "yearly"):
            body["recurrence"] = [f"RRULE:FREQ={d['recur'].upper()}"]
        _google(acc, "POST", path, json=body)


# --- Interface commune avec l'outil Agenda ------------------------------------------------------

def discover(acc):
    kind = acc["cal"]["kind"]
    if kind == "caldav":
        cals = discover_caldav(acc)
    elif kind == "graph":
        cals = graph_discover(acc)
    elif kind == "google":
        cals = google_discover(acc)
    elif kind == "ics":
        text = ics_text(acc["cal"]["url"], fresh=True)
        m = re.search(r"^X-WR-CALNAME:(.+)$", text, re.M)
        color = re.search(r"^(?:X-APPLE-CALENDAR-COLOR|COLOR):(#[0-9A-Fa-f]{6})", text, re.M)
        cals = [{"id": "ics", "name": (m[1].strip() if m else acc.get("label")) or "Calendrier", "ro": True, "on": True, "color": color[1] if color else None}]
    else:
        raise ValueError("Type d'agenda inconnu")
    used = [c["color"] for c in cals if c.get("color")]
    for i, c in enumerate(cals):
        c["color"] = c.get("color") or agenda.COLORS[(i + 3 + len(used)) % len(agenda.COLORS)]
    return cals


def calendars(user):
    out = []
    for acc in accounts.of(user):
        for c in (acc.get("cal") or {}).get("calendars", []):
            if not c.get("on", True):
                continue
            cid = cal_id(acc, c)
            out.append({"id": cid, "name": c["name"], "color": c["color"], "external": True, "readonly": bool(c.get("ro")) or acc["cal"]["kind"] == "ics",
                        "provider": acc["provider"], "account": acc["id"], "account_label": acc.get("label") or acc.get("email"), "error": _errors.get(cid)})
    return out


def _resolve(user, cid):
    m = re.fullmatch(r"x-([0-9a-f]+)-([\w]+)", cid or "")
    if not m:
        raise ValueError("Agenda introuvable")
    acc = accounts.get(user, m[1])
    c = next((c for c in (acc.get("cal") or {}).get("calendars", []) if c["id"] == m[2]), None)
    if not c:
        raise ValueError("Agenda introuvable")
    return acc, c


def _fetch(acc, c, start, end):
    kind = acc["cal"]["kind"]
    if kind == "caldav":
        return caldav_events(acc, c, start, end)
    if kind == "graph":
        return graph_events(acc, c, start, end)
    if kind == "google":
        return google_events(acc, c, start, end)
    return ics_events(acc, start, end)


def list_events(user, start, end):
    jobs = []
    for acc in accounts.of(user):
        for c in (acc.get("cal") or {}).get("calendars", []):
            if c.get("on", True):
                jobs.append((acc, c))
    if not jobs:
        return []

    def one(job):
        acc, c = job
        cid = cal_id(acc, c)
        key = (cid, start, end)
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < 90:
            evs = hit[1]
        else:
            try:
                evs = _fetch(acc, c, start, end)
                _errors.pop(cid, None)
                _cache[key] = (time.time(), evs)
            except Exception as e:  # noqa: BLE001  un agenda en panne n'empêche pas d'afficher les autres
                _errors[cid] = str(e)[:200]
                return []
        ro = bool(c.get("ro")) or acc["cal"]["kind"] == "ics"
        return [{**ev, "uid": f"{cid}|{ev['ref']}" if ev["ref"] else f"{cid}|{uuid.uuid4().hex[:6]}", "cal": cid, "color": c["color"],
                 "external": True, "readonly": ro, "provider": acc["provider"]} for ev in evs]
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as ex:
        results = list(ex.map(one, jobs))
    if len(_cache) > 300:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:150]:
            _cache.pop(k, None)
    return [e for r in results for e in r]


def _invalidate(cid):
    for k in [k for k in _cache if k[0] == cid]:
        _cache.pop(k, None)


def _writer(acc):
    return {"caldav": caldav_write, "graph": graph_write, "google": google_write}.get(acc["cal"]["kind"])


def create(user, cid, d):
    acc, c = _resolve(user, cid)
    if c.get("ro") or not _writer(acc):
        raise ValueError("Cet agenda est en lecture seule")
    _writer(acc)(acc, c, d)
    _invalidate(cid)
    return {"ok": True}


def split_uid(uid):
    cid, _, ref = uid.partition("|")
    return cid, ref


def update(user, uid, d):
    cid, ref = split_uid(uid)
    acc, c = _resolve(user, cid)
    if c.get("ro") or not _writer(acc):
        raise ValueError("Cet agenda est en lecture seule")
    _writer(acc)(acc, c, d, ref=ref, orig_start=d.get("orig_start"))
    _invalidate(cid)
    return {"ok": True}


def delete(user, uid):
    cid, ref = split_uid(uid)
    acc, c = _resolve(user, cid)
    if c.get("ro"):
        raise ValueError("Cet agenda est en lecture seule")
    kind = acc["cal"]["kind"]
    if kind == "caldav":
        caldav_delete(acc, ref)
    elif kind == "graph":
        _graph(acc, "DELETE", f"/me/events/{ref}")
    elif kind == "google":
        _google(acc, "DELETE", f"/calendars/{quote(c['gid'], safe='')}/events/{quote(ref, safe='')}")
    else:
        raise ValueError("Cet agenda est en lecture seule")
    _invalidate(cid)
