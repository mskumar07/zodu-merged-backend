# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f admin-service/Dockerfile -t <image> .
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/admin-service

COPY packages/zodu-security /app/packages/zodu-security
COPY admin-service/package.json admin-service/package-lock.json admin-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY admin-service/ ./

USER node
EXPOSE 4006
CMD ["node", "src/server.js"]
