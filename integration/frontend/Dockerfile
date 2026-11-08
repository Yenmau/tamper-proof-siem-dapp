# --- tahap build: React + Vite -> file statis
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- tahap serve: nginx + config.json yang diisi saat container start
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-siem-config.sh /docker-entrypoint.d/40-siem-config.sh
# .gitattributes memaksa LF, tapi kalau build dijalankan dari checkout Windows
# yang terlanjur CRLF, buang \r-nya supaya shebang tetap valid.
RUN chmod +x /docker-entrypoint.d/40-siem-config.sh \
    && sed -i 's/\r$//' /docker-entrypoint.d/40-siem-config.sh /etc/nginx/conf.d/default.conf
EXPOSE 80
