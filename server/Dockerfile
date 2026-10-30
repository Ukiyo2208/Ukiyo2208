FROM node:22-alpine
ARG BETA_SHA=dev
WORKDIR /beta
COPY . /beta
ENV PORT=8090 APP_DIR=/beta DATA_DIR=/data BETA_SHA=$BETA_SHA
VOLUME /data
EXPOSE 8090
CMD ["node", "server/server.js"]
