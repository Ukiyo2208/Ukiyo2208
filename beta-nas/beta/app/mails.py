"""Lecture des mails non lus (IMAP). Les mails restent marqués « non lus »."""

from __future__ import annotations

import asyncio
import email
import imaplib
import re
from email.header import decode_header, make_header
from email.utils import parseaddr

from .settings import CompteMail

DEMANDE_MAILS = re.compile(r"\b(mails?|e-?mails?|courriels?|messagerie)\b", re.IGNORECASE)


def _decoder(valeur: str | None) -> str:
    if not valeur:
        return ""
    return str(make_header(decode_header(valeur))).strip()


def _expediteur(valeur: str | None) -> str:
    nom, adresse = parseaddr(_decoder(valeur))
    return nom or adresse.split("@")[0]


def _lire_non_lus(compte: CompteMail, maximum: int) -> tuple[int, list[tuple[str, str]]]:
    with imaplib.IMAP4_SSL(compte.serveur, compte.port, timeout=15) as imap:
        imap.login(compte.utilisateur, compte.mot_de_passe)
        imap.select("INBOX", readonly=True)
        _, donnees = imap.search(None, "UNSEEN")
        ids = donnees[0].split()
        resultats = []
        for mail_id in reversed(ids[-maximum:]):
            _, brut = imap.fetch(mail_id, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])")
            entete = email.message_from_bytes(brut[0][1])
            resultats.append((_expediteur(entete["From"]), _decoder(entete["Subject"]) or "sans objet"))
        return len(ids), resultats


async def resume_mails(compte: CompteMail, maximum: int = 5) -> str:
    total, mails = await asyncio.to_thread(_lire_non_lus, compte, maximum)
    if total == 0:
        return "Tu n'as aucun nouveau mail."
    debut = "Tu as un nouveau mail." if total == 1 else f"Tu as {total} nouveaux mails."
    if total > maximum:
        debut += f" Voici les {maximum} plus récents."
    details = " ".join(f"De {de} : {objet}." for de, objet in mails)
    return f"{debut} {details}"
