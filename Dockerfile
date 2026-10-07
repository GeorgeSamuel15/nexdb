FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NEXDB_DATA=/app/data/main.ndb
CMD ["pnpm", "server"]
