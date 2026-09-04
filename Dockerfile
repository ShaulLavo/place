FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && bun install --production --frozen-lockfile

FROM oven/bun:1.4-slim
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/src src
COPY --from=build /app/package.json .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data COOLDOWN_MS=0
VOLUME /data
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]
