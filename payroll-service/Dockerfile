# Built from the repository root, so the shared packages/zodu-security can be
# copied in (it is a file: dependency, installed as a copy, see its README):
#   docker build -f payroll-service/Dockerfile -t <image> .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/payroll-service

COPY packages/zodu-security /app/packages/zodu-security
COPY payroll-service/package.json payroll-service/package-lock.json payroll-service/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY payroll-service/ ./

USER node
EXPOSE 4004
CMD ["node", "src/server.js"]
