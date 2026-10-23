// Registre des outils : menu, accueil, recherche et réglages sont générés à partir de cette liste.
// `view` : section déjà présente dans index.html ; `load` : module chargé à la demande (render(root, parts)).

export const CATS = [
  ["medias", "Médias"],
  ["documents", "Documents"],
  ["fichiers", "Fichiers"],
  ["utilitaires", "Utilitaires"],
];

export const TOOLS = [
  { id: "telecharger", name: "Téléchargeur", icon: "download", tile: "", cat: "medias", view: "telecharger",
    desc: "Colle un lien, récupère la vidéo ou la musique en meilleure qualité.", chips: ["YouTube", "TikTok", "+1800 sites"] },
  { id: "video", name: "Compresseur vidéo", icon: "video", tile: "rose", cat: "medias", load: () => import("./tools/video.js"),
    desc: "Réduis une vidéo à la taille voulue, coupe le début et la fin.", chips: ["Discord", "WhatsApp", "Découpe"] },
  { id: "image", name: "Studio Image", icon: "image", tile: "violet", cat: "medias", load: () => import("./tools/image.js"),
    desc: "Recadre, retouche, redimensionne en lot, retire l'arrière-plan.", chips: ["Retouche", "Lot", "Détourage"] },
  { id: "transcription", name: "Transcription", icon: "mic", tile: "vert", cat: "medias", load: () => import("./tools/transcribe.js"),
    desc: "Transforme une vidéo ou un audio en texte et en sous-titres.", chips: ["Texte", "SRT", "VTT"] },
  { id: "medias", name: "Médiathèque", icon: "play", tile: "", cat: "medias", load: () => import("./tools/media.js"),
    desc: "Regarde tes vidéos et écoute ta musique, même sur téléphone.", chips: ["Vidéos", "Musique", "Playlist"] },
  { id: "photos", name: "Album photo", icon: "camera", tile: "ambre", cat: "medias", load: () => import("./tools/photos.js"),
    desc: "Tes photos rangées par date, avec partage d'album.", chips: ["Chronologie", "Albums", "Partage"] },

  { id: "convertir", name: "Convertisseur", icon: "convert", tile: "violet", cat: "documents", view: "convertir",
    desc: "Vidéo, audio, image, document, e-book… plus de 60 formats.", chips: ["MP4 → MP3", "HEIC → JPG", "Word → PDF"] },
  { id: "pdf", name: "Studio PDF", icon: "pdf", tile: "rose", cat: "documents", view: "pdf",
    desc: "Modifie, signe, remplis, organise, fusionne, compresse tes PDF.", chips: ["Signer", "Fusionner", "OCR"] },
  { id: "work", name: "Bêta Work", icon: "briefcase", tile: "bleu-vert", cat: "documents", view: "work",
    desc: "Documents, tableurs et présentations compatibles Office.", chips: ["Texte", "Tableur", "Présentations"] },
  { id: "notes", name: "Bêta Notes", icon: "notebook", tile: "ambre", cat: "documents", load: () => import("./tools/notes.js"),
    desc: "Notes et listes de tâches, rangées et cherchables.", chips: ["Markdown", "Tâches", "Dossiers"] },
  { id: "questionnaires", name: "Questionnaires", icon: "form", tile: "vert", cat: "documents", load: () => import("./tools/forms.js"),
    desc: "Crée un formulaire, partage le lien, analyse les réponses.", chips: ["Sondage", "Inscription", "Export Excel"] },

  { id: "fichiers", name: "Fichiers", icon: "folder", tile: "ambre", cat: "fichiers", load: () => import("./tools/files.js"),
    desc: "Parcours, range et ouvre tous les fichiers du NAS.", chips: ["Aperçu", "Déplacer", "Ouvrir avec"] },
  { id: "drop", name: "Bêta Drop", icon: "send", tile: "", cat: "fichiers", load: () => import("./tools/drop.js"),
    desc: "Partage des fichiers par lien, ou reçois-en de n'importe qui.", chips: ["Lien temporaire", "Mot de passe", "Dépôt"] },
  { id: "decompresser", name: "Décompresseur", icon: "archive", tile: "vert", cat: "fichiers", view: "decompresser",
    desc: "Ouvre un ZIP, RAR ou 7Z et extrais ce que tu veux.", chips: ["ZIP", "RAR", "7Z"] },
  { id: "sauvegardes", name: "Sauvegardes", icon: "shield", tile: "bleu-vert", cat: "fichiers", load: () => import("./tools/backup.js"), admin: true,
    desc: "Copie automatique de tes dossiers chaque nuit, avec historique.", chips: ["Planifié", "Incrémental", "Rapport"] },

  { id: "qr", name: "QR codes", icon: "qr", tile: "violet", cat: "utilitaires", load: () => import("./tools/qr.js"),
    desc: "Crée un QR code (lien, Wi-Fi, contact) ou lis-en un.", chips: ["Wi-Fi", "Contact", "Lecture"] },
  { id: "liens", name: "Liens courts", icon: "link", tile: "", cat: "utilitaires", load: () => import("./tools/links.js"),
    desc: "Raccourcis un long lien et compte les clics.", chips: ["Lien court", "Statistiques"] },
  { id: "coffre", name: "Coffre", icon: "key", tile: "rose", cat: "utilitaires", load: () => import("./tools/vault.js"),
    desc: "Gestionnaire de mots de passe compatible Bitwarden.", chips: ["Vaultwarden", "Applis", "Extensions"] },
];

export const SYSTEM = [
  { id: "suggestions", name: "Suggestions", icon: "lightbulb", tile: "ambre", view: "suggestions" },
  { id: "reglages", name: "Réglages", icon: "settings", tile: "", load: () => import("./tools/settings.js") },
];

export const byId = id => TOOLS.find(t => t.id === id) || SYSTEM.find(t => t.id === id);
