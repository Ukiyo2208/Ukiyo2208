# Intégrations domotique — état des lieux par marque

Architecture recommandée : **Home Assistant (HA)** comme hub central, et le dashboard
perso qui parle uniquement à l'API de HA (REST + WebSocket, jeton longue durée).
Un seul point d'entrée au lieu d'une dizaine d'API propriétaires.

```
Appareils ──> intégrations HA ──> API HA (REST / WebSocket) ──> Dashboard perso
```

| Appareil | Intégration HA | Type | Prérequis | Fiabilité |
|---|---|---|---|---|
| Somfy volets + garage | Overkiz (core) | Cloud ou local | Box TaHoma (Switch / v2). Moteurs io ou RTS via la box | Bonne (local recommandé) |
| Verisure alarme | Verisure (core) | Cloud, API non officielle | Compte Verisure, 2FA possible | Moyenne (peut casser) |
| Aqara lumières | Matter, HomeKit Controller, ou Zigbee2MQTT/ZHA | Local | Hub Aqara (M2/M3) **ou** dongle Zigbee | Bonne |
| Télécommande IR | Broadlink / SwitchBot / hub Aqara selon le modèle | Local | Préciser le modèle | Bonne |
| TV Samsung | Samsung Smart TV (local) ou SmartThings (cloud) | Local / Cloud | TV sur le réseau | Bonne |
| TV Philips | Philips TV (JointSpace) ou Android TV Remote | Local | Appairage par code PIN | Bonne |
| Samsung lave-linge + clim | SmartThings (core, OAuth) | Cloud officiel | Appareils dans l'app SmartThings | Bonne |
| Apple enceinte (HomePod) | Apple TV (pyatv) | Local | Même réseau | Bonne (média/volume seulement) |
| Siemens lave-linge | Home Connect (core, OAuth) | Cloud officiel | Compte développeur Home Connect ; « démarrage à distance » activé sur la machine | Bonne |
| Ford voiture | ha-fordpass (HACS) ou FordConnect Query (lecture seule) | Cloud, non officiel | Compte FordPass (idéalement un compte dédié) ; app développeur Ford pour FordConnect | Fragile — risque de blocage du compte |

## Points d'attention

- **Verisure** : désarmer l'alarme depuis le dashboard = point sensible. Exiger le code
  Verisure à chaque désarmement, ne jamais le stocker côté navigateur.
- **Ford** : pas d'API officielle grand public stable. Commencer en lecture seule
  (autonomie, position, verrouillage) via FordConnect Query.
- **Aqara** : le hub doit être compatible Matter, sinon passer par un dongle Zigbee.
- **Secrets** : tous les jetons dans `.env` (jamais commités) ; le dashboard ne parle
  qu'à HA, pas directement aux clouds des marques.
