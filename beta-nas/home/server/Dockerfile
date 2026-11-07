# Bêta home — image du serveur (application + API), sans aucune dépendance npm.
# Construite par « server/installer.sh » ou « docker compose up -d --build » (dans le dossier server).
FROM node:22-alpine
ARG BETA_SHA=dev
LABEL org.opencontainers.image.title="Bêta home" \
      org.opencontainers.image.description="Tableau de bord de la maison et serveur domotique, sans Home Assistant obligatoire" \
      org.opencontainers.image.source="https://github.com/ukiyo2208/ukiyo2208"
WORKDIR /beta
COPY . /beta
# le fuseau horaire (TZ) est géré par Node lui-même : pas besoin du paquet tzdata
ENV NODE_ENV=production PORT=8090 APP_DIR=/beta DATA_DIR=/data BETA_SHA=$BETA_SHA TZ=Europe/Paris
VOLUME /data
EXPOSE 8090
# santé du conteneur : visible dans UGOS (Docker › Conteneur) et dans « docker ps »
HEALTHCHECK --interval=60s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/ping" > /dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server/server.js"]
