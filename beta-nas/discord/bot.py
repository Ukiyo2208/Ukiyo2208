"""Bot Discord de Bêta : piloter la maison, parler à Bêta, voir les caméras, suivre colis, agenda, tâches,
énergie et papiers, envoyer des fichiers sur le NAS… et recevoir les alertes et notifications dans un salon.

Réglages (.env) :
  DISCORD_TOKEN         jeton du bot (Discord Developer Portal › ton application › Bot › Reset Token)
  DISCORD_SALON         identifiant du salon où arrivent les notifications (clic droit sur le salon › Copier l'identifiant)
  DISCORD_UTILISATEURS  qui peut utiliser le bot : « 123456789012345678=bastien,987…=julie » (identifiant Discord =
                        prénom dans Bêta, pour ses droits). Personne d'autre ne peut rien faire.
Notifications : ajoute « discord-bot » dans NOTIFICATIONS. Bêta et Bêta Tool envoient à http://discord:8803/notifier.
"""

from __future__ import annotations

import logging
import os

import discord
from aiohttp import web
from discord import app_commands

import actions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("beta.discord")
TOKEN = os.environ.get("DISCORD_TOKEN", "")
SALON = int(os.environ.get("DISCORD_SALON", "0") or 0)
BETA_TOKEN = os.environ.get("BETA_TOKEN", "")


def utilisateurs(texte: str | None = None) -> dict[int, str]:
    """{identifiant Discord: prénom dans Bêta} d'après DISCORD_UTILISATEURS."""
    texte = os.environ.get("DISCORD_UTILISATEURS", "") if texte is None else texte
    out = {}
    for morceau in texte.replace(";", ",").split(","):
        ident, _, prenom = morceau.strip().partition("=")
        if ident.strip().isdigit():
            out[int(ident.strip())] = prenom.strip().lower() or None
    return out


AUTORISES = utilisateurs()


def embed(r: actions.Reponse) -> tuple[discord.Embed, discord.File | None]:
    e = discord.Embed(title=r.titre or None, description=r.texte[:4000] or None, color=r.couleur, url=r.lien or None)
    for nom, valeur in r.champs[:25]:
        e.add_field(name=nom[:256], value=(valeur or "—")[:1024], inline=len(valeur or "") < 40)
    fichier = None
    if r.image:
        import io
        fichier = discord.File(io.BytesIO(r.image), filename=r.nom_image)
        e.set_image(url=f"attachment://{r.nom_image}")
    e.set_footer(text="Bêta")
    return e, fichier


class Bot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        app = web.Application()
        app.router.add_post("/notifier", self.recevoir)
        app.router.add_get("/sante", lambda _r: web.json_response({"ok": True, "connecte": self.is_ready()}))
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", 8803).start()
        log.info("Notifications sur http://0.0.0.0:8803/notifier")

    async def synchroniser(self, serveur: discord.Guild):
        """Commandes copiées sur chaque serveur : elles apparaissent tout de suite (une synchro globale prend jusqu'à 1 h)."""
        try:
            self.tree.copy_global_to(guild=serveur)
            await self.tree.sync(guild=serveur)
        except discord.HTTPException as e:
            log.warning("Commandes non enregistrées sur %s : %s (invite le bot avec « applications.commands »)", serveur.name, e)

    async def on_guild_join(self, serveur: discord.Guild):
        await self.synchroniser(serveur)

    async def on_ready(self):
        log.info("Connecté à Discord : %s (%s serveur(s))", self.user, len(self.guilds))
        for serveur in self.guilds:
            await self.synchroniser(serveur)
        if not AUTORISES:
            log.warning("DISCORD_UTILISATEURS est vide : personne ne peut utiliser le bot (il répond avec ton identifiant)")

    async def recevoir(self, requete: web.Request) -> web.Response:
        """Une notification de Bêta ou de Bêta Tool → message dans le salon (ou en privé aux personnes autorisées)."""
        if requete.headers.get("Authorization") != f"Bearer {BETA_TOKEN}" or not BETA_TOKEN:
            return web.json_response({"erreur": "jeton"}, status=401)
        d = await requete.json()
        urgent = any(m in (d.get("titre") or "") for m in ("🚨", "💧", "🔥", "⚠️", "🚪", "🛠️", "💾"))
        r = actions.Reponse(d.get("message") or "", titre=d.get("titre") or "Bêta", lien=d.get("lien") or "",
                            couleur=0xFF5D68 if urgent else 0x2F86FF)
        e, _ = embed(r)
        cibles = []
        if SALON and (salon := self.get_channel(SALON) or await self.fetch_channel(SALON)):
            cibles.append(salon)
        elif AUTORISES:
            for ident in AUTORISES:
                try:
                    cibles.append(await self.fetch_user(ident))
                except discord.HTTPException:
                    pass
        for c in cibles:
            await c.send(content="@here" if urgent and SALON else None, embed=e)
        return web.json_response({"ok": True, "envoyes": len(cibles)})


bot = Bot()


def autorise(inter: discord.Interaction) -> bool:
    return inter.user.id in AUTORISES


async def repondre(inter: discord.Interaction, travail, prive: bool = False):
    """Vérifie l'accès, affiche « réfléchit… », exécute, répond (embed + image éventuelle)."""
    if not autorise(inter):
        await inter.response.send_message(
            f"Tu n'as pas accès à Bêta. Pour l'autoriser, ajoute `{inter.user.id}=ton_prénom` dans DISCORD_UTILISATEURS (.env du NAS).",
            ephemeral=True)
        return
    await inter.response.defer(thinking=True, ephemeral=prive)
    try:
        r = await travail()
    except actions.Erreur as e:
        await inter.followup.send(f"⚠️ {e}", ephemeral=True)
        return
    except Exception as e:  # noqa: BLE001  (Bêta arrêté, réseau…)
        log.exception("commande")
        await inter.followup.send(f"⚠️ Impossible : {e}", ephemeral=True)
        return
    e, fichier = embed(r)
    await inter.followup.send(embed=e, file=fichier) if fichier else await inter.followup.send(embed=e)


def prenom(inter):
    return AUTORISES.get(inter.user.id)


# --- Maison et Bêta ---------------------------------------------------------------------------------------

@bot.tree.command(name="beta", description="Parler à Bêta : « allume le salon », « ferme les volets », une question…")
@app_commands.describe(texte="Ce que tu veux dire à Bêta")
async def c_beta(inter: discord.Interaction, texte: str):
    await repondre(inter, lambda: actions.parler(texte, prenom(inter)))


@bot.tree.command(name="allumer", description="Allumer un appareil ou une pièce")
async def c_allumer(inter: discord.Interaction, quoi: str):
    await repondre(inter, lambda: actions.parler(f"allume {quoi}", prenom(inter)))


@bot.tree.command(name="eteindre", description="Éteindre un appareil ou une pièce (« tout » pour toute la maison)")
async def c_eteindre(inter: discord.Interaction, quoi: str):
    await repondre(inter, lambda: actions.parler(f"éteins {quoi}", prenom(inter)))


@bot.tree.command(name="volets", description="Ouvrir ou fermer les volets")
@app_commands.choices(action=[app_commands.Choice(name="Ouvrir", value="ouvre"), app_commands.Choice(name="Fermer", value="ferme")])
async def c_volets(inter: discord.Interaction, action: app_commands.Choice[str], piece: str = ""):
    await repondre(inter, lambda: actions.parler(f"{action.value} les volets {('du ' + piece) if piece else ''}".strip(), prenom(inter)))


@bot.tree.command(name="maison", description="Ce qui est allumé, ouvert, qui est là, la météo")
async def c_maison(inter: discord.Interaction):
    await repondre(inter, actions.maison)


@bot.tree.command(name="resume", description="Le résumé du jour (météo, poubelles, colis, maison, énergie)")
async def c_resume(inter: discord.Interaction):
    await repondre(inter, actions.resume)


@bot.tree.command(name="energie", description="Consommation et coût : aujourd'hui, hier, ce mois-ci")
async def c_energie(inter: discord.Interaction):
    await repondre(inter, actions.energie)


@bot.tree.command(name="alertes", description="Les dernières alertes de la maison")
async def c_alertes(inter: discord.Interaction):
    await repondre(inter, actions.alertes)


@bot.tree.command(name="services", description="État de Bêta, de ses services et de la sauvegarde")
async def c_services(inter: discord.Interaction):
    await repondre(inter, actions.services)


async def choix_cameras(inter: discord.Interaction, courant: str):
    if not autorise(inter):
        return []
    liste = await actions.cameras()
    return [app_commands.Choice(name=n[:100], value=i[:100]) for n, i in liste if courant.lower() in n.lower()][:25]


@bot.tree.command(name="camera", description="Une image de la caméra, maintenant")
@app_commands.autocomplete(camera=choix_cameras)
async def c_camera(inter: discord.Interaction, camera: str = ""):
    await repondre(inter, lambda: actions.camera(camera), prive=True)


# --- Bêta Tool --------------------------------------------------------------------------------------------

@bot.tree.command(name="journee", description="Ma journée : rendez-vous, tâches, poubelles, colis, mails")
async def c_journee(inter: discord.Interaction):
    await repondre(inter, actions.journee, prive=True)


@bot.tree.command(name="agenda", description="Ce que j'ai aujourd'hui, demain ou après-demain")
@app_commands.choices(jour=[app_commands.Choice(name=n, value=n) for n in ("aujourd'hui", "demain", "après-demain")])
async def c_agenda(inter: discord.Interaction, jour: app_commands.Choice[str] | None = None):
    await repondre(inter, lambda: actions.commande_tool(f"qu'est-ce que j'ai {jour.value if jour else 'aujourd hui'}", "📅 Agenda"), prive=True)


@bot.tree.command(name="rendezvous", description="Ajouter un rendez-vous : « dentiste mardi à 14h30 »")
async def c_rdv(inter: discord.Interaction, texte: str):
    await repondre(inter, lambda: actions.commande_tool(f"rendez-vous {texte}", "📅 Agenda"), prive=True)


@bot.tree.command(name="rappel", description="Me rappeler quelque chose : « appeler le garage demain à 9h »")
async def c_rappel(inter: discord.Interaction, texte: str):
    await repondre(inter, lambda: actions.commande_tool(f"rappelle-moi de {texte}", "⏰ Rappel"), prive=True)


@bot.tree.command(name="courses", description="Ajouter à la liste de courses : « lait, œufs, pain »")
async def c_courses(inter: discord.Interaction, articles: str):
    await repondre(inter, lambda: actions.commande_tool(f"ajoute {articles} à la liste de courses", "🛒 Courses"))


@bot.tree.command(name="tache", description="Ajouter une tâche : « réparer le vélo »")
async def c_tache(inter: discord.Interaction, texte: str):
    await repondre(inter, lambda: actions.commande_tool(f"ajoute {texte}", "✅ Tâches"))


@bot.tree.command(name="colis", description="Où en sont mes colis")
async def c_colis(inter: discord.Interaction):
    await repondre(inter, lambda: actions.commande_tool("où en sont mes colis", "📦 Colis"), prive=True)


@bot.tree.command(name="depenses", description="Combien j'ai dépensé ce mois-ci")
async def c_depenses(inter: discord.Interaction):
    await repondre(inter, lambda: actions.commande_tool("combien j'ai dépensé ce mois-ci", "💶 Budget"), prive=True)


@bot.tree.command(name="papiers", description="Papiers trouvés sur le NAS, à valider, à payer")
async def c_papiers(inter: discord.Interaction):
    await repondre(inter, actions.papiers, prive=True)


@bot.tree.command(name="telecharger", description="Télécharger une vidéo ou une musique sur le NAS (YouTube…)")
@app_commands.choices(format=[app_commands.Choice(name="Vidéo", value="video"), app_commands.Choice(name="Musique (MP3)", value="audio")])
async def c_telecharger(inter: discord.Interaction, lien: str, format: app_commands.Choice[str] | None = None):
    await repondre(inter, lambda: actions.telecharger(lien, bool(format and format.value == "audio")))


@bot.tree.command(name="envoyer", description="Envoyer un fichier sur le NAS (facture → Paperasse, relevé → Budget, photo → Album…)")
@app_commands.choices(destination=[app_commands.Choice(name=n, value=v) for n, v in (
    ("Automatique", "auto"), ("Paperasse", "paperasse"), ("Budget (relevé)", "budget"), ("Album photo", "photos"), ("Fichiers", "fichiers"))])
async def c_envoyer(inter: discord.Interaction, fichier: discord.Attachment, destination: app_commands.Choice[str] | None = None):
    async def travail():
        if fichier.size > 50 * 1024 * 1024:
            raise actions.Erreur("Fichier trop gros pour Discord (50 Mo au plus).")
        return await actions.envoyer_fichier(fichier.filename, await fichier.read(), destination.value if destination else "auto")
    await repondre(inter, travail, prive=True)


@bot.tree.command(name="aide", description="Tout ce que sait faire le bot de Bêta")
async def c_aide(inter: discord.Interaction):
    lignes = [f"`/{c.name}` {c.description}" for c in bot.tree.get_commands()]
    await inter.response.send_message(embed=discord.Embed(title="🤖 Bêta sur Discord", description="\n".join(lignes), color=0x2F86FF),
                                      ephemeral=True)


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("DISCORD_TOKEN est vide : crée un bot sur https://discord.com/developers/applications (voir INSTALLATION.md)")
    bot.run(TOKEN, log_handler=None)
