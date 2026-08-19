#include "chess/board_bb.hpp"
#include "chess/attacks.hpp"
#include <chrono>
#include <iostream>
#include <vector>

using namespace chess;

static uint64_t perft(BoardBB& pos, int depth) {
    if (depth == 0) return 1ULL;
    std::vector<Move> moves;
    pos.generate_legal_moves(moves);
    uint64_t nodes = 0;
    for (auto m : moves) {
        pos.do_move(m);
        nodes += perft(pos, depth - 1);
        pos.undo_move();
    }
    return nodes;
}

int main(int argc, char** argv) {
    init_attacks();

    BoardBB p;
    // default: startpos, or pass a FEN as argv[1]
    if (argc > 1) {
        if (!p.set_fen(argv[1])) {
            std::cerr << "Bad FEN\n";
            return 1;
        }
    } else {
        p.set_startpos();
    }

    for (int d = 1; d <= 6; ++d) {
        auto t0 = std::chrono::steady_clock::now();
        uint64_t nodes = perft(p, d);
        auto t1 = std::chrono::steady_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        double nps = ms > 0 ? (nodes / (ms / 1000.0)) : 0.0;
        std::cout << "d=" << d << " nodes=" << nodes
                  << " time=" << ms << " ms"
                  << " (" << (uint64_t)nps << " nps)\n";
    }
}
