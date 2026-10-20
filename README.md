# Bêta OS 5 — Maison intelligente

Tableau de bord domotique au thème « Japon nocturne » (glassmorphism bleu néon), reproduit d'après les maquettes de référence :
écran verrouillé, Accueil, Extérieur, RDC, Étage 1 — plus Étage 2, Énergie, Multimédia, NAS, Calendrier, Mails, Bêta IA et Paramètres.

## Lancer

Ouvrir `index.html` depuis le **dossier complet** (les images et scripts sont dans `assets/`, `css/`, `js/`).
Idéalement via un petit serveur local : `python3 -m http.server` puis `http://<ip>:8000`.
`dashboard.html` redirige vers `index.html#accueil` (compatibilité anciens raccourcis).

## Mise en page

Chaque écran est une « scène » aux dimensions des maquettes (1536×1024, Accueil 1672×941) mise à l'échelle de la tablette :
les positions des cartes reprennent celles des captures. Sur smartphone / tablette en portrait, l'interface passe en
mode fluide (cartes empilées + dock de navigation en bas).

## Fonctionnel

- Verrouillage : empreinte animée, choix du profil (4 profils + Invité à accès limité), raccourcis Mails/Calendrier/NAS/Musique/Plex.
- Pièces : éclairages (couleur RGB + luminosité), volets (animés), climatisation, appareils, caméras (détections, plein écran), aspirateur, tondeuse, arrosage, store, borne.
- Actions rapides et scènes (tout éteindre, volets fermés, mode soir/jour, éco…).
- Météo réelle Open-Meteo (ville configurable), horloge en direct.
- Musique : radios en direct (Radio France, NRJ, FG), playlists YouTube éditables, favoris, Media Session iOS.
- Calendrier mensuel (ajout/modification/suppression, import .ics), mails de démonstration, NAS.
- Bêta IA : assistant local en français (« éteins le RDC », « ferme les volets étage 1 », « mets 21 degrés », « météo »…), dictée vocale si le navigateur la permet.
- **Home Assistant** (optionnel) : Paramètres › Home Assistant → URL + jeton longue durée, puis « Associer les entités ».
  Ajouter l'origine de Bêta OS à `http: cors_allowed_origins` dans `configuration.yaml`. Sans configuration, tout fonctionne en mode démo.
- Sauvegarde/restauration JSON des réglages (stockés dans le navigateur).

## Structure

```
index.html            application (une seule page, routes #accueil, #rdc…)
css/beta.css          thème et mises en page
js/icons.js           icônes SVG, torii, logo Bêta IA, Plex
js/data.js            profils, appareils, caméras, médias, mails
js/core.js            état, rendu réactif, routeur, météo, Home Assistant, musique
js/components.js      barre latérale, en-têtes, tuiles d'appareils, caméras, Plex, musique
js/pages-*.js         pages
assets/               fonds, photos des pièces, caméras, avatars, médias
```
