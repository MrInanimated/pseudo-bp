# syntax=docker/dockerfile:1

FROM node:16-alpine as build
WORKDIR /app
COPY . .
RUN apk add --no-cache make g++ python3 sqlite
RUN npm install

FROM node:16-alpine
WORKDIR /app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
CMD ["node", "--expose-gc", "build/app.js"]
EXPOSE 9225