FROM node:26.13.1-bookworm-slim AS build
WORKDIR /repo
# Node 25 and later no longer ship corepack, so pnpm is installed at the version package.json pins.
RUN npm install -g pnpm@12.23.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm turbo run build --filter=@madp/api... && pnpm deploy --filter=@madp/api --prod /out

FROM node:26.13.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/mailers ./mailers
USER node
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/main.js"]
