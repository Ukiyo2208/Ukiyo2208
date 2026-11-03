# OpenClaw sur le NAS UGREEN (UGOS Pro)

OpenClaw tourne dans Docker sur le NAS et utilise **tes modèles locaux** : ceux de l'Ollama déjà
installé pour Bêta (conteneur `beta-ollama`). Rien ne part sur Internet, sauf si tu ajoutes toi-même
une clé d'IA en ligne.

```
Navigateur (PC, téléphone) ──→ OpenClaw (NAS, port 18789) ──→ beta-ollama (NAS) ──→ ton modèle
```

> **À savoir avant de commencer :** OpenClaw est un *agent*. Il garde beaucoup de contexte
> (32 000 tokens par défaut) et appelle des outils. Sur le processeur N100, sans carte graphique,
> une réponse peut prendre **une à plusieurs minutes**. Pour discuter et tester, ça fonctionne.
> Pour un usage confortable, voir « Aller plus vite » en bas.

## 1. Préparer le modèle

Bêta (`beta-nas`) doit déjà tourner. Télécharge un modèle capable d'utiliser des outils
(environ 6 Go, une seule fois) :

```bash
sudo docker exec beta-ollama ollama pull qwen3.5:9b
sudo docker exec beta-ollama ollama list      # tes modèles disponibles
```

Tu as déjà d'autres modèles dans Ollama ? Tu peux les utiliser à la place : remplace
`qwen3.5:9b` par leur nom partout dans ce guide.

## 2. Copier le dossier et créer la configuration

Copie le dossier `openclaw-nas` dans `/volume1/docker/openclaw-nas`, puis, en SSH :

```bash
cd /volume1/docker/openclaw-nas
cp .env.example .env
openssl rand -hex 32               # copie le résultat après OPENCLAW_GATEWAY_TOKEN= dans .env
nano .env
mkdir -p data/config data/workspace data/secrets
sudo chown -R 1000:1000 data       # OpenClaw tourne avec l'utilisateur 1000
sudo docker network ls | grep beta # doit afficher beta-nas_default (sinon, mets le bon nom dans BETA_RESEAU)
```

## 3. Première configuration (une seule fois)

```bash
sudo docker compose pull
sudo docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --no-install-daemon
```

Dans les questions :
- **Fournisseur de modèle** : choisis **Ollama**, *local only*.
- **Adresse d'Ollama** : `http://beta-ollama:11434`. Surtout pas `/v1` à la fin : les outils
  ne marcheraient plus.
- **Modèle** : `qwen3.5:9b` (ou celui que tu as choisi).
- **Messageries** (Telegram, WhatsApp…) : tu peux passer cette étape et les ajouter plus tard.

Ensuite, autorise l'accès à l'interface web depuis ton réseau (remplace `IP_DU_NAS`) :

```bash
sudo docker compose run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js config set --batch-json '[
    {"path":"gateway.mode","value":"local"},
    {"path":"gateway.bind","value":"lan"},
    {"path":"gateway.controlUi.allowedOrigins","value":["http://IP_DU_NAS:18789","http://localhost:18789"]}
  ]'
```

Si l'assistant n'a pas trouvé tes modèles, ajoute le bloc du fichier `ollama.json5` dans
`data/config/openclaw.json`. Il contient l'adresse d'Ollama, la taille de contexte et le modèle par défaut.

## 4. Démarrer

```bash
sudo docker compose up -d openclaw-gateway
sudo docker logs -f openclaw          # Ctrl+C pour quitter les logs
```

*Avec l'interface Docker d'UGOS :* une fois l'étape 3 faite en SSH, tu peux aussi gérer le projet
depuis **Docker → Projet** (démarrer, arrêter, voir les logs).

## 5. Ouvrir l'interface

1. Va sur `http://IP_DU_NAS:18789` et colle le jeton (`OPENCLAW_GATEWAY_TOKEN` du `.env`).
2. La première fois, le navigateur doit être **approuvé**. Laisse la page ouverte, puis en SSH :
   ```bash
   sudo docker compose run --rm openclaw-cli devices list
   sudo docker compose run --rm openclaw-cli devices approve <requestId>
   ```
3. Écris un premier message. Si la réponse tarde, c'est normal la première fois : le modèle se
   charge en mémoire.

Vérifications utiles :

```bash
sudo docker compose run --rm openclaw-cli models list    # le modèle Ollama doit apparaître
sudo docker exec beta-ollama ollama ps                   # le modèle est-il chargé ?
```

## Sécurité

- OpenClaw peut exécuter des actions (outils, fichiers de son espace de travail). Il ne voit que
  `./data/workspace` : **ne monte pas tes dossiers du NAS** dedans sans en avoir besoin.
- **N'ouvre pas le port 18789 sur ta box Internet.** Pour y accéder de l'extérieur, utilise un
  VPN (Tailscale par exemple).
- L'interface est en `http://` sur ton réseau local : c'est prévu par OpenClaw, mais tout passe
  en clair sur le Wi-Fi. Utilise-la chez toi uniquement.

## Mettre à jour

```bash
sudo docker compose pull && sudo docker compose up -d openclaw-gateway
```

OpenClaw met à jour sa configuration tout seul au démarrage de la nouvelle image.

## Aller plus vite

Par ordre d'efficacité :
1. **Faire tourner Ollama sur un PC avec carte graphique** (RTX 3060 12 Go ou mieux). Dans
   `openclaw.json`, remplace `baseUrl` par `http://IP_DU_PC:11434`. Sur ce PC, Ollama doit écouter
   le réseau : `OLLAMA_HOST=0.0.0.0:11434`.
2. **Un modèle plus petit** : plus rapide, mais moins fiable pour utiliser les outils.
3. **Réduire le contexte** : `contextTokens` et `num_ctx` à 16384 dans `ollama.json5`. Plus rapide,
   mais OpenClaw oublie plus vite le début de la conversation.

Documentation officielle : `docs/install/docker.md` et `docs/providers/ollama/` du dépôt
GitHub `openclaw/openclaw`.
