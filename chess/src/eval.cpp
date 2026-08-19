#include "chess/eval.hpp"
#include "chess/game.hpp"
#include "chess/board.hpp"
#include "chess/piece.hpp"

namespace chess {

int evaluate(const Game& g) {
    const Board& b = g.get_board();

    auto val = [&](const Piece* p)->int {
        if (!p) return 0;
        int s = (p->color==Color::White) ? +1 : -1;
        if (dynamic_cast<const Pawn*>(p))   return 100*s;
        if (dynamic_cast<const Knight*>(p)) return 320*s;
        if (dynamic_cast<const Bishop*>(p)) return 330*s;
        if (dynamic_cast<const Rook*>(p))   return 500*s;
        if (dynamic_cast<const Queen*>(p))  return 900*s;
        return 0; // King not scored here
    };

    int score = 0;
    for (int r=0;r<ROWS;++r)
        for (int c=0;c<COLS;++c)
            score += val(b.board[r][c].get());

    // Tiny mobility bonus for side to move
    Game tmp = g;
    int my_moves = (int)tmp.legal_moves().size();
    score += (tmp.side_to_move()==Color::White ? +my_moves : -my_moves);

    return score; // positive = good for White
}

} // namespace chess
