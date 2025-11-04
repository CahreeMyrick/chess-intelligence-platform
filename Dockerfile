# --- Stage 1: build the C++ engine (small final image)
FROM debian:stable-slim AS engine-builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Copy only what you need to compile the engine
# (adjust these paths to your engine source layout)
COPY engine_src/ ./    # e.g., CMakeLists.txt, src/*.cpp, include/*.h
RUN mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && cmake --build . --config Release
# Suppose the binary outputs to build/chess_uci:
RUN test -f /src/build/chess_uci

# --- Stage 2: app image
FROM node:20-slim
WORKDIR /app

# Install OS deps your Node app may need
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy Node files & install
COPY package*.json ./
RUN npm ci --only=production

# Copy app code
COPY public/ ./public/
COPY server.js ./

# Copy engine binary from builder
RUN mkdir -p engine
COPY --from=engine-builder /src/build/chess_uci ./engine/chess_uci
RUN chmod +x ./engine/chess_uci

# Optional: create a writable dir for logs/PGN
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV ENGINE_PATH=/engine/chess_uci

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]
