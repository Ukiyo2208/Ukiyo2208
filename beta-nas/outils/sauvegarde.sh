#!/bin/sh
# Sauvegarde de Bêta (conteneur beta-sauvegarde) : chaque nuit à SAUVEGARDE_HEURE, une archive datée dans
# /sauvegardes (SAUVEGARDE_DOSSIER sur le NAS), gardée SAUVEGARDE_JOURS jours. État dans /sauvegardes/etat.json
# (lu par Bêta pour le tableau de bord et les alertes).
#
# Contenu : réglages (.env, config), appairages Alexa et HomeKit, données de Bêta, du tri, de la présence,
# configuration de Home Assistant (sans sa grosse base d'historique) et données de Bêta Tool.
# Pas les modèles d'IA et de voix (ils se retéléchargent).
#
# Sauvegarder tout de suite :  docker exec beta-sauvegarde sh /sauvegarde.sh maintenant
# Restaurer :                  voir INSTALLATION.md, « Restaurer une sauvegarde »
set -u
umask 077  # l'archive contient .env : lisible par root seulement
HEURE="${SAUVEGARDE_HEURE:-03:30}"
JOURS="${SAUVEGARDE_JOURS:-14}"
DEST="${SAUVEGARDE_DEST:-/sauvegardes}"
SOURCE="${SAUVEGARDE_SOURCE:-/source}"
ETAT="$DEST/etat.json"

ecrire_etat() {  # $1 = erreur (vide si réussie), $2 = fichier, $3 = taille
  derniere=$(sed -n 's/.*"derniere_reussie": *\([0-9]*\).*/\1/p' "$ETAT" 2>/dev/null)
  [ -z "$1" ] && derniere=$(date +%s)
  erreur=$(printf '%s' "$1" | tr '"\\\n' "'/ ")
  printf '{"derniere_reussie": %s, "derniere_tentative": %s, "erreur": "%s", "fichier": "%s", "taille": %s, "jours_gardes": %s}\n' \
    "${derniere:-0}" "$(date +%s)" "$erreur" "$2" "${3:-0}" "$JOURS" > "$ETAT.tmp" && mv "$ETAT.tmp" "$ETAT"
}

sauvegarder() {
  mkdir -p "$DEST" || { echo "Dossier $DEST impossible à créer"; return 1; }
  nom="beta-$(date +%Y-%m-%d_%H%M).tar.gz"
  echo "$(date '+%F %T') Sauvegarde vers $DEST/$nom"
  if tar -czf "$DEST/$nom.part" -C "$SOURCE" \
      --exclude='beta-nas/ollama' --exclude='beta-nas/whisper' --exclude='beta-nas/piper' --exclude='beta-nas/immich' \
      --exclude='home-assistant_v2.db*' --exclude='*.db-wal' --exclude='*.db-shm' \
      --exclude='*/cache' --exclude='*/tmp' --exclude='*/__pycache__' \
      $(cd "$SOURCE" && ls -d env config beta-nas beta-tool 2>/dev/null) 2> /tmp/erreurs; then
    mv "$DEST/$nom.part" "$DEST/$nom"
    taille=$(wc -c < "$DEST/$nom" | tr -d ' ')
    ecrire_etat "" "$nom" "$taille"
    echo "$(date '+%F %T') OK : $nom ($((taille / 1048576)) Mo)"
  else
    rm -f "$DEST/$nom.part"
    ecrire_etat "$(tail -n 3 /tmp/erreurs)" "" 0
    echo "$(date '+%F %T') ÉCHEC :"; cat /tmp/erreurs
  fi
  find "$DEST" -maxdepth 1 -name 'beta-*.tar.gz' -mtime +"$JOURS" -exec rm -f {} \;
}

if [ "${1:-}" = "maintenant" ]; then
  sauvegarder
  exit
fi

echo "Sauvegarde automatique chaque nuit à $HEURE, gardée $JOURS jours, dans $DEST"
while true; do
  maintenant=$(date +%s)
  cible=$(date -d "$(date +%Y-%m-%d) $HEURE" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%Y-%m-%d) $HEURE" +%s)
  [ "$cible" -le "$maintenant" ] && cible=$((cible + 86400))
  sleep $((cible - maintenant))
  sauvegarder
done
