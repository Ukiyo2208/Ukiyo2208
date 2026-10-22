# Bêta Tool

Boîte à outils web auto-hébergée sur ton NAS. Tout tourne en local : aucun
fichier n'est envoyé à un service externe.

| Outil | Ce qu'il fait |
| --- | --- |
| **Téléchargeur** | Colle un lien YouTube ou d'un autre site pris en charge par [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Vimeo, TikTok, X, Instagram, SoundCloud, Twitch, Dailymotion…) : vidéo ou playlist téléchargée en **meilleure qualité** (jusqu'à 4K/8K, HDR) directement dans un dossier du NAS. |
| **Convertisseur** | Glisse-dépose des fichiers et choisis le format de sortie (dans l'esprit de ConvertX). Le résultat se télécharge depuis la page et/ou s'enregistre sur le NAS. |

## Formats du convertisseur

| Type | Entrées | Sorties | Moteur |
| --- | --- | --- | --- |
| Vidéo | mp4 mkv mov avi webm flv wmv m4v mpg ts 3gp ogv gif | mp4 mkv mov webm avi gif + extraction audio | FFmpeg |
| Audio | mp3 wav flac aac m4a ogg opus wma aiff amr ac3 | mp3 m4a wav flac ogg opus aiff | FFmpeg |
| Image | jpg png webp gif bmp tiff heic avif ico svg psd tga | jpg png webp avif heic gif bmp tiff ico pdf | Pillow |
| PDF | pdf | png, jpg (une image par page, en zip) · txt | Poppler |
| Document | doc docx odt rtf txt pages | pdf docx odt doc rtf txt html | LibreOffice |
| Tableur | xls xlsx ods csv numbers | xlsx ods xls csv pdf html | LibreOffice |
| Présentation | ppt pptx odp key | pptx odp ppt pdf | LibreOffice |
| Livre numérique | epub mobi azw3 fb2 cbz cbr pdf docx… | epub mobi azw3 pdf fb2 docx rtf txt | Calibre |
| Texte balisé | md html rst tex org ipynb docx odt epub | md html docx odt epub rst tex txt pdf | Pandoc |

La liste complète est aussi visible sur la page (« Formats pris en charge »).
Les réglages visent la qualité : vidéo H.264 CRF 18, MP3 V0, JPEG 92, MKV en copie sans réencodage quand c'est possible.

## Installation (Docker sur le NAS)

1. Copie le dossier `beta-tool` sur le NAS.
2. Dans `docker-compose.yml`, adapte les chemins de gauche :
   - `/downloads` : où arrivent les vidéos téléchargées ;
   - `/converted` : où arrivent les fichiers convertis.
3. Lance :
   ```sh
   docker compose up -d --build
   ```
   (Synology : *Container Manager → Projet → Créer*. QNAP : *Container Station → Applications → Créer*.)
   L'image pèse environ 1,5 Go à cause de LibreOffice et Calibre ; la première construction prend quelques minutes.
4. Ouvre `http://IP-DU-NAS:8080`.

## Icône et bannière

L'identité visuelle est dans `static/brand/` (`banner.jpg`, `icon.png`, `apple-touch-icon.png`, `favicon.ico`).
Ce dossier est monté dans le conteneur : pour changer une image, remplace le fichier en gardant son nom et recharge la page.
Les couleurs (`--accent`, `--accent-2`) sont en haut de `static/style.css`.

## Mise à jour

YouTube change souvent ; si les téléchargements échouent, reconstruis l'image pour avoir le dernier yt-dlp :
```sh
docker compose build --no-cache && docker compose up -d
```

## Ajouter un outil

Chaque outil est un module Python (`downloader.py`, `converter.py`) branché sur des routes `/api/...` dans `app.py`,
plus une section `view-…` dans `static/index.html` et une carte sur l'accueil.

## Notes

- Pas d'authentification : garde le site sur ton réseau local (ne l'expose pas sur Internet).
- Les résultats de conversion restent téléchargeables depuis la page pendant 24 h (`JOB_TTL_HOURS`), ceux copiés sur le NAS restent.
- Téléchargeur réservé à un usage personnel et aux contenus que tu as le droit de télécharger.
