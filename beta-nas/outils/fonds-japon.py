"""Génère les fonds « Japon » de Bêta : 3 moments (jour, soir, nuit) × 4 saisons, en SVG.

Usage : python3 outils/fonds-japon.py beta/app/static/fonds  (puis copier dans tool/static/fonds)"""
import math
import random
import sys
from pathlib import Path

L, H, HORIZON = 2560, 1440, 1000

CIELS = {  # haut → bas
    "nuit": ["#050a24", "#0d1650", "#2a1f6e", "#5b2a78", "#8a3a7c"],
    "soir": ["#1b1f5e", "#4a2f86", "#b0478a", "#f0745f", "#ffb36b"],
    "jour": ["#2e6fd0", "#4f8fe0", "#7fb2ec", "#b6d5f4", "#e3eefa"],
}
TEINTES = {  # couleurs du paysage selon le moment
    "nuit": dict(etoiles=260, astre="lune", fuji=("#2b3a86", "#141c4d"), neige=("#f4f7ff", "#a9b8ee"), crete1="#1b2462",
                 crete2="#0f1440", eau=("#3a2468", "#141a4a", "#060a22"), brume="#b56bd6", silhouette="#080b26",
                 fenetres=.75, lanternes=1.0, branche="#1a0f1e", reflet="#d7e2ff"),
    "soir": dict(etoiles=40, astre="soleil_bas", fuji=("#5a3f8f", "#2c2464"), neige=("#ffe6e0", "#c9a3d9"), crete1="#3b2a6e",
                 crete2="#24194d", eau=("#e0806f", "#5a3478", "#1c1440"), brume="#ff9a8a", silhouette="#1a1236",
                 fenetres=.6, lanternes=.8, branche="#2a1626", reflet="#ffd2a8"),
    "jour": dict(etoiles=0, astre="soleil", fuji=("#5d7fc4", "#3b5a9e"), neige=("#ffffff", "#dbe6fb"), crete1="#4f6fb2",
                 crete2="#3a5594", eau=("#9cc6ee", "#5f93d6", "#2d5aa6"), brume="#ffffff", silhouette="#24305e",
                 fenetres=0.0, lanternes=0.0, branche="#3a2a2a", reflet="#ffffff"),
}
SAISONS = {
    "printemps": dict(fleurs=("#ffe3f0", "#ff9ccb", "#e05a9f"), chute="petales", couleur_chute="#ffb3d6", neige_fuji=1.0),
    "ete": dict(fleurs=("#9be38f", "#4fb565", "#2c7d45"), chute="lucioles", couleur_chute="#fff39a", neige_fuji=.55),
    "automne": dict(fleurs=("#ffd27a", "#f2782f", "#c2321f"), chute="feuilles", couleur_chute="#f08a3a", neige_fuji=.8),
    "hiver": dict(fleurs=None, chute="neige", couleur_chute="#ffffff", neige_fuji=1.35),
}


def generer(moment, saison, chemin):
    random.seed(2208)
    t, sa = TEINTES[moment], SAISONS[saison]
    o = []
    a = o.append
    c = CIELS[moment]
    a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {L} {H}" preserveAspectRatio="xMidYMid slice">')
    fl = sa["fleurs"] or ("#fff", "#fff", "#fff")
    a(f"""<defs>
<linearGradient id="ciel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="{c[0]}"/><stop offset=".45" stop-color="{c[1]}"/><stop offset=".72" stop-color="{c[2]}"/>
  <stop offset=".9" stop-color="{c[3]}"/><stop offset="1" stop-color="{c[4]}"/></linearGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{'#fff6d8' if moment != 'nuit' else '#cfe0ff'}" stop-opacity=".6"/>
  <stop offset=".35" stop-color="{'#ffd27a' if moment != 'nuit' else '#7fa2ff'}" stop-opacity=".2"/><stop offset="1" stop-color="#7fa2ff" stop-opacity="0"/></radialGradient>
<radialGradient id="astre" cx=".42" cy=".38" r=".7">{
    '<stop offset="0" stop-color="#fbfdff"/><stop offset=".7" stop-color="#dfe7ff"/><stop offset="1" stop-color="#b9c6f0"/>' if moment == 'nuit' else
    '<stop offset="0" stop-color="#fffbe8"/><stop offset=".6" stop-color="#ffe9a8"/><stop offset="1" stop-color="#ffc35c"/>' if moment == 'jour' else
    '<stop offset="0" stop-color="#fff0c8"/><stop offset=".6" stop-color="#ffb35c"/><stop offset="1" stop-color="#ff6f3c"/>'}</radialGradient>
<linearGradient id="fuji" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{t['fuji'][0]}"/><stop offset="1" stop-color="{t['fuji'][1]}"/></linearGradient>
<linearGradient id="neige" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{t['neige'][0]}"/><stop offset="1" stop-color="{t['neige'][1]}"/></linearGradient>
<linearGradient id="eau" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{t['eau'][0]}"/><stop offset=".35" stop-color="{t['eau'][1]}"/><stop offset="1" stop-color="{t['eau'][2]}"/></linearGradient>
<linearGradient id="brume" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{t['brume']}" stop-opacity="0"/>
  <stop offset=".6" stop-color="{t['brume']}" stop-opacity=".22"/><stop offset="1" stop-color="{t['brume']}" stop-opacity="0"/></linearGradient>
<radialGradient id="lanterne" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/>
  <stop offset=".4" stop-color="#ff9a3c" stop-opacity=".35"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
<radialGradient id="fleur" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{fl[0]}"/><stop offset=".6" stop-color="{fl[1]}"/><stop offset="1" stop-color="{fl[2]}"/></radialGradient>
<radialGradient id="luciole" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbb0"/><stop offset=".3" stop-color="#f6ff6a" stop-opacity=".7"/><stop offset="1" stop-color="#d8ff3a" stop-opacity="0"/></radialGradient>
</defs>""")
    a(f'<rect width="{L}" height="{H}" fill="url(#ciel)"/>')
    for _ in range(t["etoiles"]):
        x, y = random.uniform(0, L), random.uniform(0, HORIZON * (0.78 if moment == "nuit" else .35))
        r = random.choice([0.8, 1, 1.2, 1.5, 2.1])
        a(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="#fff" opacity="{random.uniform(.25, .95):.2f}"/>')

    LX, LY = {"nuit": (1880, 300), "jour": (1960, 250), "soir": (1880, 820)}[moment]
    rayon = {"nuit": 118, "jour": 105, "soir": 150}[moment]
    a(f'<circle cx="{LX}" cy="{LY}" r="{rayon * 3.6:.0f}" fill="url(#halo)"/>')
    a(f'<circle cx="{LX}" cy="{LY}" r="{rayon}" fill="url(#astre)"/>')
    if moment == "nuit":
        for dx, dy, r in ((-30, -20, 18), (25, 30, 12), (40, -35, 9), (-15, 45, 8)):
            a(f'<circle cx="{LX+dx}" cy="{LY+dy}" r="{r}" fill="#c3cdf2" opacity=".45"/>')
    if moment == "jour":  # quelques nuages
        for cx, cy, s in ((520, 260, 1.0), (980, 170, .7), (1500, 330, .85), (2300, 420, .6)):
            for dx, dy, r in ((0, 0, 70), (70, -25, 85), (150, 0, 65), (80, 20, 70)):
                a(f'<circle cx="{cx + dx * s:.0f}" cy="{cy + dy * s:.0f}" r="{r * s:.0f}" fill="#ffffff" opacity=".55"/>')

    def crete(y0, amplitude, pas, couleur, opacite):
        pts = [(0, H)]
        x = 0
        while x <= L + pas:
            pts.append((x, y0 - abs(math.sin(x / 260.0) * amplitude) - random.uniform(0, amplitude * .35)))
            x += pas
        pts.append((L, H))
        a('<path d="M' + " L".join(f"{px:.0f},{py:.0f}" for px, py in pts) + f' Z" fill="{couleur}" opacity="{opacite}"/>')

    crete(HORIZON - 40, 90, 60, t["crete1"], .9)
    FX, HZ = 1280, HORIZON
    a(f'<path d="M{FX-760},{HZ} C{FX-520},{HZ-120} {FX-260},{HZ-330} {FX-110},{HZ-470} L{FX-60},{HZ-500} L{FX-20},{HZ-488} L{FX+25},{HZ-505} '
      f'L{FX+70},{HZ-478} C{FX+230},{HZ-330} {FX+520},{HZ-120} {FX+780},{HZ} Z" fill="url(#fuji)"/>')
    k = sa["neige_fuji"]  # étendue de la neige sur le sommet
    bas = lambda d: HZ - 470 + d * k  # noqa: E731  (descend plus bas en hiver)
    larg = lambda d: d * (0.6 + 0.4 * k)  # noqa: E731
    a(f'<path d="M{FX-110},{HZ-470} L{FX-60},{HZ-500} L{FX-20},{HZ-488} L{FX+25},{HZ-505} L{FX+70},{HZ-478} '
      f'C{FX+120:.0f},{HZ-430} {FX+larg(160):.0f},{bas(75):.0f} {FX+larg(200):.0f},{bas(110):.0f} L{FX+larg(150):.0f},{bas(98):.0f} '
      f'L{FX+larg(120):.0f},{bas(130):.0f} L{FX+larg(80):.0f},{bas(95):.0f} L{FX+larg(40):.0f},{bas(140):.0f} L{FX},{bas(98):.0f} '
      f'L{FX-larg(40):.0f},{bas(132):.0f} L{FX-larg(80):.0f},{bas(90):.0f} L{FX-larg(120):.0f},{bas(125):.0f} L{FX-larg(160):.0f},{bas(85):.0f} '
      f'L{FX-larg(205):.0f},{bas(110):.0f} C{FX-larg(170):.0f},{bas(75):.0f} {FX-140},{HZ-430} {FX-110},{HZ-470} Z" fill="url(#neige)"/>')
    a(f'<rect y="{HZ-220}" width="{L}" height="260" fill="url(#brume)"/>')
    crete(HZ + 10, 55, 45, t["crete2"], 1)

    def pagode(x, base, l, etages):
        h = 0
        for i in range(etages):
            w = l * (1 - i * .16)
            yy = base - h
            a(f'<rect x="{x - w*.32:.0f}" y="{yy-58:.0f}" width="{w*.64:.0f}" height="58" fill="{t["silhouette"]}"/>')
            a(f'<path d="M{x - w*.62:.0f},{yy-58:.0f} Q{x:.0f},{yy-92:.0f} {x + w*.62:.0f},{yy-58:.0f} L{x + w*.5:.0f},{yy-70:.0f} '
              f'Q{x:.0f},{yy-108:.0f} {x - w*.5:.0f},{yy-70:.0f} Z" fill="{t["silhouette"]}"/>')
            if saison == "hiver":  # neige sur les toits
                a(f'<path d="M{x - w*.55:.0f},{yy-66:.0f} Q{x:.0f},{yy-104:.0f} {x + w*.55:.0f},{yy-66:.0f}" stroke="#f4f8ff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".9"/>')
            if t["fenetres"]:
                for s_ in (-1, 1):
                    a(f'<rect x="{x + s_*w*.14 - 9:.0f}" y="{yy-44:.0f}" width="18" height="24" fill="#ffb661" opacity="{t["fenetres"]}"/>')
            h += 92
        a(f'<rect x="{x-4:.0f}" y="{base-h-70:.0f}" width="8" height="80" fill="{t["silhouette"]}"/>')
    pagode(330, HZ + 20, 300, 5)

    a(f'<rect y="{HZ+25}" width="{L}" height="{H-HZ-25}" fill="url(#eau)"/>')
    TX, TB, rouge = 2040, HZ + 150, "#c3283f"
    a(f'<rect x="{TX-150}" y="{TB-260}" width="26" height="270" fill="{rouge}"/>')
    a(f'<rect x="{TX+124}" y="{TB-260}" width="26" height="270" fill="{rouge}"/>')
    a(f'<path d="M{TX-215},{TB-292} Q{TX},{TB-318} {TX+215},{TB-292} L{TX+205},{TB-268} Q{TX},{TB-290} {TX-205},{TB-268} Z" fill="{rouge}"/>')
    if saison == "hiver":
        a(f'<path d="M{TX-210},{TB-300} Q{TX},{TB-326} {TX+210},{TB-300}" stroke="#f4f8ff" stroke-width="8" fill="none" stroke-linecap="round"/>')
    a(f'<rect x="{TX-180}" y="{TB-228}" width="360" height="20" fill="{rouge}"/>')
    a(f'<rect x="{TX-12}" y="{TB-268}" width="24" height="44" fill="{rouge}"/>')

    for i in range(70):
        yy = HZ + 40 + i * 6
        w = random.uniform(20, 160) * (1 - i / 90)
        a(f'<rect x="{LX - w/2:.0f}" y="{yy}" width="{w:.0f}" height="2" fill="{t["reflet"]}" opacity="{max(.05, .55 - i*.007):.2f}"/>')
    for i in range(26):
        yy = TB + 14 + i * 7
        for x0 in (TX - 150, TX + 124):
            a(f'<rect x="{x0 + random.uniform(-6, 6):.0f}" y="{yy}" width="26" height="3" fill="{rouge}" opacity="{.45 - i*.016:.2f}"/>')
    for _ in range(90):
        x, yy = random.uniform(0, L), random.uniform(HZ + 60, H)
        a(f'<rect x="{x:.0f}" y="{yy:.0f}" width="{random.uniform(30, 140):.0f}" height="1.5" fill="#cfdcff" opacity="{random.uniform(.05, .18):.2f}"/>')

    for x in (640, 860, 1080):
        if t["lanternes"]:
            a(f'<circle cx="{x}" cy="{HZ+40}" r="70" fill="url(#lanterne)" opacity="{t["lanternes"]}"/>')
        a(f'<rect x="{x-12}" y="{HZ+18}" width="24" height="34" rx="6" fill="{"#ffcf73" if t["lanternes"] else "#d9c6a0"}"/>')
        a(f'<rect x="{x-3}" y="{HZ+52}" width="6" height="40" fill="{t["silhouette"]}"/>')
        if t["lanternes"]:
            a(f'<rect x="{x-14}" y="{HZ+70}" width="28" height="70" fill="url(#lanterne)" opacity=".35"/>')

    def branche(x, yy, angle, longueur, epaisseur, profondeur):
        x2, y2 = x + math.cos(angle) * longueur, yy + math.sin(angle) * longueur
        a(f'<path d="M{x:.0f},{yy:.0f} Q{(x+x2)/2 + random.uniform(-25, 25):.0f},{(yy+y2)/2 + random.uniform(-25, 25):.0f} {x2:.0f},{y2:.0f}" '
          f'stroke="{t["branche"]}" stroke-width="{epaisseur:.1f}" fill="none" stroke-linecap="round"/>')
        if profondeur > 0:
            for _ in range(2):
                branche(x2, y2, angle + random.uniform(-.7, .7), longueur * random.uniform(.55, .8), epaisseur * .62, profondeur - 1)
        else:
            for _ in range(9):
                fx, fy, r = x2 + random.uniform(-38, 38), y2 + random.uniform(-30, 30), random.uniform(7, 14)
                op = random.uniform(.7, 1)
                if sa["fleurs"]:
                    if saison == "automne":  # feuilles d'érable : petites étoiles à 5 branches
                        a(_erable(fx, fy, r * 1.2, op))
                    else:
                        a(f'<circle cx="{fx:.0f}" cy="{fy:.0f}" r="{r:.1f}" fill="url(#fleur)" opacity="{op:.2f}"/>')
                elif saison == "hiver":  # neige posée sur les branches
                    if random.random() < .4:
                        a(f'<circle cx="{fx:.0f}" cy="{fy:.0f}" r="{r*.55:.1f}" fill="#f4f8ff" opacity="{op*.8:.2f}"/>')

    branche(-40, 60, .45, 330, 30, 4)
    branche(L + 40, 40, math.pi - .5, 300, 26, 4)
    branche(-30, H - 160, -.35, 240, 22, 3)

    chute, couleur = sa["chute"], sa["couleur_chute"]
    if chute == "lucioles" and moment == "jour":
        chute = "aucune"
    for _ in range({"petales": 70, "feuilles": 55, "neige": 220, "lucioles": 60, "aucune": 0}[chute]):
        x, yy = random.uniform(0, L), random.uniform(0, H)
        rot = random.uniform(0, 180)
        if chute == "petales":
            a(f'<ellipse cx="{x:.0f}" cy="{yy:.0f}" rx="{random.uniform(5, 10):.1f}" ry="{random.uniform(3, 5):.1f}" fill="{couleur}" '
              f'opacity="{random.uniform(.35, .85):.2f}" transform="rotate({rot:.0f} {x:.0f} {yy:.0f})"/>')
        elif chute == "feuilles":
            a(_erable(x, yy, random.uniform(7, 12), random.uniform(.45, .9), rot, random.choice(["#f08a3a", "#e2552d", "#ffbf47"])))
        elif chute == "neige":
            a(f'<circle cx="{x:.0f}" cy="{yy:.0f}" r="{random.uniform(1.5, 5):.1f}" fill="#fff" opacity="{random.uniform(.4, .95):.2f}"/>')
        elif chute == "lucioles":
            yy = random.uniform(HZ - 300, H - 60)
            a(f'<circle cx="{x:.0f}" cy="{yy:.0f}" r="{random.uniform(8, 16):.0f}" fill="url(#luciole)" opacity="{random.uniform(.5, 1):.2f}"/>')
    a("</svg>")
    Path(chemin).write_text("\n".join(o))


def _erable(x, y, r, opacite, rot=0.0, couleur="url(#fleur)"):
    pts = []
    for j in range(10):
        ang = math.radians(rot - 90 + j * 36)
        rr = r if j % 2 == 0 else r * .45
        pts.append(f"{x + math.cos(ang) * rr:.0f},{y + math.sin(ang) * rr:.0f}")
    return f'<polygon points="{" ".join(pts)}" fill="{couleur}" opacity="{opacite:.2f}"/>'


if __name__ == "__main__":
    dossier = Path(sys.argv[1])
    dossier.mkdir(parents=True, exist_ok=True)
    for saison in SAISONS:
        for moment in TEINTES:
            generer(moment, saison, dossier / f"japon-{saison}-{moment}.svg")
    print("ok", len(list(dossier.glob("*.svg"))))
