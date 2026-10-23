FROM node:22-alpine
WORKDIR /beta
COPY . /beta
ENV PORT=8090 APP_DIR=/beta DATA_DIR=/data
VOLUME /data
EXPOSE 8090
CMD ["node", "server/server.js"]
