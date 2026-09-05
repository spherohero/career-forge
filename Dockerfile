FROM node:22.22.0-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.22.0-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/career-forge.db
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /app/data \
    && chown nextjs:nodejs /app/data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=root:root --chmod=0444 /app/LICENSE /app/LICENSE
COPY --from=builder --chown=root:root --chmod=0444 /app/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
COPY --from=builder --chown=root:root --chmod=0444 /app/licenses/Manrope-OFL.txt /app/licenses/Manrope-OFL.txt
COPY --from=builder --chown=root:root --chmod=0444 /app/licenses/JetBrains-Mono-OFL.txt /app/licenses/JetBrains-Mono-OFL.txt
RUN chmod 0755 /app/licenses
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
