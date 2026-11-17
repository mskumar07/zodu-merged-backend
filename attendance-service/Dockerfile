# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f attendance-service/Dockerfile -t <image> .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/attendance-service

COPY packages/zodu-security /app/packages/zodu-security
COPY attendance-service/package.json attendance-service/package-lock.json attendance-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY attendance-service/ ./

USER node
EXPOSE 4008
CMD ["node", "src/server.js"]
