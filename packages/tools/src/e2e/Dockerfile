FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app/nexus-sdk

# The build context is the repo root — copy everything in
COPY . .

RUN npm ci

WORKDIR /app/nexus-sdk/packages/tools
RUN npm ci

WORKDIR /app
COPY packages/tools/src/e2e/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
