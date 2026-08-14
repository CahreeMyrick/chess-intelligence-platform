#pragma once
#include "chess/board_bb.hpp"
#include <vector>
#include <limits>

namespace chess {

// Simple material+mobility evaluator (centipawns; + = good for White)
int eval_bb(const BoardBB& pos);

// Search best move for current side with depth ply (negamax + alpha-beta)
Move search_best_move(BoardBB& pos, int depth, int* out_score = nullptr);


// Optional: convert a move to UCI (e2e4)
inline std::string to_uci(const Move& m){
    int f = m.from(), t = m.to();
    auto file = [](int s){ return char('a' + (s % 8)); };
    auto rank = [](int s){ return char('1' + (s / 8)); };
    std::string s;
    s += file(f); s += rank(f); s += file(t); s += rank(t);
    // (We always choose a fully-specified promotion in movegen, so no suffix needed here)
    return s;
}

} // namespace chess
