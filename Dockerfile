FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV SEAMS_DATA=/data PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
