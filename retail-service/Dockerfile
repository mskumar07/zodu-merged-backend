# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f retail-service/Dockerfile -t <image> .
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/retail-service

COPY packages/zodu-security /app/packages/zodu-security
COPY retail-service/package.json retail-service/package-lock.json retail-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY retail-service/ ./

USER node
EXPOSE 4001
CMD ["node", "src/server.js"]
