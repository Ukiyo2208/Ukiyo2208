# Installer Bêta IA en une commande

Tout s'installe et se configure tout seul sur le NAS : Home Assistant (avec ton compte et
son jeton), la reconnaissance vocale, la voix, le modèle d'IA local, Bêta, la présence par caméras,
et en option OpenClaw avec le tri des documents. À la fin, un **QR code** s'affiche : la tablette
le scanne et elle est configurée.

## 1. Télécharger

Sur ton PC, télécharge le projet :
https://github.com/Ukiyo2208/Ukiyo2208/archive/refs/heads/claude/beta-ia-local-voice-kd7s5z.zip

Dézippe-le, puis copie le dossier sur le NAS, par exemple dans le dossier partagé `docker`.

## 2. Installer (en SSH sur le NAS)

UGOS : *Panneau de configuration → Terminal → activer SSH*, puis depuis ton PC
`ssh TON_UTILISATEUR@IP_DU_NAS`.

```bash
cd /volume1/docker/Ukiyo2208-claude-beta-ia-local-voice-kd7s5z    # le dossier copié
sudo bash installer.sh
```

Le script pose 6 questions, chacune avec une réponse proposée : appuie sur Entrée pour la garder.

| Question | Réponse proposée |
|---|---|
| Dossier d'installation | `/volume1/docker/beta` |
| Ton prénom | `bastien` |
| Pièce de la tablette | `salon` |
| Installer OpenClaw et le tri des documents ? | `o` |
| Dossier des documents | `/volume1/Documents` |
| Compte Home Assistant (identifiant, mot de passe) | ton prénom, mot de passe généré |
| Clé de l'IA web Claude | vide = 100 % local |

Ensuite, tout se fait seul. Compte **15 à 30 minutes** la première fois, surtout pour télécharger
les modèles d'IA (environ 8 Go).

Sans aucune question : `sudo bash installer.sh --auto`.

## 3. La tablette

1. Installe l'APK Bêta (voir `beta-tablette/README.md`).
2. Ouvre l'app : elle affiche directement l'écran **« Connexion au NAS »**.
3. Montre-lui le QR code affiché à la fin de l'installation. Tu peux aussi l'afficher depuis
   n'importe quel navigateur : `http://IP_DU_NAS:8800/tableau` → **Afficher le QR d'appairage**.

La tablette récupère l'adresse du NAS, le jeton et sa pièce : il n'y a rien à taper.

## 4. Ensuite

- Dans **Home Assistant** (`http://IP_DU_NAS:8123`, avec le compte créé par l'installateur) :
  ajoute tes appareils et range-les dans des pièces.
- **Tableau de bord** de Bêta : `http://IP_DU_NAS:8800/tableau`.
- **Tous les codes et toutes les commandes** : `sudo /volume1/docker/beta/beta-nas/outils/fiche-api.sh`.
- **Caméras Reolink** : section `cameras` de `beta-nas/config/config.yaml` (voir `beta-nas/README.md`, étape 8).

## Mettre à jour

Télécharge la nouvelle version, puis relance `sudo bash installer.sh` depuis son dossier. Tes réglages,
tes comptes, tes jetons et tes données sont conservés : seul le code est remplacé.

## Si quelque chose bloque

| Message | Solution |
|---|---|
| « Docker est introuvable » | Installe l'application **Docker** depuis le Centre d'applications d'UGOS |
| « Jeton Home Assistant non créé » | Ton compte Home Assistant existait déjà avec un autre mot de passe. Crée un jeton dans HA (Profil → Sécurité), puis `sudo …/fiche-api.sh regler HA_TOKEN <jeton>` |
| Un service est rouge dans le tableau de bord | `sudo …/fiche-api.sh logs` pour voir son journal |
