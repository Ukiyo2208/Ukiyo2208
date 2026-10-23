# Bêta IA : app de la tablette (Android)

La tablette joue le rôle des **yeux et des oreilles** de Bêta :

1. Elle écoute en continu le mot d'activation (openWakeWord, 100 % sur la tablette).
2. Quand elle l'entend, elle émet un bip, allume la caméra frontale et reconnaît le visage avec YuNet + SFace.
   Seul le prénom quitte la tablette, jamais d'image.
3. Elle enregistre ta phrase et s'arrête toute seule quand tu te tais.
4. Elle envoie l'audio et le prénom au NAS (`beta-nas`), puis lit la réponse à voix haute.

Elle fonctionne sur Android 8 ou plus récent. Elle n'utilise pas Google Play, AndroidX ni les services Google.

---

## 1. Obtenir l'APK

**Option A : GitHub (sans rien installer).** À chaque modification du dossier `beta-tablette/`,
GitHub construit l'APK tout seul (workflow `.github/workflows/apk-tablette.yml`).
Va dans l'onglet **Actions** du dépôt, ouvre la dernière exécution « APK tablette Bêta »
et télécharge **beta-tablette-apk** en bas de la page, dans la section *Artifacts*.

**Option B : Android Studio.** Ouvre le dossier `beta-tablette`, attends la synchronisation,
puis lance *Build → Build APK(s)*. Les modèles d'IA sont téléchargés automatiquement à la
première compilation (environ 45 Mo).

## 2. Installer sur la tablette

1. Copie le fichier `.apk` sur la tablette (câble USB, Google Drive, mail…) et ouvre-le.
2. Android demande d'autoriser l'installation d'**applications inconnues** pour l'appli qui ouvre
   le fichier. Accepte.
3. Au premier lancement, autorise le **micro**, la **caméra** et les **notifications**.
4. **Important :** dans *Paramètres Android → Applications → Bêta → Batterie*, choisis
   **Non restreinte** (le nom varie selon les marques). Sinon, Android coupe l'écoute au bout d'un moment.

## 3. Configurer

Dans **Réglages** :

| Réglage | Valeur |
|---|---|
| Adresse du NAS | `http://IP_DU_NAS:8800` (la même que pour tester `/sante`) |
| Jeton | Le `BETA_TOKEN` du fichier `.env` du NAS |

Appuie sur **Tester la connexion**. Le message doit indiquer « Bêta OK · Home Assistant OK ».
Appuie ensuite sur **Enregistrer**.

Dans **Visages** :
1. Écris ton prénom **exactement comme dans `config/config.yaml` du NAS** (ex : `bastien`).
2. Mets-toi face à la tablette, puis appuie sur **Enregistrer ce visage**. 8 images sont prises en quelques secondes.
3. Recommence avec et sans lunettes, ou le soir avec un autre éclairage : chaque enregistrement s'ajoute aux précédents.
4. Fais de même pour chaque personne de la maison.

## 4. Le mot « Hey Bêta »

L'APK contient le modèle **« Hey Jarvis »** d'openWakeWord. Il sert à tout tester tout de suite :
dis « Hey Jarvis, allume la lumière du salon ».

Pour le vrai « Hey Bêta », il faut entraîner ton propre modèle. C'est gratuit, ça prend environ 1 heure
et tu n'as pas besoin d'enregistrer ta voix :

1. Ouvre le notebook d'entraînement automatique d'openWakeWord dans Google Colab
   (dépôt GitHub `dscripka/openWakeWord`, dossier `notebooks`, fichier `automatic_model_training.ipynb`).
2. Mets comme phrase cible **`hey bayta`**. L'orthographe phonétique aide les voix de synthèse
   anglaises à prononcer « bêta » à la française.
3. Lance toutes les cellules. À la fin, télécharge le fichier `.onnx` produit.
4. Mets ce fichier sur la tablette. Dans **Réglages**, appuie sur **Importer hey_beta.onnx**,
   puis sur **Enregistrer**.

Si le modèle se déclenche trop souvent, monte la **sensibilité** (0,6 ou 0,7).
S'il ne t'entend pas, baisse-la (0,3 ou 0,4). La barre de l'écran principal montre le score en direct.

## 5. En faire un vrai « boîtier » Bêta

- **Mode kiosque** (dans Réglages) : Bêta remplace l'écran d'accueil. Après un redémarrage
  ou un appui sur le bouton Accueil, la tablette revient toujours sur Bêta.
  Au premier appui sur Accueil, choisis **Bêta** puis **Toujours**.
- Laisse la tablette **branchée** : l'écran reste allumé tant que Bêta est affiché.
- Si les visages ne sont **jamais** reconnus alors que tu es bien en face, ta tablette tourne
  peut-être l'image de la caméra d'une façon inhabituelle. Essaie `90`, `180` ou `270` dans
  *Rotation caméra*, puis réenregistre les visages.

## Dépannage

| Symptôme | Solution |
|---|---|
| « Jeton refusé par le NAS » | Le jeton ne correspond pas à `BETA_TOKEN` dans `.env` |
| « Le NAS ne répond pas » | Mauvaise IP ou port, ou conteneur `beta` arrêté (`sudo docker logs beta`) |
| Tu es reconnu comme « inconnu » | Réenregistre ton visage. Vérifie que le prénom est identique dans `config.yaml` |
| L'écoute s'arrête toute seule | Mets la batterie de Bêta sur « Non restreinte » (étape 2.4) |
| Bêta se déclenche quand il parle | Ça ne devrait pas arriver : l'écoute est coupée pendant ses réponses. Sinon, baisse le volume |

## Organisation du code

| Fichier | Rôle |
|---|---|
| `BetaService.kt` | Service permanent : micro → wake word → caméra + enregistrement → NAS → réponse |
| `WakeWord.kt` | openWakeWord avec ONNX Runtime (scores identiques à la version Python) |
| `Visages.kt`, `CameraFrontale.kt` | YuNet + SFace avec OpenCV, empreintes stockées dans `visages.json` |
| `Enregistreur.kt` | Détecte la fin de la phrase et produit le WAV 16 kHz attendu par le NAS |
| `ClientNas.kt` | Appel de `POST /v1/commande` |
| `MainActivity`, `ReglagesActivity`, `VisagesActivity` | Les trois écrans |
