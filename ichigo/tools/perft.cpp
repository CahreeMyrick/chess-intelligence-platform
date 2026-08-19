#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include "chess/game.hpp"
#include "chess/board.hpp"
#include "chess/piece.hpp"  // for Pawn dynamic_cast

using namespace chess; // optional

// Parse "rc rc" (e.g., "61 71") into coordinates
static inline bool parse_rc_move(const std::string& m, int& r0,int& c0,int& r1,int& c1){
    if (m.size() < 5) return false;
    r0 = m[0]-'0'; c0 = m[1]-'0';
    r1 = m[3]-'0'; c1 = m[4]-'0';
    return (r0>=0 && r0<8 && c0>=0 && c0<8 && r1>=0 && r1<8 && c1>=0 && c1<8);
}

// Perft that expands promotions into 4 branches (Q,R,B,N)
static uint64_t perft(Game& g, int depth) {
    if (depth == 0) return 1ULL;

    uint64_t nodes = 0;
    auto moves = g.legal_moves();

    for (const auto& m : moves) {
        int r0,c0,r1,c1;
        bool promo4 = false;
        if (parse_rc_move(m, r0,c0,r1,c1)) {
            const Piece* p0 = g.get_board().board[r0][c0].get();
            if (p0 && dynamic_cast<const Pawn*>(p0) != nullptr && (r1 == 0 || r1 == 7)) {
                promo4 = true;
            }
        }

        Game child = g;
        std::string err;
        if (!child.move(m, err)) continue;

        uint64_t sub = perft(child, depth - 1);
        nodes += promo4 ? (sub * 4ULL) : sub;
    }
    return nodes;
}

static void run(const std::string& name, Game& g, int d, uint64_t expected) {
    using namespace std::chrono;
    auto t0 = high_resolution_clock::now();
    uint64_t n = perft(g, d);
    auto t1 = high_resolution_clock::now();
    double ms = duration<double, std::milli>(t1 - t0).count();
    double nps = (ms > 0) ? (n / (ms / 1000.0)) : 0.0;
    std::cout << name << " d=" << d << "  nodes=" << n
              << "  time=" << ms << " ms  (" << (uint64_t)nps << " nps)\n";
    if (expected && n != expected) {
        std::cerr << "MISMATCH: expected " << expected << "\n";
        std::exit(2);
    }
}

int main() {
    {
        Game g; g.load_startpos();
        run("startpos", g, 1, 20);
        run("startpos", g, 2, 400);
        run("startpos", g, 3, 8902);
        run("startpos", g, 4, 197281);
        run("startpos", g, 5, 4865609);
        // run("startpos", g, 6, 119060324);
    }
    {
        Game g; std::string err;
        bool ok = g.load_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", err);
        if (!ok) { std::cerr << "FEN load failed: " << err << "\n"; return 1; }
        run("kiwipete", g, 1, 48);
        run("kiwipete", g, 2, 2039);
        run("kiwipete", g, 3, 97862);
        run("kiwipete", g, 4, 4085603);
        // run("kiwipete", g, 5, 193690690);
        // run("kiwipete", g, 6, 8031647685ULL);
    }
    return 0;
}
