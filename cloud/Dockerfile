FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY web ./web
ENV PORT=9800 DATA_DIR=/data
EXPOSE 9800
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:9800/ >/dev/null || exit 1
CMD ["node", "server.js"]
