# --- Stage 1: build engine (bookworm to match runtime) ---
FROM debian:bookworm-slim AS engine-builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src

COPY CMakeLists.txt ./
COPY src/ ./src/
COPY include/ ./include/
COPY tools/ ./tools/

RUN mkdir build && cd build \
 && cmake .. -DCMAKE_BUILD_TYPE=Release \
 && cmake --build . --config Release --target chess_uci_bb

RUN test -f /src/build/chess_uci_bb

# --- Stage 2: node runtime ---
FROM node:20-bookworm-slim
WORKDIR /app

# Install Stockfish for analysis
RUN apt-get update && apt-get install -y --no-install-recommends stockfish && rm -rf /var/lib/apt/lists/*

# Node deps
COPY package*.json ./
RUN npm ci --only=production

# App files
COPY public/ ./public/
COPY server.js ./

# Ichigo engine
RUN mkdir -p /app/engine
COPY --from=engine-builder /src/build/chess_uci_bb /app/engine/chess_uci_bb
RUN chmod +x /app/engine/chess_uci_bb

# Env
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

# Engines:
# Ichigo = play engine
ENV PLAY_ENGINE_PATH=/app/engine/chess_uci_bb
# Stockfish path on Debian is usually /usr/games/stockfish
ENV ANALYSIS_ENGINE_PATH=/usr/games/stockfish

# For backward compatibility with your existing code (until we refactor server.js)
ENV ENGINE_PATH=/app/engine/chess_uci_bb

EXPOSE 8080
CMD ["node","server.js"]
