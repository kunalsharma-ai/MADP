FROM node:26.13.1-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.23.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm turbo run build --filter=@madp/api... && pnpm deploy --filter=@madp/api --prod /out

FROM node:26.13.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/main.js"]
