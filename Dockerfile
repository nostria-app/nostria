# syntax=docker/dockerfile:1.7

FROM node:24 AS build
WORKDIR /app/src
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm config set fetch-retries 5 && \
	npm config set fetch-retry-mintimeout 20000 && \
	npm config set fetch-retry-maxtimeout 120000 && \
	npm ci --legacy-peer-deps --no-audit --no-fund
COPY . ./
RUN npm run build

FROM node:24
# RUN addgroup -S exampleusergroup && adduser -S exampleuser -G exampleusergroup
# USER exampleuser
WORKDIR /usr/app
COPY --from=build /app/src/dist/app/ ./
CMD ["node", "server/server.mjs"]
EXPOSE 4000