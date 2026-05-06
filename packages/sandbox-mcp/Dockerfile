# syntax=docker/dockerfile:1.7
#
# @openfinance-os/sandbox-mcp — anonymous Streamable HTTP MCP server.
# This is what hosts at mcp.openfinance-os.org/sandbox under PRD D-13.
#
# Build:  docker build -f packages/sandbox-mcp/Dockerfile -t sandbox-mcp .
# Run:    docker run --rm -p 8787:8787 sandbox-mcp
# Probe:  curl http://127.0.0.1:8787/health

FROM node:20-alpine AS builder
WORKDIR /app

# Copy only the manifests first so the dep layer caches independently of source
# changes. Both workspaces are needed because sandbox-mcp has a workspace dep
# on sandbox-fixtures.
COPY package.json package-lock.json ./
COPY packages/sandbox-fixtures/package.json packages/sandbox-fixtures/package.json
COPY packages/sandbox-mcp/package.json packages/sandbox-mcp/package.json

RUN npm ci --include-workspace-root --workspaces

# Now bring the rest in and bake the deterministic fixture corpus into the
# fixtures package. The MCP server reads the corpus at runtime, so it must be
# present in the final image.
COPY . .
RUN npm run build:fixtures

# ── Runtime image ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

# Only copy what the MCP server actually loads at runtime — root manifests,
# the two workspace packages (with built fixture corpus), and the resolved
# node_modules tree. The full repo (src/, tests/, _site/, dist/, …) is not
# needed at runtime.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/sandbox-fixtures ./packages/sandbox-fixtures
COPY --from=builder /app/packages/sandbox-mcp ./packages/sandbox-mcp

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8787)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

USER node

ENTRYPOINT ["node", "packages/sandbox-mcp/src/index.mjs"]
CMD ["--transport", "http", "--host", "0.0.0.0", "--port", "8787"]
