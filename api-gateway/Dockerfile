# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f api-gateway/Dockerfile -t <image> .
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/api-gateway

COPY packages/zodu-security /app/packages/zodu-security
COPY api-gateway/package.json api-gateway/package-lock.json api-gateway/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY api-gateway/ ./

USER node
EXPOSE 5001
CMD ["node", "gateway.js"]
