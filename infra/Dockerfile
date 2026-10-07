# Images for the API and the worker. Both run the TypeScript sources with tsx (there is no
# build step for the packages), so they share every layer and differ only in the start command.
#
#   docker build -f infra/Dockerfile --target api    -t contract-rater-api .
#   docker build -f infra/Dockerfile --target worker -t contract-rater-worker .
#
# Build from the repository root: the context is the whole workspace (see .dockerignore).

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- base: Node and the pnpm version pinned in package.json ("packageManager") ----------
FROM ${NODE_IMAGE} AS base
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_update_notifier=false
WORKDIR /app
COPY package.json ./
# Download pnpm now, readable by every user, so the non-root runtime user never downloads it.
RUN corepack enable \
 && corepack install \
 && chmod -R a+rX "$COREPACK_HOME"

# ---- deps: download every package in the lockfile -----------------------------------------
# Only the lockfile is copied, so this layer stays cached until a dependency changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

# ---- build: the workspace with node_modules linked from the downloaded packages ------------
FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile

# ---- runtime: PDF and OCR tools, the workspace, an unprivileged user -----------------------
FROM base AS runtime
# poppler-utils: pdftotext and pdftoppm. tesseract-ocr-ara: OCR of the Arabic Section 15.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-ara \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    LOCAL_STORAGE_DIR=/data/storage
# The workspace includes the files read at run time: packages/db/migrations,
# packages/law/rules, packages/law/corpus and packages/llm/prompts.
COPY --from=build /app /app
# The encrypted PDFs live in /data/storage; mount a volume there to keep the files.
RUN mkdir -p /data/storage && chown -R node:node /data
USER node

# ---- api: Fastify on port 3000 -----------------------------------------------------------
FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/main.ts"]

# ---- worker: pg-boss consumer that runs the rating pipeline --------------------------------
FROM runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
