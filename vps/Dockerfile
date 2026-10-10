# The bakery's site on its own server (Rivo's Database hosting plan, Phases 3d and 5): the Vite build, the
# functions in api/ and vps/server.mjs, which serves both as Vercel did. Settings come from the server's
# env file at run time; nothing secret is in the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build && node vps/build-api.mjs

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY vercel.json ./
COPY vps/server.mjs ./vps/server.mjs
COPY --from=build /app/dist ./dist
COPY --from=build /app/vps/.out ./vps/.out
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/version.json').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "vps/server.mjs"]
