# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f restaurant-service/Dockerfile -t <image> .
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/restaurant-service

COPY packages/zodu-security /app/packages/zodu-security
COPY restaurant-service/package.json restaurant-service/package-lock.json restaurant-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY restaurant-service/ ./

USER node
EXPOSE 4003
CMD ["node", "src/server.js"]
