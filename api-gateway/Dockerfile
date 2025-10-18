FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production
RUN npm ci --only=production && npm cache clean --force

COPY . .

# Start gateway.js
CMD ["node", "gateway.js"]
