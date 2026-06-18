# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
EXPOSE 3000
# Create the database + schema (idempotent) before serving, then start the server.
# In the ECS task the Postgres sidecar is already HEALTHY (task dependsOn), so migrate connects.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
