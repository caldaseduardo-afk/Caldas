FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends procps openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && chown node:node /app
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile && pnpm build
CMD ["pnpm", "dev"]
