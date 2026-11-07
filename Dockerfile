# Seams server. No npm dependencies.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]
