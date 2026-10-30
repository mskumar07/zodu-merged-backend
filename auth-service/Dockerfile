# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f auth-service/Dockerfile -t <image> .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/auth-service

COPY packages/zodu-security /app/packages/zodu-security
COPY auth-service/package.json auth-service/package-lock.json auth-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY auth-service/ ./

USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
