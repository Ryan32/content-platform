FROM node:24.22.3-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Optional one-off migration/import image. No backup, credentials or import package
# is baked in; supply the private package through an approved read-only mount.
FROM build AS operations
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "import:package", "--", "check"]

FROM node:24.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
