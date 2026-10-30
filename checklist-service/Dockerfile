# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f checklist-service/Dockerfile -t <image> .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/checklist-service

COPY packages/zodu-security /app/packages/zodu-security
COPY checklist-service/package.json checklist-service/package-lock.json checklist-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY checklist-service/ ./

USER node
EXPOSE 4005
CMD ["node", "src/server.js"]
