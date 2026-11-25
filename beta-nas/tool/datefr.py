"""Repère les dates et heures écrites en français dans un texte : « dimanche midi », « le 12 novembre
à 14h30 », « demain 9h », « 12/11 à 18h », « mardi prochain »…  Sert à créer un événement depuis un
mail et aux commandes vocales."""

import re
import unicodedata
from datetime import date, datetime, timedelta

MONTHS = {"janvier": 1, "janv": 1, "fevrier": 2, "fevr": 2, "fev": 2, "mars": 3, "avril": 4, "avr": 4, "mai": 5, "juin": 6, "juillet": 7, "juil": 7,
          "aout": 8, "septembre": 9, "sept": 9, "octobre": 10, "oct": 10, "novembre": 11, "nov": 11, "decembre": 12, "dec": 12}
WEEKDAYS = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "vendredi": 4, "samedi": 5, "dimanche": 6}
MOMENTS = {"matin": 9, "midi": 12, "apres-midi": 14, "aprem": 14, "soir": 19, "soiree": 20, "ce soir": 19}


def _norm(s):
    s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[’']", "'", s).replace("apres midi", "apres-midi")


TIME = r"(?:(?:a|vers|des|de|pour|entre)\s+)?(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?(?!\d)"
MOMENT = r"(?:le\s+|en\s+|dans\s+l'|a\s+|au\s+)?(matin|midi|apres-midi|aprem|soiree|soir)"


def _time_after(text, pos):
    """(heure, minute, fin) d'une heure juste après pos (« à 14h30 », « midi »), sinon None."""
    tail = text[pos:pos + 30]
    m = re.match(r"[\s,]*(?:-\s*)?" + TIME, tail)
    if m:
        h, mi = int(m[1]), int(m[2] or 0)
        if h < 24 and mi < 60:
            return h, mi, pos + m.end()
    m = re.match(r"[\s,]*" + MOMENT, tail)
    if m:
        return MOMENTS[m[1]], 0, pos + m.end()
    return None


def find(text, ref=None):
    """[{start, allday, text}] dans l'ordre d'apparition (start : datetime naïf local, ou date)."""
    ref = ref or datetime.now()
    today = ref.date()
    t = _norm(text or "")[:20000]
    raw = text or ""
    out = []

    def before(pos):
        """Heure écrite juste avant la date (« de 18h à 20h le 1er décembre »)."""
        base = max(0, pos - 30)
        m = re.search(r"(?:a|de|des|vers)\s+(\d{1,2})\s*h\s*(\d{2})?(?:\s*a\s*\d{1,2}\s*h\s*\d{0,2})?[\s,]*(?:le\s*)?$", t[base:pos])
        return (int(m[1]), int(m[2] or 0), base + m.start()) if m and int(m[1]) < 24 else None

    def add(d, m_start, m_end, tm=None):
        if not tm:
            b = before(m_start)
            if b:
                tm, m_start = (b[0], b[1], m_end), b[2]
        if tm:
            start, allday, end = datetime.combine(d, datetime.min.time()).replace(hour=tm[0], minute=tm[1]), False, tm[2]
        else:
            start, allday, end = d, True, m_end
        snippet = raw[m_start:end].strip(" ,.")
        if not any(o["start"] == start for o in out):
            out.append({"start": start, "allday": allday, "text": snippet, "pos": m_start})

    # « le 12 novembre (2026) (à 14h30) », « lundi 3 novembre »
    for m in re.finditer(r"(?:(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(?:le\s+)?(\d{1,2}|1er)\s+(" + "|".join(MONTHS) + r")\.?(?:\s+(\d{4}))?", t):
        day = 1 if m[2] == "1er" else int(m[2])
        year = int(m[4]) if m[4] else today.year
        try:
            d = date(year, MONTHS[m[3]], day)
        except ValueError:
            continue
        if not m[4] and d < today - timedelta(days=30):
            d = d.replace(year=year + 1)
        add(d, m.start(), m.end(), _time_after(t, m.end()))
    # « 12/11(/2026) (à 18h) »
    for m in re.finditer(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])", t):
        y = int(m[3]) + (2000 if m[3] and len(m[3]) == 2 else 0) if m[3] else today.year
        try:
            d = date(y, int(m[2]), int(m[1]))
        except ValueError:
            continue
        if not m[3] and d < today - timedelta(days=30):
            d = d.replace(year=y + 1)
        add(d, m.start(), m.end(), _time_after(t, m.end()))
    # « aujourd'hui », « demain », « après-demain », « ce soir »
    for m in re.finditer(r"\b(aujourd'hui|apres-demain|demain|ce soir|ce midi|ce matin|cet apres-midi)\b", t):
        word = m[1]
        d = today + timedelta(days={"demain": 1, "apres-demain": 2}.get(word, 0))
        tm = _time_after(t, m.end())
        if not tm and word in ("ce soir", "ce midi", "ce matin", "cet apres-midi"):
            tm = (MOMENTS[word.split()[-1]], 0, m.end())
        add(d, m.start(), m.end(), tm)
    # « dimanche (prochain) (midi) », « mardi 14h »
    for m in re.finditer(r"\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+prochain)?\b(?!\s+(?:\d{1,2}|1er)\s+(?:" + "|".join(MONTHS) + "))", t):
        if re.match(r"\s+(?:\d{1,2}|1er)\b", t[m.end():]) and not re.match(r"\s+\d{1,2}\s*(h|:)", t[m.end():]):
            continue
        delta = (WEEKDAYS[m[1]] - today.weekday()) % 7 or 7
        add(today + timedelta(days=delta), m.start(), m.end(), _time_after(t, m.end()))
    # heure seule (« rendez-vous à 15h ») : rattachée à la dernière date vue, sinon aujourd'hui/demain
    if not out:
        m = re.search(r"\b(?:a|vers|rendez-vous|rdv)\s+(\d{1,2})\s*h\s*(\d{2})?\b", t)
        if m and int(m[1]) < 24:
            d = today if (int(m[1]), int(m[2] or 0)) > (ref.hour, ref.minute) else today + timedelta(days=1)
            add(d, m.start(), m.end(), (int(m[1]), int(m[2] or 0), m.end()))
    out.sort(key=lambda o: o["pos"])
    for o in out:
        o.pop("pos")
    return out[:6]


def duration_hint(text):
    """Durée indiquée (« pendant 2 heures », « 1h30 ») en minutes, sinon None."""
    t = _norm(text or "")
    m = re.search(r"(?:pendant|duree\s*:?|dure)\s+(\d{1,2})\s*h(?:eures?)?\s*(\d{2})?", t)
    if m:
        return int(m[1]) * 60 + int(m[2] or 0)
    m = re.search(r"de\s+(\d{1,2})\s*h\s*(\d{2})?\s*a\s+(\d{1,2})\s*h\s*(\d{2})?", t)
    if m:
        return (int(m[3]) * 60 + int(m[4] or 0)) - (int(m[1]) * 60 + int(m[2] or 0))
    return None
