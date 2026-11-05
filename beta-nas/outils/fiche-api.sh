#!/usr/bin/env bash
# Fiche de connexion des API de Bêta, à lancer sur le NAS.
#
#   ./fiche-api.sh                 fiche : adresses, ports, état, codes (masqués), commandes
#   ./fiche-api.sh --secrets       même chose, codes en clair
#   ./fiche-api.sh fichier         écrit FICHE-API.md (codes en clair, lisible par toi seul)
#   eval "$(./fiche-api.sh env)"   met les codes dans ton terminal ($BETA_TOKEN, $HA_TOKEN…)
#   ./fiche-api.sh suivre [s]      utilisation de l'API en temps réel (toutes les 2 s par défaut)
#   ./fiche-api.sh tester          appels de test sur chaque API
#   ./fiche-api.sh regler CLE VAL  change un réglage du .env et redémarre le bon conteneur
#   ./fiche-api.sh jeton           crée un nouveau BETA_TOKEN (à recopier dans la tablette)
#   ./fiche-api.sh logs [nom]      journaux en direct (beta, beta-presence, beta-trieur…)
#
# L'adresse IP du NAS est détectée toute seule ; pour la forcer : NAS_IP=192.168.1.20 ./fiche-api.sh

set -uo pipefail

DOSSIER_BETA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_BETA="$DOSSIER_BETA/.env"

if [ -t 1 ]; then G=$'\e[1m'; V=$'\e[32m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'; else G= V= R= D= N=; fi

# ------------------------------------------------------------------ Outils

lire() { # lire FICHIER CLE -> valeur
  [ -f "$1" ] || return 0
  grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

masquer() {
  local v="$1"
  if [ -z "$v" ]; then echo "${R}(vide)${N}"
  elif [ "${AFFICHER_SECRETS:-0}" = 1 ]; then echo "$v"
  elif [ "${#v}" -le 10 ]; then echo "••••"
  else echo "${v:0:4}…${v: -4}"; fi
}

ip_nas() {
  local ip
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  [ -n "$ip" ] || ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -Ev '^(127\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n1)
  echo "${ip:-127.0.0.1}"
}

docker_ok() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

port_publie() { # port_publie CONTENEUR PORT_INTERNE DEFAUT -> port vu depuis le réseau
  local p=""
  docker_ok && p=$(docker port "$1" "$2/tcp" 2>/dev/null | head -n1 | sed 's/.*://')
  echo "${p:-$3}"
}

# Réseau local : jamais de proxy, même si le système en définit un
curl() { command curl --noproxy '*' "$@"; }

http_code() { local c; c=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$@" 2>/dev/null); echo "${c:-000}"; }

tcp_ok() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

etat() { # etat CODE_HTTP_OU_ok/ko
  case "$1" in
    2??|ok) echo "${V}✅ en ligne${N}" ;;
    401|403) echo "${R}🔑 code refusé${N}" ;;
    000|ko) echo "${R}❌ injoignable${N}" ;;
    *) echo "${R}⚠️  HTTP $1${N}" ;;
  esac
}

charger() {
  IP="${NAS_IP:-$(ip_nas)}" # NAS_IP=192.168.1.20 ./fiche-api.sh si la détection se trompe de carte réseau
  PORT_BETA=$(port_publie beta 8800 8800)
  PORT_PRESENCE=$(port_publie beta-presence 8801 8801)
  HA=$(lire "$ENV_BETA" HA_URL); HA=${HA:-http://host.docker.internal:8123}
  HA=${HA%/}; HA=${HA/host.docker.internal/$IP} # le Home Assistant du NAS, ou le tien ailleurs
  BETA_TOKEN=$(lire "$ENV_BETA" BETA_TOKEN)
  BETA_LECTURE_TOKEN=$(lire "$ENV_BETA" BETA_LECTURE_TOKEN)
  HA_TOKEN=$(lire "$ENV_BETA" HA_TOKEN)
  ANTHROPIC_API_KEY=$(lire "$ENV_BETA" ANTHROPIC_API_KEY)
  BETA="http://$IP:$PORT_BETA"
}

# ------------------------------------------------------------------ Fiche

fiche() {
  charger
  local auth=(-H "Authorization: Bearer $BETA_TOKEN")
  local e_beta e_pres e_tri e_ha e_ol e_wh e_pi
  e_beta=$(http_code "${auth[@]}" "$BETA/v1/stats")
  e_pres=$(http_code "${auth[@]}" "http://$IP:$PORT_PRESENCE/positions")
  e_tri=$(http_code "${auth[@]}" "$BETA/v1/tri/etat")
  e_ha=$(http_code -H "Authorization: Bearer $HA_TOKEN" "$HA/api/")
  e_ol=$(http_code "http://127.0.0.1:11434/api/tags")
  tcp_ok 127.0.0.1 10300 && e_wh=ok || e_wh=ko
  tcp_ok 127.0.0.1 10200 && e_pi=ok || e_pi=ko

  cat <<EOF
${G}FICHE DE CONNEXION · BÊTA${N}   NAS : ${G}$IP${N}   $(date '+%d/%m/%Y %H:%M')

${G}SERVICES${N}
  Bêta (page, API)     $BETA                    $(etat "$e_beta")
     tableau de bord   $BETA/tableau
     documentation     $BETA/docs
  Tri des documents    $BETA/tri/               $(etat "$e_tri")
  Présence (caméras)   http://$IP:$PORT_PRESENCE                    $(etat "$e_pres")
  Home Assistant       $HA                    $(etat "$e_ha")
  Ollama               http://127.0.0.1:11434 ${D}(NAS seulement)${N}  $(etat "$e_ol")
  Whisper              127.0.0.1:10300 ${D}(NAS seulement)${N}         $(etat "$e_wh")
  Piper                127.0.0.1:10200 ${D}(NAS seulement)${N}         $(etat "$e_pi")

${G}CODES${N} ${D}(./fiche-api.sh --secrets pour les voir en entier)${N}
  BETA_TOKEN              $(masquer "$BETA_TOKEN")   ${D}tablette, présence, accès hors de la maison${N}
  BETA_LECTURE_TOKEN      $(masquer "$BETA_LECTURE_TOKEN")   ${D}lecture seule, pour ton site (/v1/nas)${N}
  HA_TOKEN                $(masquer "$HA_TOKEN")   ${D}Home Assistant${N}
  ANTHROPIC_API_KEY       $(masquer "$ANTHROPIC_API_KEY")   ${D}IA web (automatisations)${N}

${G}COMMANDES${N} ${D}(d'abord : eval "\$(./fiche-api.sh env)")${N}
  # Bêta : état, test en texte, utilisation
  curl $BETA/sante
  curl -X POST $BETA/v1/texte -H "Authorization: Bearer \$BETA_TOKEN" \\
       -H "Content-Type: application/json" -d '{"texte": "allume la lumière du salon", "piece": "salon"}'
  curl "$BETA/v1/stats?format=texte" -H "Authorization: Bearer \$BETA_TOKEN"

  # Pour ton site : NAS, IA, services, utilisation (jeton de lecture seule)
  curl $BETA/v1/nas -H "Authorization: Bearer \$BETA_LECTURE_TOKEN"

  # Présence : qui est où, visages enregistrés
  curl http://$IP:$PORT_PRESENCE/positions -H "Authorization: Bearer \$BETA_TOKEN"
  curl http://$IP:$PORT_PRESENCE/visages -H "Authorization: Bearer \$BETA_TOKEN"

  # Home Assistant : un appareil, une personne
  curl $HA/api/states/person.bastien -H "Authorization: Bearer \$HA_TOKEN"

  # Ollama : modèles installés et chargés
  sudo docker exec beta-ollama ollama list
  sudo docker exec beta-ollama ollama ps

  # Tri des documents : état, journal du trieur
  curl $BETA/v1/tri/etat
  sudo docker logs --tail 30 beta-trieur

${G}À LA MAISON${N}  pas de jeton à saisir sur ${G}$BETA${N} (il est demandé seulement hors du réseau local)
${G}TABLETTE${N}     Réglages → Adresse du NAS : ${G}$BETA${N} · Jeton : BETA_TOKEN
EOF
}

# ------------------------------------------------------------------ Autres commandes

cmd_env() {
  charger
  printf 'export BETA_TOKEN=%q BETA_LECTURE_TOKEN=%q HA_TOKEN=%q BETA_URL=%q\n' \
    "$BETA_TOKEN" "$BETA_LECTURE_TOKEN" "$HA_TOKEN" "$BETA"
}

cmd_fichier() {
  local sortie="$DOSSIER_BETA/FICHE-API.md"
  ( umask 077; { echo '```'; AFFICHER_SECRETS=1 G= V= R= D= N= fiche; echo '```'; } > "$sortie" )
  echo "Fiche écrite dans $sortie (lisible par toi seul : elle contient les codes en clair)."
}

cmd_suivre() {
  charger
  local pause="${1:-2}"
  [ -n "$BETA_TOKEN" ] || { echo "BETA_TOKEN introuvable dans $ENV_BETA"; exit 1; }
  trap 'tput cnorm 2>/dev/null; exit 0' INT TERM
  tput civis 2>/dev/null
  while true; do
    local page
    page=$(curl -s -m 5 "$BETA/v1/stats?format=texte" -H "Authorization: Bearer $BETA_TOKEN") \
      || page="Bêta injoignable sur $BETA, nouvel essai…"
    clear
    echo "${G}$BETA${N} · $(date '+%H:%M:%S') · Ctrl+C pour quitter"
    echo
    echo "$page"
    sleep "$pause"
  done
}

cmd_tester() {
  charger
  echo "${G}Test des API sur $IP${N}"
  local r
  r=$(curl -s -m 5 "$BETA/sante") && echo "  ✅ Bêta /sante : $r" || echo "  ❌ Bêta injoignable ($BETA)"
  r=$(curl -s -m 60 -X POST "$BETA/v1/texte" -H "Authorization: Bearer $BETA_TOKEN" \
        -H "Content-Type: application/json" -d '{"texte": "quelle heure est-il"}')
  echo "  ➜ « quelle heure est-il » : $r"
  echo "  Home Assistant : $(etat "$(http_code -H "Authorization: Bearer $HA_TOKEN" "$HA/api/")")"
  echo "  Présence       : $(etat "$(http_code -H "Authorization: Bearer $BETA_TOKEN" "http://$IP:$PORT_PRESENCE/positions")")"
  echo "  Tri            : $(etat "$(http_code -H "Authorization: Bearer $BETA_TOKEN" "$BETA/v1/tri/etat")")"
  echo "  Ollama         : $(curl -s -m 3 http://127.0.0.1:11434/api/ps | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | paste -sd, - | sed 's/^$/aucun modèle chargé/')"
}

conteneur_de() { # quel conteneur redémarrer pour une clé
  case "$1" in
    TRI_*|PUID|PGID|NOTIFICATIONS) echo beta-trieur ;;
    HA_TOKEN|HA_URL) echo "beta beta-presence beta-trieur" ;;
    BETA_TOKEN) echo "beta beta-presence" ;;
    WHISPER_MODEL) echo beta-whisper ;;
    PIPER_VOICE) echo "beta-piper beta" ;;
    *) echo beta ;;
  esac
}

cmd_regler() {
  local cle="${1:-}" valeur="${2-}"
  [[ "$cle" =~ ^[A-Z][A-Z0-9_]*$ ]] && [ $# -ge 2 ] || {
    echo "Usage : ./fiche-api.sh regler CLE VALEUR   (ex : regler OLLAMA_MODEL qwen2.5:1.5b)"; exit 1; }
  local fichier="$ENV_BETA"
  [ -f "$fichier" ] || { echo "Fichier introuvable : $fichier"; exit 1; }
  cp "$fichier" "$fichier.sauvegarde"
  if grep -qE "^$cle=" "$fichier"; then
    local tmp; tmp=$(mktemp)
    awk -v cle="$cle" -v val="$valeur" 'index($0, cle "=") == 1 { print cle "=" val; next } { print }' "$fichier" > "$tmp" \
      && cat "$tmp" > "$fichier" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$cle" "$valeur" >> "$fichier"
  fi
  echo "✅ $cle mis à jour dans $fichier (ancienne version : $fichier.sauvegarde)"
  local dossier="$DOSSIER_BETA"
  if docker_ok; then
    for c in $(conteneur_de "$cle"); do
      local service; service=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c" 2>/dev/null)
      [ -n "$service" ] && (cd "$dossier" && docker compose up -d "$service" >/dev/null 2>&1) && echo "   ↻ $c redémarré"
    done
  else
    echo "   Relance ensuite : cd $dossier && sudo docker compose up -d"
  fi
}

cmd_jeton() {
  local nouveau; nouveau=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cmd_regler BETA_TOKEN "$nouveau"
  echo "⚠️  Recopie le nouveau jeton dans la tablette (Réglages → Jeton) : ./fiche-api.sh --secrets"
}

cmd_logs() {
  if [ -n "${1:-}" ]; then docker logs -f --tail 50 "$1"; return; fi
  (cd "$DOSSIER_BETA" && docker compose logs -f --tail 20 beta presence trieur)
}

case "${1:-}" in
  ""|fiche) fiche ;;
  --secrets) AFFICHER_SECRETS=1 fiche ;;
  env) cmd_env ;;
  fichier) cmd_fichier ;;
  suivre) shift; cmd_suivre "$@" ;;
  tester) cmd_tester ;;
  regler) shift; cmd_regler "$@" ;;
  jeton) cmd_jeton ;;
  logs) shift; cmd_logs "$@" ;;
  aide|-h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "Commande inconnue : $1 (./fiche-api.sh aide)"; exit 1 ;;
esac
