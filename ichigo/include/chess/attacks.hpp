#pragma once
#include "chess/bitboard.hpp"

namespace chess {

// initialize tables (call once at startup)
void init_attacks();

// precomputed leapers
Bitboard attacks_knight(Square s);
Bitboard attacks_king  (Square s);

// pawn attacks (captures only), by color
Bitboard attacks_pawn(Color side, Square s);

// sliders: on-the-fly rays with occupancy
Bitboard attacks_bishop(Square s, Bitboard occ_all);
Bitboard attacks_rook  (Square s, Bitboard occ_all);
inline Bitboard attacks_queen(Square s, Bitboard occ_all){
    return attacks_bishop(s, occ_all) | attacks_rook(s, occ_all);
}

} // namespace chess
