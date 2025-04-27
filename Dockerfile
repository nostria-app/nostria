FROM node:22 AS build
WORKDIR /app/src
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:22
# RUN addgroup -S exampleusergroup && adduser -S exampleuser -G exampleusergroup
# USER exampleuser
WORKDIR /usr/app
COPY --from=build /app/src/dist/app/ ./
CMD ["node", "server/server.mjs"]
EXPOSE 4000