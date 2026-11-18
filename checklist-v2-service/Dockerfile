# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f checklist-v2-service/Dockerfile -t <image> .
# One image, two roles: ROLE=api (default) or ROLE=worker (docker-compose).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/checklist-v2-service

COPY packages/zodu-security /app/packages/zodu-security
COPY checklist-v2-service/package.json checklist-v2-service/package-lock.json checklist-v2-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY checklist-v2-service/src ./src
COPY checklist-v2-service/migrations ./migrations

USER node
EXPOSE 3008
CMD ["node", "src/server.js"]
