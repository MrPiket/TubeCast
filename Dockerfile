# Node 22: yt-dlp requires >= 22.0.0 to use node as its JavaScript runtime,
# which YouTube extraction now needs (see /etc/yt-dlp.conf below).
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      curl \
      ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Without a JS runtime yt-dlp warns on every extraction and silently drops
# formats. Deno is the only one enabled by default; node ships in this image.
RUN printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

EXPOSE 3000

# Update yt-dlp to latest on each container start, then run the app
CMD yt-dlp -U 2>/dev/null || true; exec node dist/index.js
