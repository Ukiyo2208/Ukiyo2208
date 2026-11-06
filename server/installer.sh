#!/bin/sh
# Bêta home — installation et entretien avec Docker, en une commande (NAS UGREEN / Synology, Raspberry Pi, PC Linux).
# À lancer en SSH dans le dossier « server » :   sudo ./installer.sh  [commande]
#   (rien)        installe ou met à jour : crée .env (clé au hasard) la 1re fois, construit l'image, démarre
#   etat          état des conteneurs et santé de Bêta home
#   journal       journal en direct (Ctrl+C pour quitter)
#   redemarrer    redémarre Bêta home
#   arret         arrête tout (les données restent dans server/data)
#   cle           affiche la clé du serveur (BETA_KEY)
set -eu
cd "$(dirname "$0")"

bleu() { printf '\033[1;34m%s\033[0m\n' "$*"; }
vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# docker compose (récent) ou docker-compose (ancien)
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else rouge "Docker (avec compose) est introuvable : installez l'application Docker du NAS, puis relancez."; exit 1; fi
if ! docker info >/dev/null 2>&1; then rouge "Docker ne répond pas : lancez ce script avec sudo, ou démarrez l'application Docker."; exit 1; fi

val() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }
port() { p=$(val BETA_PORT); echo "${p:-8090}"; }
ip() { hostname -I 2>/dev/null | awk '{print $1}' || true; }

attendre() {
  # Bêta home répond-il ? (jusqu'à 90 s : la première construction peut être lente sur un NAS)
  i=0; while [ $i -lt 45 ]; do
    if wget -qO- "http://127.0.0.1:$(port)/api/ping" >/dev/null 2>&1 || curl -fs "http://127.0.0.1:$(port)/api/ping" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1)); sleep 2
  done; return 1
}

case "${1:-installer}" in
  installer|maj|install|update)
    if [ ! -f .env ]; then
      bleu "Première installation : création du fichier .env avec une clé au hasard"
      cle=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
      sed "s/^BETA_KEY=.*/BETA_KEY=$cle/" .env.example > .env
      chmod 600 .env
    fi
    case "$(val BETA_KEY)" in remplacez-*|changez-moi*|"") rouge "Choisissez une vraie clé dans le fichier .env (ligne BETA_KEY), puis relancez."; exit 1 ;; esac
    mkdir -p data/go2rtc data/mosquitto
    bleu "Construction de l'image et démarrage (1 à 3 minutes la première fois)…"
    $DC up -d --build --remove-orphans
    if attendre; then
      vert "Bêta home est prêt : http://$(ip):$(port)"
      echo "Clé du serveur (Connexions › Serveur Bêta) : $(val BETA_KEY)"
      echo "Gardez-la précieusement. Vos données sont dans : $(pwd)/data"
    else
      rouge "Bêta home ne répond pas encore. Regardez le journal :  sudo ./installer.sh journal"; exit 1
    fi
    docker image prune -f >/dev/null 2>&1 || true   # anciennes versions de l'image
    ;;
  etat|status)
    $DC ps
    if wget -qO- "http://127.0.0.1:$(port)/api/ping" 2>/dev/null || curl -fs "http://127.0.0.1:$(port)/api/ping" 2>/dev/null; then echo; vert "Bêta home répond."; else rouge "Bêta home ne répond pas."; fi
    ;;
  journal|logs) $DC logs -f --tail 100 beta-home ;;
  redemarrer|restart) $DC restart beta-home && attendre && vert "Bêta home a redémarré." ;;
  arret|stop) $DC down && vert "Tout est arrêté (données conservées dans $(pwd)/data)." ;;
  cle|key) val BETA_KEY ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
