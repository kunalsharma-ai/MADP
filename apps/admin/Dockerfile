FROM node:26.13.1-bookworm-slim AS build
WORKDIR /repo
# Node 25 and later no longer ship corepack, so pnpm is installed at the version package.json pins.
RUN npm install -g pnpm@12.23.0
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm turbo run build --filter=@madp/admin...

FROM node:26.13.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
