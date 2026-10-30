# Pont Matter de Bêta home (Alexa, Google Home, Apple Maison) — réseau « hôte » obligatoire (mDNS, IPv6).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.js homekit.js ./
ENV MATTER_STORAGE_PATH=/data
VOLUME /data
CMD ["node", "index.js"]
