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
| **Fichiers** | Explorateur de tous les dossiers du NAS : aperçu, envoi de dossiers entiers, renommer, déplacer, corbeille, zip, et « Ouvrir avec » les autres outils. |
| **Bêta Drop** | Partage des fichiers par lien (mot de passe, date d'expiration, nombre de téléchargements) ou crée une page de dépôt pour recevoir des fichiers. |
| **Médiathèque** | Regarde tes vidéos et écoute ta musique depuis le navigateur ; le lecteur continue quand tu changes de page. |
| **Album photo** | Tes photos rangées par date de prise de vue (EXIF), diaporama, import depuis le téléphone. |
| **Compresseur vidéo** | Vise une taille (ex. 25 Mo pour Discord, 2 Go pour un mail) ou une qualité ; découpe et redimensionnement. |
| **Studio Image** | Recadrer, pivoter, luminosité, contraste, filtres, redimensionner, et **détourage automatique** (suppression du fond, IA locale). |
| **Transcription** | Transforme un audio ou une vidéo en texte ou en sous-titres (SRT, VTT), en local avec Whisper. |
| **Questionnaires** | Formulaires et sondages avec lien public, résultats en graphiques, export Excel / CSV. |
| **Bêta Notes** | Notes en Markdown avec cases à cocher, couleurs, épingles, aperçu en direct. |
| **QR codes** | Crée (lien, Wi-Fi, contact, e-mail…) avec couleurs et logo, ou lis un QR code depuis la caméra ou une image. |
| **Liens courts** | `/s/mon-lien` vers une longue adresse, avec compteur de clics. |
| **Sauvegardes** | Copie planifiée de tes dossiers vers un autre disque, avec historique des versions. |
| **Coffre** | Gestionnaire de mots de passe compatible Bitwarden (Vaultwarden), optionnel. |
| **Abonnements** | Suis des chaînes YouTube, playlists ou podcasts : notification à chaque nouvelle vidéo (avec la miniature) et téléchargement automatique au choix. |
| **Presse-papier** | Copie un texte, un lien, une image ou un fichier sur un appareil, retrouve-le aussitôt sur les autres. |
| **Surveillance** | Vérifie sites, services (port TCP), ping et espace disque ; alerte en cas de panne et au retour ; page de statut publique `/statut`. |
| **Scanner** | Photo d'un document → bords détectés, page redressée et nettoyée (filtres « document »), PDF avec texte cherchable. |
| **Paperasse** | Factures, fiches de paie, impôts… lus (OCR), reconnus, renommés et rangés par catégorie et année ; échéances avec rappels ; recherche dans le texte. |
| **Stockage** | Carte de l'espace occupé, plus gros fichiers, doublons (comparaison du contenu), suggestions de rangement d'un dossier (avec annulation). |
| **Mails** | Boîtes iCloud, Gmail, Outlook, Orange, Free… (IMAP/SMTP) : lecture sûre (images pisteuses bloquées), réponses, pièces jointes vers le NAS ou Paperasse, notification des nouveaux mails. |
| **Agenda** | Agendas perso et agenda « Famille » partagé, rappels, synchronisés dans les deux sens avec les téléphones (CalDAV, Radicale), plus tes agendas iCloud, Google, Outlook, Nextcloud et liens .ics raccordés. |
| **Recettes** | Import depuis un lien (Marmiton, 750g…), portions ajustables, mode cuisine avec minuteurs, liste de courses partagée triée par rayon. |
| **Traduction** | Textes, documents (Word, OpenDocument, PDF) et sous-titres traduits sur le NAS (Argos Translate), sans service en ligne. |
| **VPN** | Accès à la maison depuis l'extérieur avec WireGuard (wg-easy) : appareils, QR codes, état des connexions. Optionnel. |

Autour des outils : **tableau de bord** (espace disque, outils épinglés, activité récente), **recherche globale** (`Ctrl K`),
**notifications push** sur le téléphone et l'ordinateur (même Bêta Tool fermé), **comptes utilisateurs** avec
**double authentification**, **appli installable** sur le téléphone (avec « Partager vers Bêta Tool »), interface en
**français ou anglais**, et une page **Réglages** pour activer ou désactiver chaque outil et installer les **mises à jour**.

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

## Réglages, comptes et mises à jour

**Outils** : Réglages → Outils, un interrupteur par outil. Un outil désactivé disparaît du menu, de l'accueil,
de la recherche, et ses adresses `/api/...` sont bloquées.

**Comptes** : tant qu'aucun compte n'existe, le site est en accès libre (ou protégé par `APP_PASSWORD`). Crée un
premier compte dans Réglages → Comptes : il devient administrateur et le site demande alors une connexion.
Les **membres** utilisent les outils ; seuls les **administrateurs** voient les réglages, les comptes et les
sauvegardes. Mot de passe administrateur perdu : supprime `/data/users.json`.

**Mises à jour** : Réglages → Mises à jour.
- Colle le **lien** d'une mise à jour (un `.zip`, ou un `latest.json` qui pointe vers le zip) ou **glisse le fichier**
  `.zip` : la nouvelle version s'installe dans `/data/versions` et le site redémarre tout seul en quelques secondes.
- Si la nouvelle version plante au démarrage, le lanceur (`launch.py`) revient automatiquement à la dernière
  version qui fonctionnait. L'historique permet aussi de revenir en arrière à la main.
- Enregistre une adresse de `latest.json` pour que le bouton « Vérifier » te signale les nouvelles versions.
- « Mettre à jour yt-dlp » récupère le dernier yt-dlp sans reconstruire l'image (utile quand YouTube change).
- Une mise à jour qui ajoute des logiciels système (marquée `rebuild`) demande de reconstruire l'image :
  `docker compose build --pull && docker compose up -d`.

Fabriquer une mise à jour (pour le développeur) : augmente le numéro dans `VERSION`, puis
```sh
python scripts/make_update.py --notes "Ce qui change" --url-base https://exemple.fr/maj/
```
Publie ensuite `dist/beta-tool-update-<version>.zip` et `dist/latest.json` au même endroit (une *release* GitHub
convient très bien). Le fichier contient une empreinte SHA-256 vérifiée à l'installation.

## Notifications push et double authentification

**Notifications push** : Réglages → Notifications → « Activer » sur chaque appareil. Le téléphone reçoit alors une
notification même quand Bêta Tool est fermé : téléchargement fini, nouvelle vidéo d'une chaîne suivie, rappel d'agenda,
échéance d'une facture, site en panne… Chacun choisit les outils qui le préviennent.
- Le navigateur exige une adresse en **https://** (voir « Appli sur le téléphone ») ; sur iPhone, il faut d'abord
  installer l'appli (« Sur l'écran d'accueil »), iOS 16.4 ou plus récent.
- Le NAS doit pouvoir joindre les services de notification d'Apple, Google et Mozilla (accès Internet sortant).
- Les clés du serveur (VAPID) sont créées automatiquement dans `/data/vapid.pem`.

**Double authentification** : Réglages → Comptes → « Activer » : scanne le QR code avec Google Authenticator,
Microsoft Authenticator, Authy, 2FAS, Bitwarden… La connexion demande ensuite un code à 6 chiffres. 10 codes de secours
sont donnés à l'activation. Un administrateur peut désactiver la double authentification d'un compte (téléphone perdu).

## Agenda : synchronisation des téléphones

Le serveur CalDAV [Radicale](https://radicale.org) (GPL v3) est intégré à Bêta Tool sur `/dav/`. Dans l'Agenda,
« Synchroniser » crée un mot de passe propre à l'agenda (différent de celui du site) :
- **iPhone / iPad** : Réglages → Calendrier → Comptes → Ajouter un compte → Autre → Compte CalDAV ; serveur = adresse du
  NAS (ex. `192.168.1.10:8080`), identifiant et mot de passe affichés dans Bêta Tool.
- **Android** : appli gratuite [DAVx⁵](https://www.davx5.com) ; les agendas apparaissent ensuite dans Google Agenda.
- **Thunderbird, Calendrier macOS, Outlook (avec extension)** : agenda CalDAV avec `http://IP-DU-NAS:8080/dav/`.

L'agenda « Famille » est partagé par tous les comptes. Les fichiers sont dans `/data/agenda` (à sauvegarder).
Hors de la maison, passe par une adresse en HTTPS ou par le VPN.

## Mails et agendas raccordés (comptes en ligne)

Chaque compte Bêta Tool raccorde ses propres boîtes mail et agendas (outil Mails, « Raccorder un agenda » dans
l'Agenda, ou Réglages → Comptes en ligne). Rien n'est copié sur le NAS : les mails et événements restent chez le
fournisseur, Bêta Tool les lit et y écrit directement. Les mots de passe et jetons sont chiffrés (AES-GCM) avec la clé
`/data/accounts/cle.bin` (garde-la avec tes sauvegardes de `/data`).

| Service | Mails | Agenda | Connexion |
|---|---|---|---|
| iCloud | oui | oui (lecture et écriture) | adresse Apple + **mot de passe pour app** ([account.apple.com](https://account.apple.com) → Connexion et sécurité) |
| Gmail / Google | oui | lecture seule par l'adresse secrète iCal, ou lecture et écriture avec la connexion Google | **mot de passe d'application** ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), validation en deux étapes requise) |
| Outlook, Hotmail, Microsoft 365 | oui | oui (lecture et écriture) | connexion Microsoft (code à saisir sur microsoft.com/devicelogin) ; sans elle : agenda publié en .ics, lecture seule |
| Orange, Free, SFR, La Poste, Yahoo, autres | oui (réglages détectés automatiquement) | — | adresse + mot de passe (ou mot de passe d'application) |
| Nextcloud, Synology Calendar, Fastmail… | — | oui (CalDAV) | adresse CalDAV + identifiant + mot de passe |
| Lien .ics / webcal | — | lecture seule (jours fériés, vacances scolaires…) | l'adresse du lien |

Les nouveaux mails de la boîte de réception sont vérifiés toutes les 2 minutes (`MAIL_POLL_SECONDS`) et envoyés en
notification push.

**Activer la connexion Microsoft (Outlook)** — une fois, par un administrateur, gratuit :
1. [portal.azure.com](https://portal.azure.com) → Inscriptions d'applications → Nouvelle inscription « Bêta Tool »,
   comptes « annuaire organisationnel et comptes Microsoft personnels », sans URI de redirection.
2. Authentification → « Autoriser les flux clients publics » : Oui.
3. Copie l'ID d'application (client) dans Réglages → Comptes en ligne (ou `MS_CLIENT_ID` dans `.env`).

**Activer la connexion Google Agenda (lecture et écriture)** — une fois, par un administrateur :
1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet, active « Google Calendar API ».
2. Écran de consentement OAuth (externe) avec la portée `…/auth/calendar`, puis **Publier l'application** (sinon
   la connexion expire au bout de 7 jours ; Google affichera « application non validée », c'est normal pour un usage
   familial).
3. Identifiants → ID client OAuth de type « Application de bureau » ; copie l'ID et le secret dans Réglages → Comptes
   en ligne (ou `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). À la connexion, Google renvoie vers
   `http://127.0.0.1:53682/…` (page d'erreur) : on colle cette adresse dans Bêta Tool, qui en extrait le code.

## Paperasse et Scanner

Les documents sont rangés dans `Documents (Bêta Work)/Paperasse/<Catégorie>/<Année>/` (variable `PAPERS_DIR` pour un
autre dossier). Tout ce qui est déposé dans `Paperasse/À classer` est traité automatiquement (pratique avec un scanner
réseau qui enregistre sur le NAS, ou une appli de scan du téléphone). La reconnaissance (catégorie, émetteur, date,
montant, échéance) se fait par mots-clés, sur le NAS ; l'OCR utilise Tesseract (français et anglais).

## Traduction

Les modèles [Argos Translate](https://www.argosopentech.com) (MIT) sont téléchargés depuis l'outil (onglet Langues,
administrateur), environ 100 Mo par paire de langues, dans `/data/models/traduction`, puis tout fonctionne hors ligne.
Entre deux langues étrangères, la traduction passe par l'anglais.

## VPN (WireGuard)

1. Dans `.env` : ajoute `vpn` à `COMPOSE_PROFILES`, choisis `VPN_PASSWORD` et renseigne `VPN_HOST` (adresse publique de
   la box ou nom DynDNS, ex. `maison.synology.me`). Lance `docker compose up -d`.
2. Sur la box : redirige le port **UDP 51820** vers le NAS.
3. Outil VPN → « Ajouter un appareil » → scanne le QR code avec l'appli WireGuard.

Le conteneur [wg-easy](https://github.com/wg-easy/wg-easy) utilise le module WireGuard du noyau : il est présent sur
la plupart des Linux, QNAP et Unraid, mais **pas sur Synology DSM** (il faut d'abord installer un paquet communautaire
WireGuard pour DSM). Alternative la plus simple : [Tailscale](https://tailscale.com) (paquet officiel sur Synology).

## Version anglaise

Réglages → Apparence → Langue : **English**. Le choix est enregistré pour le compte (et sur la page de connexion,
pour l'appareil). La traduction de l'interface est dans `static/i18n/en.json` (texte français → texte anglais).

## Sauvegardes

Monte un **autre disque** sur `/backup` (ligne commentée dans `docker-compose.yml`, ex. un disque USB), puis
ouvre l'outil « Sauvegardes » (réservé aux administrateurs) : choisis les dossiers, les jours et l'heure.
- **Incrémental** (conseillé) : une version datée par passage ; grâce aux liens physiques de rsync, seuls les fichiers
  modifiés prennent de la place. Le disque doit être formaté en ext4, Btrfs ou NTFS (pas exFAT/FAT32).
- **Miroir** : une seule copie à jour (ce qui est supprimé à la source l'est aussi dans la copie).
- Pour restaurer, ouvre une version : elle s'affiche dans Fichiers → Sauvegardes, d'où tu récupères ce qu'il faut.
- `TZ` (fuseau horaire) règle l'heure des sauvegardes.
- Le dossier `/data` (comptes, notes, questionnaires, coffre) n'est volontairement pas proposé ici, pour ne pas
  l'exposer dans Fichiers : sauvegarde `/volume1/docker/beta-tool/data` avec l'outil du NAS (Hyper Backup sur Synology).

## Coffre (Vaultwarden)

1. Ajoute `vault` à `COMPOSE_PROFILES` dans `.env` (ex. `COMPOSE_PROFILES=work,vault`) puis `docker compose up -d`.
2. **HTTPS obligatoire** : les navigateurs n'autorisent le chiffrement du coffre que sur une adresse en `https://`.
   - Synology : Panneau de configuration → Portail de connexion → Avancé → **Proxy inversé** : crée
     `https://coffre.mondomaine.fr` → `http://localhost:8082`, avec un certificat Let's Encrypt (Sécurité → Certificat).
   - Ou [Tailscale](https://tailscale.com/) avec `tailscale serve` pour une adresse HTTPS privée.
3. Renseigne `VAULT_URL=https://coffre.mondomaine.fr` dans `.env`, relance, crée les comptes, puis `VAULT_SIGNUPS=false`.
4. Installe les applis Bitwarden et choisis « Auto-hébergé » à la connexion.

Les données du coffre sont dans `/data/vault` : sauvegarde-les.

## Appli sur le téléphone

Ouvre le site dans Safari (iPhone) ou Chrome (Android) → « Sur l'écran d'accueil » / « Installer l'application ».
Sur Android, Bêta Tool apparaît ensuite dans le menu **Partager** : partage une vidéo YouTube vers lui et elle
arrive dans le Téléchargeur. L'installation et le partage demandent une adresse en HTTPS (même méthode que le coffre).

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
   - `/photos` : ta photothèque (Album photo) ;
   - `/depots` : les fichiers que l'on t'envoie avec Bêta Drop ;
   - `/backup` : le disque des sauvegardes (optionnel) ;
   - `/data` : comptes, réglages, notes, questionnaires, agendas, recettes, mises à jour, modèles d'IA.
3. Ouvre le fichier `.env` : change `ONLYOFFICE_JWT_SECRET`, choisis les services optionnels (`COMPOSE_PROFILES`).
4. Lance :
   ```sh
   docker compose up -d --build
   ```
   (Synology : *Container Manager → Projet → Créer*. QNAP : *Container Station → Applications → Créer*.)
   L'image pèse environ 1,7 Go à cause de LibreOffice, Calibre et Tesseract (+ environ 4 Go pour ONLYOFFICE) ; la première construction prend quelques minutes.
5. Ouvre `http://IP-DU-NAS:8080`, puis va dans Réglages → Comptes pour créer ton compte administrateur.

Les modèles d'IA (transcription ≈ 500 Mo pour `small`, détourage ≈ 180 Mo) se téléchargent au premier usage dans `/data/models`.

**Passer à la version 2.2** (Mails, agendas raccordés) : Réglages → Mises à jour → glisse
`beta-tool-update-2.2.0.zip`, depuis une 2.0 ou une 2.1.

**Passer à la version 2.1** depuis une 2.0 : Réglages → Mises à jour → glisse `beta-tool-update-2.1.0.zip` (les
nouvelles dépendances Radicale et SentencePiece sont installées automatiquement). Pour une installation neuve, utilise
l'archive complète.

**Passer de la version 1 à la version 2** : cette version change le Dockerfile (nouveaux logiciels, lanceur) ;
remplace le dossier, garde ton `.env` et tes chemins, puis `docker compose up -d --build`. Les mises à jour
suivantes passeront par Réglages → Mises à jour.

## Icône et bannière

L'identité visuelle est dans `static/brand/` (`banner.jpg`, `icon.png`, `apple-touch-icon.png`, `favicon.ico`).
Ce dossier est monté dans le conteneur : pour changer une image, remplace le fichier en gardant son nom et recharge la page.
Les couleurs (`--accent`, `--accent-2`) sont en haut de `static/style.css`.

## Reconstruire l'image

Pour avoir aussi les derniers FFmpeg, LibreOffice… :
```sh
docker compose build --no-cache --pull && docker compose up -d
```

## Ajouter un outil

Côté serveur, chaque outil est un module Python (les plus récents sont des *blueprints* Flask : `files.py`,
`drop.py`, `forms.py`…) enregistré dans `app.py`, et déclaré dans `settings.py` (`TOOLS`) pour pouvoir être désactivé.
Côté page, ajoute une entrée dans `static/js/registry.js` (menu, accueil, recherche et réglages en découlent) avec un
module `static/js/tools/<outil>.js` qui exporte `render(root, parts, query)` ; le tuto va dans `static/js/help.js`.

## Notes

- Sans compte ni `APP_PASSWORD`, le site n'a pas de mot de passe : garde-le alors sur ton réseau local.
- Les liens publics (Bêta Drop `/d/…`, questionnaires `/f/…`, liens courts `/s/…`) restent accessibles sans connexion,
  c'est voulu : il faut que le site soit joignable depuis Internet pour qu'ils marchent hors de chez toi.
- Les résultats de conversion restent téléchargeables depuis la page pendant 24 h (`JOB_TTL_HOURS`), ceux copiés sur le NAS restent.
- Téléchargeur réservé à un usage personnel et aux contenus que tu as le droit de télécharger.
