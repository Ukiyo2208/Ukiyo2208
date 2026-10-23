// Tutoriels affichés dans le panneau « Aide » de chaque outil.
// steps : [titre, explication] · tips : astuces · faq : [question, réponse]

export const HELP = {
  home: {
    title: "Bienvenue sur Bêta Tool", icon: "home", tile: "",
    lead: "Bêta Tool regroupe plusieurs outils dans un seul site, hébergé sur ton NAS.",
    steps: [
      ["Choisis un outil", "Dans le menu à gauche (ou en bas sur téléphone) : Téléchargeur, Convertisseur, Studio PDF, Décompresseur ou Bêta Work."],
      ["Ouvre son tuto", "Chaque page a un bouton « Aide » qui explique l'outil étape par étape."],
      ["Récupère tes fichiers", "Les résultats se téléchargent depuis la page et/ou arrivent directement dans les dossiers du NAS."],
      ["Propose tes idées", "Le bouton violet « Suggestion » envoie une idée ou signale un problème."],
    ],
    tips: [
      "Ajoute le site à l'écran d'accueil de ton téléphone : il s'ouvre alors comme une appli.",
      "Le thème clair / sombre se change en bas du menu (ou avec l'icône lune sur téléphone).",
    ],
    faq: [
      ["Mes fichiers partent-ils sur Internet ?", "Non. Tout est traité sur ton NAS ; le Studio PDF travaille même directement dans ton navigateur."],
      ["Puis-je l'utiliser hors de chez moi ?", "Le site n'a pas de mot de passe : garde-le sur ton réseau local, ou passe par un VPN."],
    ],
  },
  telecharger: {
    title: "Tuto · Téléchargeur", icon: "download", tile: "",
    lead: "Récupère une vidéo, une playlist ou une musique en meilleure qualité, directement sur le NAS.",
    steps: [
      ["Copie le lien", "Sur YouTube, TikTok, Instagram, Vimeo, X, SoundCloud… utilise « Partager → Copier le lien »."],
      ["Colle-le dans le champ", "En cliquant dans le champ, le lien copié est collé tout seul. Tu peux en mettre plusieurs, un par ligne."],
      ["Choisis Vidéo ou Audio seul", "Vidéo = image + son en qualité maximale (4K/8K, HDR). Audio seul = uniquement la meilleure piste son."],
      ["Indique un sous-dossier (optionnel)", "Par exemple « Musique » ou « Clips » pour ranger tes fichiers."],
      ["Choisis où le garder", "« Garder une copie sur le NAS » coché : le fichier reste sur le NAS. Décoché : il est juste à récupérer sur ton appareil."],
      ["Clique sur « Télécharger »", "La progression s'affiche en bas. Une fois terminé, le bouton « Récupérer » l'enregistre sur ton téléphone ou ton ordinateur."],
    ],
    tips: [
      "Une playlist entière ? Colle simplement le lien de la playlist : elle sera rangée dans un dossier à son nom.",
      "Les vidéos sont en .mkv : c'est le seul format qui garde la qualité d'origine sans réencodage. Plex, Jellyfin et VLC le lisent.",
      "Besoin d'un MP4 ? Passe ensuite le fichier dans le Convertisseur.",
    ],
    faq: [
      ["Le téléchargement échoue, que faire ?", "Les sites changent souvent. Mets à jour le conteneur (voir le README) pour avoir la dernière version de yt-dlp."],
      ["Ça marche avec Netflix ou Spotify ?", "Non : ces plateformes protègent leurs contenus (DRM)."],
      ["Et les vidéos privées ?", "Les contenus privés ou réservés aux abonnés ne sont pas accessibles pour l'instant."],
    ],
  },
  convertir: {
    title: "Tuto · Convertisseur", icon: "convert", tile: "violet",
    lead: "Transforme un fichier d'un format vers un autre : plus de 60 formats pris en charge.",
    steps: [
      ["Ajoute tes fichiers", "Glisse-les dans la zone ou clique dessus pour les choisir. Tu peux en mettre plusieurs à la fois."],
      ["Choisis le format de sortie", "Chaque fichier a sa propre liste. « Tout convertir en » applique le même format à tous."],
      ["Choisis où enregistrer", "Coche « Enregistrer aussi sur le NAS » pour garder une copie dans le dossier des conversions."],
      ["Clique sur « Convertir »", "Les fichiers sont envoyés puis convertis ; la liste « Conversions » montre l'avancement."],
      ["Récupère le résultat", "Le bouton « Télécharger » apparaît quand c'est prêt."],
    ],
    tips: [
      "Photos d'iPhone (HEIC) → JPG : idéal pour les partager partout.",
      "Une vidéo → MP3 extrait directement la bande son.",
      "Un PDF → PNG/JPG donne une image par page, regroupées dans un fichier zip.",
      "Les formats proposés dépendent du fichier : si un format n'apparaît pas, cette conversion n'est pas possible.",
    ],
    faq: [
      ["Combien de temps les résultats restent-ils ?", "24 h dans la liste. La copie sur le NAS, elle, reste."],
      ["Il y a une taille maximale ?", "20 Go par fichier par défaut (réglable avec MAX_UPLOAD_GB)."],
      ["Pour modifier un PDF ?", "Utilise le Studio PDF : il est fait pour ça."],
    ],
  },
  pdf: {
    title: "Tuto · Studio PDF", icon: "pdf", tile: "rose",
    lead: "Tous les outils pour tes PDF, dans l'esprit d'Acrobat ou BentoPDF.",
    steps: [
      ["Choisis une action", "Éditer & signer, organiser, fusionner, découper, compresser, protéger, OCR…"],
      ["Ouvre ton PDF", "Glisse-le dans la zone ou clique pour le choisir."],
      ["Règle les options", "Chaque outil a son tuto dédié via le bouton « Aide »."],
      ["Récupère le résultat", "Télécharge-le, enregistre-le sur le NAS, ou ouvre-le dans l'éditeur pour continuer."],
    ],
    tips: [
      "Éditer, signer, organiser, fusionner, découper, filigrane et numérotation se font directement dans ton navigateur : le fichier ne quitte même pas ton appareil.",
      "Compresser, protéger, déverrouiller et OCR passent par le NAS (jamais par Internet).",
      "Tu peux enchaîner : fusionner → « Ouvrir dans l'éditeur » → signer → compresser.",
    ],
    faq: [
      ["Mon PDF est protégé par mot de passe", "Passe d'abord par « Déverrouiller », puis utilise les autres outils."],
      ["Et pour convertir un PDF en Word ou en images ?", "Le Convertisseur s'en charge (PDF → PNG/JPG/TXT, Word → PDF, image → PDF…)."],
    ],
  },
  "pdf/editer": {
    title: "Tuto · Éditer & signer", icon: "edit", tile: "rose",
    lead: "Ajoute du texte, ta signature, des images, surligne, masque ou dessine sur ton PDF.",
    steps: [
      ["Ouvre ton PDF", "Les pages s'affichent avec une barre d'outils en haut."],
      ["Choisis un outil", "Texte, Signature, Image, Surligner, Cadre, Masquer (rectangle blanc) ou Dessin."],
      ["Clique ou trace sur la page", "Texte/Signature/Image : clique à l'endroit voulu. Surligner/Cadre/Masquer : trace un rectangle. Dessin : dessine librement."],
      ["Ajuste", "Avec « Sélection », déplace un élément, agrandis-le avec la poignée bleue, change sa couleur ou sa taille dans le panneau à droite. Double-clique un texte pour le modifier."],
      ["Remplis le formulaire (si le PDF en a un)", "Les champs apparaissent dans le panneau « Formulaire » : saisis tes réponses."],
      ["Clique sur « Enregistrer le PDF »", "Le nouveau PDF est généré : télécharge-le ou envoie-le sur le NAS."],
    ],
    tips: [
      "Ta signature est mémorisée dans ce navigateur : la prochaine fois, un clic suffit.",
      "Signature : dessine-la au doigt ou à la souris, tape ton nom en écriture manuscrite, ou importe une photo de ta signature.",
      "« Masquer » cache un texte sous un rectangle blanc (attention : le texte d'origine reste présent dans le fichier ; pour une vraie suppression, convertis ensuite le PDF en image).",
      "Touche Suppr pour effacer l'élément sélectionné, Ctrl+Z pour annuler.",
    ],
    faq: [
      ["Puis-je modifier le texte existant du PDF ?", "Pas directement : masque l'ancien texte avec « Masquer » puis écris le nouveau par-dessus avec « Texte »."],
      ["La signature a-t-elle une valeur légale ?", "C'est une signature simple (image), comme une signature scannée. Pour une signature électronique qualifiée, il faut un prestataire certifié."],
    ],
  },
  "pdf/organiser": {
    title: "Tuto · Organiser les pages", icon: "layers", tile: "rose",
    lead: "Réordonne, pivote, supprime ou ajoute des pages.",
    steps: [
      ["Ouvre ton PDF", "Chaque page s'affiche en miniature."],
      ["Réordonne", "Glisse une miniature à sa nouvelle place, ou utilise les flèches ◀ ▶."],
      ["Pivote ou supprime", "Boutons ↺ ↻ pour tourner, corbeille pour supprimer."],
      ["Ajoute des pages", "« Ajouter un PDF » insère les pages d'un autre fichier ; « Page blanche » ajoute une page vide."],
      ["Clique sur « Enregistrer le PDF »", "Le PDF réorganisé est prêt."],
    ],
    tips: ["Les pastilles de couleur indiquent de quel fichier vient chaque page quand tu en mélanges plusieurs."],
    faq: [],
  },
  "pdf/fusionner": {
    title: "Tuto · Fusionner", icon: "merge", tile: "rose",
    lead: "Assemble plusieurs PDF en un seul.",
    steps: [
      ["Ajoute tes PDF", "Glisse-les tous dans la zone (ou ajoute-les en plusieurs fois)."],
      ["Mets-les dans l'ordre", "Glisse les lignes ou utilise les flèches ▲ ▼."],
      ["Clique sur « Fusionner »", "Un seul PDF est créé, dans l'ordre choisi."],
    ],
    tips: ["Pour mélanger des pages précises de plusieurs fichiers, utilise plutôt « Organiser les pages »."],
    faq: [],
  },
  "pdf/decouper": {
    title: "Tuto · Découper / extraire", icon: "scissors", tile: "rose",
    lead: "Sépare un PDF en plusieurs fichiers, ou extrais quelques pages.",
    steps: [
      ["Ouvre ton PDF", "Le nombre de pages s'affiche."],
      ["Choisis le mode", "Extraire des pages (un fichier), une page par fichier, par groupes de N pages, ou selon tes plages."],
      ["Indique les pages si besoin", "Exemple : « 1-3, 5, 8-10 ». Pour plusieurs fichiers selon des plages, sépare-les par « ; » : « 1-3 ; 4-6 »."],
      ["Clique sur « Découper »", "Un seul fichier → PDF ; plusieurs fichiers → archive zip."],
    ],
    tips: ["« fin » est accepté pour la dernière page : « 5-fin »."],
    faq: [],
  },
  "pdf/compresser": {
    title: "Tuto · Compresser", icon: "compress", tile: "rose",
    lead: "Réduis le poids d'un PDF pour l'envoyer par mail ou le stocker.",
    steps: [
      ["Ouvre ton PDF", ""],
      ["Choisis le niveau", "Légère (qualité impression), Équilibrée (recommandée), Forte (le plus léger, images moins nettes)."],
      ["Clique sur « Compresser »", "Le gain de place s'affiche à la fin."],
    ],
    tips: ["Les PDF pleins de photos ou de scans gagnent le plus. Un PDF de texte pur est souvent déjà optimisé."],
    faq: [],
  },
  "pdf/proteger": {
    title: "Tuto · Protéger", icon: "lock", tile: "rose",
    lead: "Ajoute un mot de passe d'ouverture et limite ce qu'on peut faire du document.",
    steps: [
      ["Ouvre ton PDF", ""],
      ["Choisis un mot de passe", "Il sera demandé à l'ouverture du fichier."],
      ["Règle les autorisations", "Impression, copie du texte, modification."],
      ["Clique sur « Protéger »", "Chiffrement AES-256."],
    ],
    tips: ["Note ton mot de passe : sans lui, impossible d'ouvrir le fichier."],
    faq: [],
  },
  "pdf/deverrouiller": {
    title: "Tuto · Déverrouiller", icon: "unlock", tile: "rose",
    lead: "Retire le mot de passe d'un PDF dont tu connais le code.",
    steps: [
      ["Ouvre ton PDF protégé", ""],
      ["Saisis le mot de passe", "Laisse vide si le PDF s'ouvre sans code mais bloque l'impression ou la copie."],
      ["Clique sur « Déverrouiller »", "Tu obtiens un PDF sans protection."],
    ],
    tips: [],
    faq: [],
  },
  "pdf/filigrane": {
    title: "Tuto · Filigrane", icon: "droplet", tile: "rose",
    lead: "Ajoute un texte en transparence sur toutes les pages (CONFIDENTIEL, COPIE…).",
    steps: [
      ["Ouvre ton PDF", ""],
      ["Écris ton texte", "Choisis taille, couleur, transparence et angle."],
      ["Choisis la disposition", "Au centre, ou en mosaïque sur toute la page."],
      ["Clique sur « Appliquer »", ""],
    ],
    tips: ["Une transparence autour de 20 % reste lisible sans gêner la lecture."],
    faq: [],
  },
  "pdf/numeroter": {
    title: "Tuto · Numéroter les pages", icon: "hash", tile: "rose",
    lead: "Ajoute les numéros de page automatiquement.",
    steps: [
      ["Ouvre ton PDF", ""],
      ["Choisis le format et la position", "« 1 », « Page 1 », « Page 1 sur 12 »… en bas ou en haut, à gauche, au centre ou à droite."],
      ["Options", "Commencer à un autre numéro, ne pas numéroter la page de garde."],
      ["Clique sur « Numéroter »", ""],
    ],
    tips: [],
    faq: [],
  },
  "pdf/ocr": {
    title: "Tuto · OCR (reconnaissance de texte)", icon: "scan", tile: "rose",
    lead: "Transforme un scan en PDF dont on peut rechercher et copier le texte.",
    steps: [
      ["Ouvre ton PDF scanné", ""],
      ["Choisis la langue", "Français, anglais, ou les deux."],
      ["Clique sur « Lancer l'OCR »", "Compte quelques secondes par page. Les pages penchées sont redressées."],
    ],
    tips: ["Les pages qui contiennent déjà du texte sont laissées telles quelles, sauf si tu coches « Refaire l'OCR partout »."],
    faq: [],
  },
  decompresser: {
    title: "Tuto · Décompresseur", icon: "archive", tile: "vert",
    lead: "Ouvre une archive compressée et récupère son contenu, en entier ou seulement certains fichiers.",
    steps: [
      ["Glisse ton archive", "ZIP, RAR, 7Z, TAR.GZ, ISO… Si elle est protégée, le mot de passe est demandé."],
      ["Choisis les fichiers", "Tout est coché par défaut. Décoche ce dont tu n'as pas besoin ; un dossier coche ou décoche tout son contenu. La recherche aide dans les grosses archives."],
      ["Choisis la destination", "Sur le NAS (dans le dossier des fichiers décompressés) ou Sur mon appareil (un seul fichier tel quel, plusieurs fichiers regroupés en .zip)."],
      ["Clique sur « Extraire »", "Le résultat s'affiche en dessous."],
    ],
    tips: [
      "Le dossier de destination porte par défaut le nom de l'archive ; tu peux en indiquer un autre.",
      "En bas de la page, « Créer une archive ZIP » fait l'inverse : regrouper plusieurs fichiers dans un .zip.",
      "Les archives piégées (fichiers qui sortent du dossier, liens, archives qui « explosent ») sont bloquées.",
    ],
    faq: [
      ["Mon RAR ne s'ouvre pas", "Certains RAR très récents ou chiffrés ne sont pas pris en charge par les outils libres. Convertis-le en ZIP sur l'ordinateur d'origine si possible."],
      ["Y a-t-il une taille maximale ?", "50 Go une fois décompressé par défaut (réglable avec MAX_EXTRACT_GB)."],
    ],
  },
  work: {
    title: "Tuto · Bêta Work", icon: "briefcase", tile: "bleu-vert",
    lead: "Ta suite bureautique dans le navigateur : traitement de texte, tableur et présentations, compatibles Word, Excel et PowerPoint.",
    steps: [
      ["Crée ou importe un document", "Les grandes cartes créent un document, un tableur ou une présentation vierge. « Importer » ajoute tes fichiers Word, Excel, PowerPoint ou PDF."],
      ["Ouvre-le", "Clique sur son nom : l'éditeur s'ouvre en plein écran."],
      ["Travaille normalement", "Mise en forme, tableaux, formules, graphiques, commentaires, suivi des modifications… comme dans Office."],
      ["C'est enregistré tout seul", "Chaque modification est sauvegardée sur le NAS. La flèche en haut à gauche ramène à la liste."],
    ],
    tips: [
      "Vous pouvez être plusieurs sur le même document en même temps : chacun voit le curseur des autres, avec son prénom.",
      "Les fichiers sont de vrais .docx / .xlsx / .pptx : tu peux les ouvrir ensuite avec Word, Excel ou LibreOffice.",
      "Supprimer un document le met dans le dossier « .corbeille » : rien n'est perdu par erreur.",
      "Pour un PDF à remplir ou à signer, le Studio PDF est souvent plus pratique.",
    ],
    faq: [
      ["L'éditeur ne s'affiche pas", "Le service ONLYOFFICE met 1 à 2 minutes à démarrer après un redémarrage du NAS. S'il ne vient jamais, vérifie qu'il est activé (README, « Bêta Work »)."],
      ["Qu'est-ce qu'ONLYOFFICE ?", "L'éditeur open source (licence AGPL v3) qui fait tourner Bêta Work. Il fonctionne sur ton NAS : tes documents ne partent nulle part."],
      ["Les anciens formats .doc / .xls / .ppt ?", "Ils s'ouvrent en lecture ; pour les modifier, enregistre-les au format moderne depuis l'éditeur (Fichier → Télécharger en .docx…)."],
    ],
  },
  reglages: {
    title: "Tuto · Réglages", icon: "settings", tile: "",
    lead: "Adapte Bêta Tool à ton usage : outils affichés, comptes, mises à jour, apparence.",
    steps: [
      ["Outils", "Active ou désactive chaque outil d'un clic : il disparaît du menu, de l'accueil et de la recherche pour tout le monde."],
      ["Comptes", "Crée un compte administrateur pour protéger le site, puis un compte par personne (rôle Membre ou Administrateur)."],
      ["Mises à jour", "Colle le lien d'une nouvelle version (ou glisse le fichier .zip) : elle s'installe et le site redémarre tout seul."],
      ["Apparence", "Thème, notifications du navigateur, installation de l'appli sur ton téléphone."],
    ],
    tips: [
      "Si une mise à jour ne démarre pas, Bêta Tool revient automatiquement à la version précédente.",
      "L'onglet Mises à jour garde l'historique : tu peux revenir à une ancienne version à tout moment.",
      "« Mettre à jour yt-dlp » répare la plupart des soucis du Téléchargeur sans rien réinstaller.",
    ],
    faq: [
      ["J'ai perdu le mot de passe administrateur", "Supprime le fichier users.json dans le dossier /data du NAS : le site repasse en accès libre et tu pourras recréer un compte."],
      ["Une mise à jour dit qu'il faut reconstruire l'image", "Elle apporte de nouveaux logiciels système : sur le NAS, lance « docker compose build --pull && docker compose up -d »."],
    ],
  },
  suggestions: {
    title: "Tuto · Suggestions", icon: "lightbulb", tile: "ambre",
    lead: "Une idée d'outil, une amélioration, un bug ? Dis-le !",
    steps: [
      ["Clique sur « Suggestion »", "Le bouton violet en bas à droite, présent sur toutes les pages."],
      ["Choisis le type", "Idée d'outil, amélioration ou problème, et l'outil concerné."],
      ["Écris ton message et envoie", "Il est enregistré sur le NAS et visible sur cette page."],
    ],
    tips: ["Pour un problème, décris ce que tu faisais et le message d'erreur affiché."],
    faq: [],
  },
};

HELP["pdf/formulaire"] = HELP["pdf/editer"];
