FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Start server.js inside src
CMD ["node", "src/server.js"]
