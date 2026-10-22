# YouTube → NAS

Page web : tu colles un lien YouTube (vidéo ou playlist), le NAS le télécharge
en **meilleure qualité disponible** (jusqu'à 4K/8K, HDR, meilleur audio) avec
[yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg, directement dans ton dossier partagé.

## Installation (Docker sur le NAS)

1. Copie ce dossier `yt-nas` sur le NAS.
2. Dans `docker-compose.yml`, remplace `/volume1/video/YouTube` par le dossier où tu veux les fichiers.
3. Lance :
   ```sh
   docker compose up -d --build
   ```
   (Synology : *Container Manager → Projet → Créer*, en pointant sur ce dossier.
   QNAP : *Container Station → Applications → Créer*.)
4. Ouvre `http://IP-DU-NAS:8080` depuis ton téléphone ou ton PC.

## Utilisation

- **Vidéo** : meilleure vidéo + meilleur audio fusionnés en `.mkv` (le seul format qui accepte AV1/VP9/Opus sans réencodage, donc sans perte). Plex, Jellyfin et VLC le lisent.
- **Audio seul** : meilleure piste audio, sans conversion, avec miniature et métadonnées.
- **Sous-dossier** : optionnel, ex. `Musique` ou `Docs`.
- Les playlists sont rangées dans un dossier portant leur nom.

## Mise à jour

YouTube change souvent ; si les téléchargements échouent, reconstruis l'image pour avoir le dernier yt-dlp :
```sh
docker compose build --no-cache && docker compose up -d
```

## Notes

- Pas d'authentification : garde la page sur ton réseau local (ne l'expose pas sur Internet).
- Réservé à un usage personnel et aux contenus que tu as le droit de télécharger.
