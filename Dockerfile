FROM node:20-alpine

WORKDIR /app

COPY src/package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "src/main/server.ts"]