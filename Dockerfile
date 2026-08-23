FROM node:20-alpine

WORKDIR /app

RUN mkdir -p /app/logs

COPY package*.json ./

RUN npm ci

COPY --chown=node:node . .

RUN chown node:node /app/logs

USER node

EXPOSE 3000

CMD ["npx", "tsx", "src/main/server.ts"]