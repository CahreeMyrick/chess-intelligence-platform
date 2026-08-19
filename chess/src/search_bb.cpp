#include "chess/search_bb.hpp"
#include "chess/attacks.hpp"
#include <algorithm>
#include <limits>
#include <cstdint>

namespace chess {

// piece values (centipawns)
static inline int pv(PieceType pt){
    switch(pt){
        case PAWN: return 100;
        case KNIGHT: return 320;
        case BISHOP: return 330;
        case ROOK: return 500;
        case QUEEN: return 900;
        default: return 0;
    }
}

static inline int side_sign(Color c){ return (c==WHITE) ? +1 : -1; }

// very small helper: which piece stands on square s? (slow but fine)
static inline PieceType piece_on(const BoardBB& P, Square s, Color& who){
    Bitboard mask = bb(s);
    for (int c=0;c<2;++c){
        for (int pt=0; pt<6; ++pt){
            if (P.bb.pcs[c][pt] & mask){ who = (c==0?WHITE:BLACK); return (PieceType)pt; }
        }
    }
    who = Color::None; return NO_PIECE;
}

int eval_bb(const BoardBB& pos){
    // material
    int score = 0;
    for (int c=0;c<2;++c){
        for (int pt=0; pt<6; ++pt){
            int pc = popcount(pos.bb.pcs[c][pt]);
            int val = pv((PieceType)pt) * pc;
            score += (c==0 ? +val : -val); // White is index 0
        }
    }
    // mobility (tiny)
    std::vector<Move> ml;
    BoardBB tmp = pos;
    tmp.generate_legal_moves(ml);
    score += (pos.side==WHITE ? + (int)ml.size() : - (int)ml.size());

    return score; // from White's perspective
}

// simple move ordering: captures first (MVV), then promotions, castles, quiets
static inline int move_order_score(const BoardBB& pos, Move m){
    int s = 0;
    if (m.flag()==MF_CAPTURE){
        Color capC; PieceType cap = piece_on(pos, Square(m.to()), capC);
        s += 10'000 + pv(cap);
    } else if (m.flag()>=MF_PROMO_N && m.flag()<=MF_PROMO_Q){
        s += 5'000 + (m.flag()==MF_PROMO_Q ? 300 : (m.flag()==MF_PROMO_R ? 200 : (m.flag()==MF_PROMO_B ? 150 : 100)));
    } else if (m.flag()==MF_EP){
        s += 4'000;
    } else if (m.flag()==MF_CASTLE){
        s += 3'000;
    }
    return s;
}

static int negamax(BoardBB& pos, int depth, int alpha, int beta){
    if (depth==0){
        // evaluate from side-to-move perspective via sign
        int e = eval_bb(pos);
        return side_sign(pos.side) * e;
    }

    std::vector<Move> moves;
    pos.generate_legal_moves(moves);

    if (moves.empty()){
        // checkmate/stalemate
        bool inCheck = pos.square_attacked(pos.king_square(pos.side), other(pos.side));
        if (inCheck) return -100000 + 1; // mate in 1 (rough large negative)
        return 0; // stalemate
    }

    // order moves
    std::sort(moves.begin(), moves.end(), [&](const Move& a, const Move& b){
        return move_order_score(pos,a) > move_order_score(pos,b);
    });

    int best = std::numeric_limits<int>::min()/2;
    for (auto m : moves){
        pos.do_move(m);
        int sc = -negamax(pos, depth-1, -beta, -alpha);
        pos.undo_move();

        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

Move search_best_move(BoardBB& pos, int depth, int* out_score){
    std::vector<Move> moves;
    pos.generate_legal_moves(moves);
    if (moves.empty()) {
        if (out_score) *out_score = 0;
        return Move(); // no move
    }

    // order first layer too
    std::sort(moves.begin(), moves.end(), [&](const Move& a, const Move& b){
        return move_order_score(pos,a) > move_order_score(pos,b);
    });

    int alpha = std::numeric_limits<int>::min()/2;
    int beta  = std::numeric_limits<int>::max()/2;
    Move best = moves.front();
    int bestSc = std::numeric_limits<int>::min()/2;

    for (auto m : moves){
        pos.do_move(m);
        int sc = -negamax(pos, depth-1, -beta, -alpha);
        pos.undo_move();

        if (sc > bestSc){
            bestSc = sc;
            best = m;
        }
        if (sc > alpha) alpha = sc;
    }
    if (out_score) *out_score = bestSc;
    return best;
}

} // namespace chess

