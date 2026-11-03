# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f employee-service/Dockerfile -t <image> .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/employee-service

COPY packages/zodu-security /app/packages/zodu-security
COPY employee-service/package.json employee-service/package-lock.json employee-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY employee-service/ ./

USER node
EXPOSE 4002
CMD ["node", "src/server.js"]
