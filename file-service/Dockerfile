# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f file-service/Dockerfile -t <image> .
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/file-service

COPY packages/zodu-security /app/packages/zodu-security
COPY file-service/package.json file-service/package-lock.json file-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY file-service/ ./

USER node
EXPOSE 4007
CMD ["node", "src/server.js"]
