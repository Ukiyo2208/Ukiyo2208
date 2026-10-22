"""Reconnaissance vocale (Whisper) et synthèse vocale (Piper) via le protocole Wyoming."""

from __future__ import annotations

import io
import wave

from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize, SynthesizeVoice

TAILLE_BLOC = 4096


class ErreurAudio(ValueError):
    pass


def lire_wav(donnees: bytes) -> tuple[bytes, int, int, int]:
    """Retourne (pcm, frequence, largeur_octets, canaux)."""
    try:
        with wave.open(io.BytesIO(donnees), "rb") as w:
            return w.readframes(w.getnframes()), w.getframerate(), w.getsampwidth(), w.getnchannels()
    except (wave.Error, EOFError) as e:
        raise ErreurAudio(f"Fichier WAV invalide : {e}") from e


def ecrire_wav(pcm: bytes, frequence: int, largeur: int, canaux: int) -> bytes:
    sortie = io.BytesIO()
    with wave.open(sortie, "wb") as w:
        w.setframerate(frequence)
        w.setsampwidth(largeur)
        w.setnchannels(canaux)
        w.writeframes(pcm)
    return sortie.getvalue()


async def transcrire(hote: str, port: int, wav: bytes, langue: str = "fr") -> str:
    """Envoie un WAV (idéalement 16 kHz, mono, 16 bits) à Whisper et retourne le texte."""
    pcm, frequence, largeur, canaux = lire_wav(wav)
    if not pcm:
        raise ErreurAudio("Audio vide")

    async with AsyncTcpClient(hote, port) as client:
        await client.write_event(Transcribe(language=langue).event())
        await client.write_event(AudioStart(rate=frequence, width=largeur, channels=canaux).event())
        for i in range(0, len(pcm), TAILLE_BLOC):
            bloc = AudioChunk(rate=frequence, width=largeur, channels=canaux, audio=pcm[i : i + TAILLE_BLOC])
            await client.write_event(bloc.event())
        await client.write_event(AudioStop().event())

        while True:
            event = await client.read_event()
            if event is None:
                raise ConnectionError("Whisper a fermé la connexion sans répondre")
            if Transcript.is_type(event.type):
                return Transcript.from_event(event).text.strip()


async def synthetiser(hote: str, port: int, texte: str, voix: str) -> bytes:
    """Demande à Piper de lire le texte et retourne un WAV."""
    morceaux: list[bytes] = []
    frequence, largeur, canaux = 22050, 2, 1

    async with AsyncTcpClient(hote, port) as client:
        await client.write_event(Synthesize(text=texte, voice=SynthesizeVoice(name=voix)).event())
        while True:
            event = await client.read_event()
            if event is None:
                raise ConnectionError("Piper a fermé la connexion")
            if AudioStart.is_type(event.type):
                debut = AudioStart.from_event(event)
                frequence, largeur, canaux = debut.rate, debut.width, debut.channels
            elif AudioChunk.is_type(event.type):
                morceaux.append(AudioChunk.from_event(event).audio)
            elif AudioStop.is_type(event.type):
                break

    return ecrire_wav(b"".join(morceaux), frequence, largeur, canaux)
