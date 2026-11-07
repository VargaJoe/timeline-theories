# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node client/package.json client/package-lock.json ./client/
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --legacy-peer-deps --no-audit --no-fund
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --prefix client --legacy-peer-deps --no-audit --no-fund
COPY --chown=node:node client ./client
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node deployment/docker/netlify.toml ./netlify.toml
EXPOSE 8080
CMD ["node", "scripts/local-app-container.mjs"]
