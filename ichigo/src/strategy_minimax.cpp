#include "chess/strategy.hpp"
#include "chess/game.hpp"
#include "chess/eval.hpp"
#include <algorithm>
#include <limits>

namespace chess {

int MinimaxStrategy::search(Game& pos, int depth, int alpha, int beta) {
    if (depth==0) return evaluate(pos);

    auto moves = pos.legal_moves();
    if (moves.empty()) {
        if (pos.is_checkmate(pos.side_to_move()))
            return (pos.side_to_move()==Color::White ? -100000 : +100000);
        return 0; // stalemate
    }

    bool maxing = (pos.side_to_move()==Color::White);
    if (maxing) {
        int best = std::numeric_limits<int>::min()/2;
        for (auto& m : moves) {
            Game child = pos; std::string err;
            if (!child.move(m, err)) continue;
            int sc = search(child, depth-1, alpha, beta);
            best = std::max(best, sc);
            alpha = std::max(alpha, sc);
            if (beta <= alpha) break;
        }
        return best;
    } else {
        int best = std::numeric_limits<int>::max()/2;
        for (auto& m : moves) {
            Game child = pos; std::string err;
            if (!child.move(m, err)) continue;
            int sc = search(child, depth-1, alpha, beta);
            best = std::min(best, sc);
            beta = std::min(beta, sc);
            if (beta <= alpha) break;
        }
        return best;
    }
}

std::string MinimaxStrategy::select_move(const Game& g0) {
    Game root = g0; // need non-const for legal_moves()
    auto moves = root.legal_moves();
    if (moves.empty()) return "";

    int bestScore = (g0.side_to_move()==Color::White ? std::numeric_limits<int>::min()/2
                                                     : std::numeric_limits<int>::max()/2);
    std::string best = moves.front();

    for (auto& m : moves) {
        Game child = g0; std::string err;
        if (!child.move(m, err)) continue;
        int sc = search(child, max_depth-1, std::numeric_limits<int>::min()/2, std::numeric_limits<int>::max()/2);
        if (g0.side_to_move()==Color::White) {
            if (sc > bestScore) { bestScore = sc; best = m; }
        } else {
            if (sc < bestScore) { bestScore = sc; best = m; }
        }
    }
    return best;
}

} // namespace chess
