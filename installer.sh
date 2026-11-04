#!/usr/bin/env bash
# Installation « plug and play » de Bêta IA sur un NAS (UGREEN UGOS Pro ou tout Linux avec Docker).
#
#   sudo ./installer.sh            pose quelques questions (avec réponses par défaut), puis installe tout
#   sudo ./installer.sh --auto     aucune question : réponses par défaut
#
# Relançable sans risque : ce qui est déjà configuré (.env, config.yaml, comptes, jetons) est conservé.
# Options : --sans-openclaw · --dossier /volume1/docker/beta · --prenom bastien · --piece salon
#           --documents /volume1/Documents

set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTO=0 OPENCLAW=o DEST="" PRENOM="" PIECE="" DOCUMENTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO=1 ;;
    --sans-openclaw) OPENCLAW=n ;;
    --dossier) DEST="$2"; shift ;;
    --prenom) PRENOM="$2"; shift ;;
    --piece) PIECE="$2"; shift ;;
    --documents) DOCUMENTS="$2"; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1"; exit 1 ;;
  esac
  shift
done

if [ -t 1 ]; then G=$'\e[1m'; V=$'\e[32m'; J=$'\e[33m'; R=$'\e[31m'; B=$'\e[36m'; N=$'\e[0m'; else G= V= J= R= B= N=; fi
NUM=0
etape() { NUM=$((NUM + 1)); echo; echo "${B}${G}[$NUM] $*${N}"; }
ok() { echo "  ${V}✔${N} $*"; }
avertir() { echo "  ${J}⚠${N} $*"; }
echec() { echo "  ${R}✘ $*${N}"; exit 1; }

demander() { # demander VARIABLE "Question" défaut [secret]
  local var="$1" question="$2" defaut="$3" secret="${4:-}" reponse=""
  if [ -n "${!var:-}" ]; then return; fi
  if [ "$AUTO" = 1 ] || [ ! -r /dev/tty ]; then printf -v "$var" '%s' "$defaut"; return; fi
  if [ -n "$secret" ]; then
    read -r -s -p "  $question ${defaut:+[$defaut] }: " reponse < /dev/tty; echo
  else
    read -r -p "  $question ${defaut:+[$defaut] }: " reponse < /dev/tty
  fi
  printf -v "$var" '%s' "${reponse:-$defaut}"
}

env_lire() { [ -f "$1" ] && grep -E "^$2=" "$1" | tail -n1 | cut -d= -f2- || true; }

env_ecrire() { # env_ecrire FICHIER CLE VALEUR
  local tmp; tmp=$(mktemp)
  if grep -qE "^$2=" "$1"; then
    awk -v cle="$2" -v val="$3" 'index($0, cle "=") == 1 { print cle "=" val; next } { print }' "$1" > "$tmp"
    cat "$tmp" > "$1"
  else
    printf '%s=%s\n' "$2" "$3" >> "$1"
  fi
  rm -f "$tmp"
}

env_si_vide() { [ -n "$(env_lire "$1" "$2")" ] || env_ecrire "$1" "$2" "$3"; }

aleatoire() { openssl rand -hex "${1:-32}" 2>/dev/null || head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

normaliser() { # « Léa Martin » -> « lea-martin » (fonctionne quelle que soit la langue du système)
  echo "$1" | sed -E 's/À|Â|Ä|Á|à|â|ä|á|ã/a/g; s/É|È|Ê|Ë|é|è|ê|ë/e/g; s/Î|Ï|Í|î|ï|í|ì/i/g; s/Ô|Ö|Ó|ô|ö|ó|ò|õ/o/g;
    s/Û|Ü|Ù|Ú|û|ü|ù|ú/u/g; s/Ç|ç/c/g; s/Ñ|ñ/n/g' | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//'
}

ip_nas() {
  local ip
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  echo "${ip:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
}

attendre() { # attendre "description" secondes commande…
  local quoi="$1" delai="$2"; shift 2
  local fin=$((SECONDS + delai))
  until "$@" >/dev/null 2>&1; do
    [ $SECONDS -lt $fin ] || return 1
    sleep 3
  done
}

copier_code() { # copie le code sans toucher aux réglages ni aux données déjà présents
  mkdir -p "$2"
  tar -C "$1" --exclude=.env --exclude=data --exclude=config/config.yaml --exclude=FICHE-API.md \
      --exclude=__pycache__ --exclude=.pytest_cache -cf - . | tar -C "$2" -xf -
}

# ====================================================================== 1. Vérifications

etape "Vérification du NAS"
if [ "$(id -u)" -ne 0 ]; then
  echo "  Il faut les droits administrateur : relance avec  sudo $0 $*"; exit 1
fi
command -v docker >/dev/null || echec "Docker est introuvable : installe l'application Docker depuis le Centre d'applications d'UGOS."
if docker compose version >/dev/null 2>&1; then DC=(docker compose)
elif command -v docker-compose >/dev/null; then DC=(docker-compose)
else echec "Docker Compose est introuvable."; fi
docker info >/dev/null 2>&1 || echec "Docker ne répond pas (est-il démarré ?)."
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
[ "$(uname -m)" = x86_64 ] || avertir "Processeur $(uname -m) : prévu pour Intel/AMD (x86_64), certains modèles peuvent manquer."
ram=$(awk '/MemTotal/ {printf "%d", $2 / 1048576}' /proc/meminfo)
[ "$ram" -ge 8 ] && ok "Mémoire : ${ram} Go" || avertir "Mémoire : ${ram} Go (8 Go conseillés, 16 Go avec OpenClaw)"
[ -d "$SOURCE/beta-nas" ] || echec "Lance ce script depuis le dossier du projet (celui qui contient beta-nas/)."

# ====================================================================== 2. Questions

etape "Quelques questions (Entrée = valeur proposée)"
# Par défaut : à côté du dossier téléchargé, donc sur le volume et dans le dossier Docker que tu as choisis
VOLUME=$(echo "$SOURCE" | grep -oE '^/volume[0-9]+' || true)
[ -n "$VOLUME" ] || VOLUME=$(ls -d /volume[0-9]* 2>/dev/null | head -n1 || true)
VOLUME=${VOLUME:-/opt}
if [[ "$SOURCE" == /volume* ]]; then dest_defaut="$(dirname "$SOURCE")/beta"; else dest_defaut="$VOLUME/docker/beta"; fi
demander DEST "Dossier d'installation" "$dest_defaut"
demander PRENOM "Ton prénom" "bastien"
PRENOM=$(normaliser "$PRENOM")
demander PIECE "Pièce où sera la tablette" "salon"
PIECE=$(normaliser "$PIECE")
if [ "$OPENCLAW" = o ]; then
  demander OPENCLAW "Installer OpenClaw et le tri des documents ? (o/n)" "o"
  OPENCLAW=$(echo "$OPENCLAW" | cut -c1 | tr '[:upper:]' '[:lower:]')
fi
if [ "$OPENCLAW" = o ]; then
  # « Document », « Documents », sur le volume du téléchargement d'abord
  docs_defaut=$(ls -d "$VOLUME"/[Dd]ocument "$VOLUME"/[Dd]ocuments /volume[0-9]*/[Dd]ocument /volume[0-9]*/[Dd]ocuments 2>/dev/null | head -n1 || true)
  demander DOCUMENTS "Dossier des documents à trier" "${docs_defaut:-$VOLUME/Documents}"
fi
ENV_BETA="$DEST/beta-nas/.env"
if [ -z "$(env_lire "$ENV_BETA" HA_TOKEN)" ]; then
  demander HA_EXISTANT "Adresse de TON Home Assistant s'il existe déjà, ex http://192.168.1.30:8123 (vide = en installer un)" ""
  if [ -n "$HA_EXISTANT" ]; then
    echo "  Identifiants de ton Home Assistant (pour créer le jeton de Bêta, le mot de passe n'est pas enregistré) :"
  else
    echo "  Compte Home Assistant (créé automatiquement s'il n'existe pas encore) :"
  fi
  demander HA_UTILISATEUR "Identifiant" "$PRENOM"
  HA_MDP_GENERE=0
  if [ -n "$HA_EXISTANT" ]; then
    # Ton compte existe déjà : il faut son vrai mot de passe, jamais un mot de passe généré
    while [ -z "${HA_MDP:-}" ]; do
      demander HA_MDP "Mot de passe de ton Home Assistant" "" secret
      [ -n "$HA_MDP" ] || { [ "$AUTO" = 1 ] && break; echo "  Le mot de passe est obligatoire pour ton Home Assistant."; }
    done
  else
    demander HA_MDP "Mot de passe (vide = généré)" "" secret
    if [ -z "$HA_MDP" ]; then HA_MDP=$(aleatoire 9); HA_MDP_GENERE=1; fi
  fi
fi
echo "  Discussion et automatisations : IA cloud, ou modèle puissant sur un PC avec carte graphique."
demander CLE_ANTHROPIC "Clé de l'IA cloud Claude (vide = aucune)" "" secret
demander PUISSANT_URL "Adresse d'Ollama sur un PC puissant, ex http://192.168.1.50:11434 (vide = aucun)" ""
[ -n "$PUISSANT_URL" ] && demander PUISSANT_MODELE "Modèle de ce PC" "qwen3.5:27b"

# ====================================================================== 3. Fichiers

etape "Installation des fichiers dans $DEST"
if [ "$SOURCE" != "$DEST" ]; then
  copier_code "$SOURCE/beta-nas" "$DEST/beta-nas"
  [ "$OPENCLAW" = o ] && copier_code "$SOURCE/openclaw-nas" "$DEST/openclaw-nas"
  cp "$SOURCE/installer.sh" "$DEST/"
fi
chmod +x "$DEST/beta-nas/outils/fiche-api.sh"
ok "Code copié (réglages et données existants conservés)"

[ -f "$ENV_BETA" ] || cp "$DEST/beta-nas/.env.example" "$ENV_BETA"
chmod 600 "$ENV_BETA"
env_si_vide "$ENV_BETA" BETA_TOKEN "$(aleatoire 32)"
env_si_vide "$ENV_BETA" BETA_LECTURE_TOKEN "$(aleatoire 32)"
env_si_vide "$ENV_BETA" NAS_NOM "$(hostname 2>/dev/null || echo NAS)"
[ -n "$CLE_ANTHROPIC" ] && env_ecrire "$ENV_BETA" ANTHROPIC_API_KEY "$CLE_ANTHROPIC"
if [ -n "${HA_EXISTANT:-}" ]; then
  env_ecrire "$ENV_BETA" HA_URL "${HA_EXISTANT%/}"
  env_ecrire "$ENV_BETA" COMPOSE_PROFILES ""
elif ! grep -q '^COMPOSE_PROFILES=' "$ENV_BETA"; then
  # Installation d'avant cette option : on garde le Home Assistant du NAS s'il était utilisé
  case "$(env_lire "$ENV_BETA" HA_URL)" in
    *host.docker.internal*|"") env_ecrire "$ENV_BETA" COMPOSE_PROFILES homeassistant ;;
    *) env_ecrire "$ENV_BETA" COMPOSE_PROFILES "" ;;
  esac
fi
[ -n "$PUISSANT_URL" ] && env_ecrire "$ENV_BETA" PUISSANT_URL "$PUISSANT_URL" && env_ecrire "$ENV_BETA" PUISSANT_MODELE "$PUISSANT_MODELE"
BETA_TOKEN=$(env_lire "$ENV_BETA" BETA_TOKEN)
ok "Réglages : $ENV_BETA (jeton généré)"

CONFIG="$DEST/beta-nas/config/config.yaml"
if [ ! -f "$CONFIG" ]; then
  zones="    rez-de-chaussee: [salon, sejour, entree, cuisine]
    etage: [couloir-etage, chambre, bureau]
    grenier: [grenier]
    exterieur: [jardin, cour, sonnette]"
  echo "$zones" | grep -qE "[[ ]$PIECE[],]" || zones="$zones
    tablette: [$PIECE]"
  cat > "$CONFIG" <<EOF
# Généré par installer.sh. Toutes les options sont décrites dans config.example.yaml.
seuil_confiance: 0.4

personnes:
  $PRENOM:
    role: admin
    companion: person.$PRENOM

maison:
  validite_minutes: 15
  zones:
$zones

# Caméras Reolink : voir la section « cameras » de config.example.yaml
cameras: []
EOF
  ok "Configuration : $CONFIG"
else
  ok "Configuration existante conservée"
fi

# ====================================================================== 4. Bêta

etape "Démarrage de Bêta (première fois : 5 à 15 minutes)"
cd "$DEST/beta-nas"
mkdir -p data
# Ton propre Home Assistant est utilisé : celui du NAS est arrêté (ses données restent dans data/)
if [ -z "$(env_lire "$ENV_BETA" COMPOSE_PROFILES)" ] && docker inspect homeassistant >/dev/null 2>&1; then
  docker stop homeassistant >/dev/null 2>&1; docker rm homeassistant >/dev/null 2>&1
  ok "Home Assistant du NAS arrêté : Bêta utilise $(env_lire "$ENV_BETA" HA_URL)"
fi
JOURNAL="$DEST/installation-beta.log"
echo "  (journal détaillé : $JOURNAL)"
if ! "${DC[@]}" up -d --build > "$JOURNAL" 2>&1; then
  echo; tail -n 25 "$JOURNAL" | sed 's/^/    /'
  echec "Le démarrage de Bêta a échoué (message ci-dessus). Envoie-le pour qu'on corrige."
fi
"${DC[@]}" ps --format '  {{.Name}} : {{.Status}}' 2>/dev/null || "${DC[@]}" ps
docker inspect -f '{{.State.Running}}' beta 2>/dev/null | grep -q true \
  || { docker logs --tail 25 beta 2>&1 | sed 's/^/    /'; echec "Bêta ne reste pas démarré (journal ci-dessus)."; }
ok "Bêta est démarré"

etape "Home Assistant"
if [ -z "$(env_lire "$ENV_BETA" HA_TOKEN)" ]; then
  HA_INTERNE=$(env_lire "$ENV_BETA" HA_URL)
  HA_HOTE=${HA_INTERNE/host.docker.internal/127.0.0.1}
  echo "  Attente de Home Assistant ($HA_HOTE)…"
  attendre "Home Assistant" 600 curl -sf --noproxy '*' -o /dev/null "$HA_HOTE/manifest.json" \
    || avertir "Home Assistant ne répond pas encore"
  NOM_AFFICHE="$(echo "${PRENOM:0:1}" | tr '[:lower:]' '[:upper:]')${PRENOM:1}"
  if jeton=$("${DC[@]}" run --rm --no-deps -T beta python -m app.installation ha \
        --url "$HA_INTERNE" --nom "$NOM_AFFICHE" \
        --utilisateur "$HA_UTILISATEUR" --mot-de-passe "$HA_MDP" | tail -n1) && [ -n "$jeton" ]; then
    env_ecrire "$ENV_BETA" HA_TOKEN "$jeton"
    "${DC[@]}" up -d beta presence >/dev/null 2>&1
    ok "Compte et jeton Home Assistant prêts"
  else
    HA_ECHEC=1
    avertir "Jeton Home Assistant non créé automatiquement. Crée-le dans Home Assistant (Profil → Sécurité →"
    avertir "Jetons d'accès longue durée), puis : sudo $DEST/beta-nas/outils/fiche-api.sh regler HA_TOKEN <jeton>"
  fi
else
  ok "Jeton Home Assistant déjà configuré"
fi

etape "Modèle d'IA local de Bêta"
MODELE=$(env_lire "$ENV_BETA" OLLAMA_MODEL); MODELE=${MODELE:-qwen2.5:3b}
attendre "Ollama" 120 docker exec beta-ollama ollama list || true
docker exec beta-ollama ollama pull "$MODELE" 2>&1 | tail -n1 && ok "$MODELE prêt" || avertir "Téléchargement de $MODELE à refaire"

# ====================================================================== 5. OpenClaw

if [ "$OPENCLAW" = o ]; then
  etape "OpenClaw et le tri des documents"
  cd "$DEST/openclaw-nas"
  ENV_OC="$DEST/openclaw-nas/.env"
  [ -f "$ENV_OC" ] || cp .env.example "$ENV_OC"
  chmod 600 "$ENV_OC"
  env_si_vide "$ENV_OC" OPENCLAW_GATEWAY_TOKEN "$(aleatoire 32)"
  mkdir -p "$DOCUMENTS/_A_TRIER/_traitement/propositions" data/config data/workspace data/secrets
  env_ecrire "$ENV_OC" DOCUMENTS "$DOCUMENTS"
  env_ecrire "$ENV_OC" PUID "$(stat -c '%u' "$DOCUMENTS")"
  env_ecrire "$ENV_OC" PGID "$(stat -c '%g' "$DOCUMENTS")"
  env_ecrire "$ENV_OC" BETA_RESEAU beta-nas_default
  env_ecrire "$ENV_OC" TRI_TOKEN "$BETA_TOKEN"
  env_ecrire "$ENV_BETA" OPENCLAW_URL "http://host.docker.internal:18789"
  chown -R "$(stat -c '%u:%g' "$DOCUMENTS")" "$DOCUMENTS/_A_TRIER"
  chmod 777 "$DOCUMENTS/_A_TRIER/_traitement/propositions"
  chown -R 1000:1000 data
  ok "Boîte d'entrée : $DOCUMENTS/_A_TRIER"

  MODELE_OC=$(env_lire "$ENV_OC" OPENCLAW_MODELE); MODELE_OC=${MODELE_OC:-qwen3.5:9b}
  echo "  Téléchargement du modèle $MODELE_OC (environ 6 Go, une seule fois)…"
  docker exec beta-ollama ollama pull "$MODELE_OC" 2>&1 | tail -n1 || avertir "Téléchargement à refaire"

  "${DC[@]}" pull --quiet openclaw-gateway >/dev/null 2>&1 || true
  lancer_oc() { "${DC[@]}" run --rm --no-deps -T --entrypoint node openclaw-gateway dist/index.js "$@"; }
  if [ ! -f data/config/openclaw.json ]; then
    lancer_oc onboard --non-interactive --accept-risk --skip-health --mode local \
      --auth-choice ollama --custom-base-url http://beta-ollama:11434 --custom-model-id "$MODELE_OC" \
      --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN --skip-channels --no-install-daemon \
      >/dev/null && ok "OpenClaw configuré avec $MODELE_OC" || avertir "Configuration d'OpenClaw à terminer (voir openclaw-nas/README.md)"
  fi
  IP=$(ip_nas)
  lancer_oc config set --batch-json "[
    {\"path\":\"gateway.mode\",\"value\":\"local\"},
    {\"path\":\"models.providers.ollama.apiKey\",\"value\":\"ollama-local\"},
    {\"path\":\"gateway.bind\",\"value\":\"lan\"},
    {\"path\":\"gateway.controlUi.allowedOrigins\",\"value\":[\"http://$IP:18789\",\"http://localhost:18789\",\"http://127.0.0.1:18789\"]},
    {\"path\":\"tools.deny\",\"value\":[\"group:runtime\",\"browser\"]},
    {\"path\":\"cron.triggers.enabled\",\"value\":false}
  ]" >/dev/null && ok "Accès réseau et sécurité réglés" || avertir "Réglages d'OpenClaw à vérifier"
  # Remplace l'ancienne consigne de tri par la nouvelle (le reste de AGENTS.md est conservé)
  agents=data/workspace/AGENTS.md
  touch "$agents"
  awk '/^## Tri des documents du NAS/ {saute = 1; next} saute && /^## / {saute = 0} !saute {print}' "$agents" > "$agents.tmp"
  cat AGENTS-tri-documents.md >> "$agents.tmp" && mv "$agents.tmp" "$agents" && chown 1000:1000 "$agents"
  ok "Consigne de tri des documents à jour"
  if "${DC[@]}" up -d --build > "$DEST/installation-openclaw.log" 2>&1; then
    ok "OpenClaw démarré"
  else
    tail -n 15 "$DEST/installation-openclaw.log" | sed 's/^/    /'
    avertir "Démarrage d'OpenClaw à vérifier (journal : $DEST/installation-openclaw.log)"
  fi
  # Le tri se fait maintenant par le trieur direct (page http://IP:8802) : pas de tâche de nuit dans OpenClaw
fi

# ====================================================================== 6. Résumé

IP=$(ip_nas)
etape "C'est prêt !"
cat <<EOF

  ${G}Tableau de bord${N}   http://$IP:8800/tableau
  ${G}Home Assistant${N}    $(env_lire "$ENV_BETA" HA_URL | sed "s#host.docker.internal#$IP#")
EOF
[ "$OPENCLAW" = o ] && echo "  ${G}OpenClaw${N}          http://$IP:18789   (jeton : sudo $DEST/beta-nas/outils/fiche-api.sh --secrets)"
[ "$OPENCLAW" = o ] && echo "  ${G}Tri des documents${N} http://$IP:8802    (propositions à valider, dossiers à trier)"
if [ "${HA_MDP_GENERE:-0}" = 1 ] && [ -z "${HA_ECHEC:-}" ]; then
  echo
  echo "  ${J}Compte Home Assistant${N} : identifiant ${G}$HA_UTILISATEUR${N}, mot de passe ${G}$HA_MDP${N}  ← note-le"
fi
cat <<EOF

  ${G}Tablette${N} : installe l'APK Bêta, ouvre-la et scanne ce QR code
  (ou depuis un PC : tableau de bord → « Afficher le QR d'appairage »).

EOF
docker exec beta python -m app.installation qr --url "http://$IP:8800" --jeton "$BETA_TOKEN" --piece "$PIECE" 2>/dev/null \
  || echo "  Adresse : http://$IP:8800 · Jeton : sudo $DEST/beta-nas/outils/fiche-api.sh --secrets"
cat <<EOF

  Ensuite, dans Home Assistant : ajoute tes appareils et range-les dans des pièces.
  Fiche de connexion complète : ${G}sudo $DEST/beta-nas/outils/fiche-api.sh${N}
  Mise à jour plus tard : relance ${G}sudo $DEST/installer.sh${N} depuis le nouveau dossier téléchargé.
EOF
