# Untuk hosting online (Railway). Data disimpan di /data (pasang volume di path ini).
FROM node:22-alpine
WORKDIR /app
COPY ["smm-dashboard 2/", "./"]
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
