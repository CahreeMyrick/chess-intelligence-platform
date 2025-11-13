# --- Stage 1: build the C++ engine (bitboard) ---
FROM debian:stable-slim AS engine-builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src

# Copy the CMake project from the repo root
COPY CMakeLists.txt ./
COPY src/ ./src/
COPY include/ ./include/
COPY tools/ ./tools/
# (tests not needed)

# Build only the bitboard engine target to save time
RUN mkdir build && cd build \
 && cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF \
 && cmake --build . --config Release --target chess_uci_bb
RUN test -f /src/build/chess_uci_bb

# --- Stage 2: Node app image ---
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY public/ ./public/
COPY server.js ./

# Copy the engine binary into the runtime image
RUN mkdir -p /app/engine
COPY --from=engine-builder /src/build/chess_uci_bb /app/engine/chess_uci_bb
RUN chmod +x /app/engine/chess_uci_bb

ENV NODE_ENV=production
ENV PORT=8080
ENV ENGINE_PATH=/app/engine/chess_uci_bb

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]
