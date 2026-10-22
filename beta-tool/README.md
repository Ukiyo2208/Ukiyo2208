# Bêta Tool

Boîte à outils web auto-hébergée sur ton NAS. Tout tourne en local : aucun
fichier n'est envoyé à un service externe.

| Outil | Ce qu'il fait |
| --- | --- |
| **Téléchargeur** | Colle un lien YouTube ou d'un autre site pris en charge par [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Vimeo, TikTok, X, Instagram, SoundCloud, Twitch, Dailymotion…) : vidéo ou playlist téléchargée en **meilleure qualité** (jusqu'à 4K/8K, HDR) directement dans un dossier du NAS. |
| **Convertisseur** | Glisse-dépose des fichiers et choisis le format de sortie (dans l'esprit de ConvertX). Le résultat se télécharge depuis la page et/ou s'enregistre sur le NAS. |
| **Studio PDF** | Dans l'esprit d'Acrobat / BentoPDF : éditer et signer, remplir un formulaire, filigrane, numérotation, organiser les pages, fusionner, découper, compresser, protéger, déverrouiller, OCR. |
| **Décompresseur** | Ouvre un ZIP, RAR, 7Z, TAR.GZ, ISO… (même protégé), choisis les fichiers et extrais-les sur le NAS ou sur ton appareil. Crée aussi des ZIP. |
| **Bêta Work** | Suite bureautique : traitement de texte, tableur, présentations, compatibles Word / Excel / PowerPoint, enregistrement automatique, co-édition. Propulsé par ONLYOFFICE Docs. |

Chaque outil a un bouton **Aide** (tuto pas à pas, astuces, FAQ) et le site a un bouton **Suggestion**
pour envoyer une idée ou signaler un problème ; les suggestions sont listées sur la page « Suggestions »
et gardées dans `/data/suggestions.jsonl`.

## Studio PDF

| Outil | Où c'est traité |
| --- | --- |
| Éditer & signer (texte, signature dessinée/tapée/importée, image, surlignage, cadre, masque blanc, dessin), formulaires | Navigateur (pdf.js + pdf-lib) |
| Organiser (réordonner, pivoter, supprimer, insérer), fusionner, découper, filigrane, numérotation | Navigateur |
| Compresser | NAS (Ghostscript) |
| Protéger / déverrouiller (AES-256) | NAS (pikepdf) |
| OCR français/anglais | NAS (OCRmyPDF + Tesseract) |

Les traitements « navigateur » ne font jamais sortir le fichier de l'appareil. Les bibliothèques sont
incluses dans `static/vendor/` : le site fonctionne sans accès à Internet.

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

## Décompresseur

7-Zip (zip, 7z, rar, iso, cab…) et bsdtar (tar.gz, tar.xz…). Sécurités : les chemins qui sortent du dossier
et les liens symboliques sont ignorés, la taille décompressée est plafonnée (`MAX_EXTRACT_GB`, 50 Go) et
comparée à l'espace libre. Les fichiers vont dans `/extracted` (un dossier au nom de l'archive par défaut).

## Bêta Work

Bêta Tool s'occupe des fichiers (dossier `/documents`) et de l'interface ; l'édition est faite par
[ONLYOFFICE Docs](https://www.onlyoffice.com/) (Community Edition, open source AGPL v3), lancé dans un
second conteneur. Les deux se parlent avec des requêtes signées (JWT, `ONLYOFFICE_JWT_SECRET`).

- Activé par `COMPOSE_PROFILES=work` dans `.env` ; prévoir **4 Go de RAM** (2 Go minimum) pour ONLYOFFICE.
- Change `ONLYOFFICE_JWT_SECRET` dans `.env` avant le premier lancement.
- L'éditeur est servi sur le port **8081** ; si tu passes par un nom de domaine en HTTPS, renseigne `ONLYOFFICE_URL`
  (le navigateur refuse de mélanger une page HTTPS et un éditeur HTTP).
- Au premier démarrage, ONLYOFFICE met 1 à 2 minutes avant d'être prêt.
- Les documents supprimés vont dans `/documents/.corbeille`.
- Marque et licence : la licence d'ONLYOFFICE impose de garder son logo dans l'éditeur ; Bêta Work l'habille
  (barre, thème, pages de gestion) et affiche « Propulsé par ONLYOFFICE Docs ».

## Pas de NAS ?

Bêta Tool est un simple conteneur Docker : le NAS n'est qu'un endroit possible pour le faire tourner.

| Où l'installer | Pour qui |
| --- | --- |
| **Ton ordinateur** (Windows, Mac, Linux) avec [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Le plus simple pour essayer. Le site n'est disponible que quand l'ordinateur est allumé. |
| **Un mini-PC ou un Raspberry Pi 5** (≈ 80 à 150 €) | Un petit serveur toujours allumé à la maison, comme un NAS. Prévoir 8 Go de RAM avec Bêta Work. |
| **Un serveur loué (VPS)** (≈ 5 à 10 €/mois) | Accessible de partout. **Obligatoire** : `APP_PASSWORD` et un nom de domaine en HTTPS. |

Dans tous les cas : remplace les chemins `/volume1/...` de `docker-compose.yml` par des dossiers de la machine
(ex. `./donnees/videos`), et mets `STORAGE_NAME=serveur` (ou `PC`) dans `.env` pour que le site parle de
« serveur » au lieu de « NAS ». Chaque outil sait aussi rendre le résultat **directement sur l'appareil**
(bouton Télécharger / Récupérer), sans rien garder sur le serveur.

Pour ouvrir le site à d'autres personnes que toi, active `APP_PASSWORD`. Évite de proposer le Téléchargeur
au public : télécharger des contenus protégés pour d'autres engage ta responsabilité.

## Installation (Docker sur le NAS)

1. Copie le dossier `beta-tool` sur le NAS.
2. Dans `docker-compose.yml`, adapte les chemins de gauche :
   - `/downloads` : où arrivent les vidéos téléchargées ;
   - `/converted` : où arrivent les fichiers convertis ;
   - `/pdf` : où le Studio PDF enregistre (bouton « Sur le NAS ») ;
   - `/extracted` : les archives décompressées ;
   - `/documents` : les documents de Bêta Work ;
   - `/data` : les suggestions et la clé de session.
3. Ouvre le fichier `.env` : change `ONLYOFFICE_JWT_SECRET`, et éventuellement `APP_PASSWORD`.
4. Lance :
   ```sh
   docker compose up -d --build
   ```
   (Synology : *Container Manager → Projet → Créer*. QNAP : *Container Station → Applications → Créer*.)
   L'image pèse environ 1,7 Go à cause de LibreOffice, Calibre et Tesseract (+ environ 4 Go pour ONLYOFFICE) ; la première construction prend quelques minutes.
5. Ouvre `http://IP-DU-NAS:8080`.

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

Côté serveur, chaque outil est un module Python (`downloader.py`, `converter.py`, `pdftools.py`, `archives.py`,
`work.py`) branché sur des
routes `/api/...` dans `app.py`. Côté page, chaque outil est un module dans `static/js/` (une section `data-view`
dans `static/index.html`, une entrée de menu, une carte sur l'accueil) et son tuto se trouve dans `static/js/help.js`.

## Notes

- Sans `APP_PASSWORD`, le site n'a pas de mot de passe : garde-le alors sur ton réseau local.
- Les résultats de conversion restent téléchargeables depuis la page pendant 24 h (`JOB_TTL_HOURS`), ceux copiés sur le NAS restent.
- Téléchargeur réservé à un usage personnel et aux contenus que tu as le droit de télécharger.
