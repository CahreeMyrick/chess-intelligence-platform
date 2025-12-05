# --- Stage 1: build engine (bookworm to match runtime) ---
FROM debian:bookworm-slim AS engine-builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src/ ./src/
COPY include/ ./include/
COPY tools/ ./tools/
# Optional: avoid CPU-specific flags that can break on different hosts
# (You set -march=native in CMakeLists; see note below.)
RUN mkdir build && cd build \
 && cmake .. -DCMAKE_BUILD_TYPE=Release \
 && cmake --build . --config Release --target chess_uci_bb
RUN test -f /src/build/chess_uci_bb

# --- Stage 2: node runtime (bookworm) ---
FROM node:20-bookworm-slim
WORKDIR /app

# deps
COPY package*.json ./
RUN npm ci --only=production

# app
COPY public/ ./public/
COPY server.js ./

# engine
RUN mkdir -p /app/engine
COPY --from=engine-builder /src/build/chess_uci_bb /app/engine/chess_uci_bb
RUN chmod +x /app/engine/chess_uci_bb

# env
ENV NODE_ENV=production
ENV PORT=8080
ENV PLAY_ENGINE_PATH=/app/engine/chess_uci_bb
ENV ANALYSIS_ENGINE_PATH=/usr/bin/stockfish
ENV DATA_DIR=/app/data

EXPOSE 8080
CMD ["node","server.js"]
