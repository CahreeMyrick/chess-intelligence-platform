#include "chess/attacks.hpp"

namespace chess {

static Bitboard KNIGHT_[64];
static Bitboard KING_[64];
static Bitboard WPA_[64], BPA_[64]; // pawn capture masks

static inline Bitboard north_east(Bitboard b){ return (b & ~FILE_H) << 9; }
static inline Bitboard north_west(Bitboard b){ return (b & ~FILE_A) << 7; }
static inline Bitboard south_east(Bitboard b){ return (b & ~FILE_H) >> 7; }
static inline Bitboard south_west(Bitboard b){ return (b & ~FILE_A) >> 9; }

void init_attacks() {
    for (int s = 0; s < 64; ++s) {
        Bitboard b = bb(Square(s));
        // Knight
        Bitboard n1 = (b & ~FILE_H) << 1;
        Bitboard n2 = (b & ~(FILE_H|FILE_G)) << 2;
        Bitboard s1 = (b & ~FILE_A) >> 1;
        Bitboard s2 = (b & ~(FILE_A|file_mask(1))) >> 2;

        Bitboard up    = b << 8;
        Bitboard up2   = b << 16;
        Bitboard down  = b >> 8;
        Bitboard down2 = b >> 16;

        Bitboard k = 0;
        k |= (up2   & ~0) ? ((b & ~FILE_A) << 15) : 0; // actually derive by combining simpler shifts
        // Build knight via all deltas:
        // (±1,±2), (±2,±1)
        k = 0;
        k |= (b & ~FILE_H) << 17; // +2r +1c
        k |= (b & ~FILE_A) << 15; // +2r -1c
        k |= (b & ~FILE_H) >> 15; // -2r +1c
        k |= (b & ~FILE_A) >> 17; // -2r -1c
        k |= (b & ~(FILE_H|FILE_G)) << 10; // +1r +2c
        k |= (b & ~(FILE_A|file_mask(1))) << 6; // +1r -2c
        k |= (b & ~(FILE_H|FILE_G)) >> 6;  // -1r +2c
        k |= (b & ~(FILE_A|file_mask(1))) >> 10; // -1r -2c
        KNIGHT_[s] = k;

        // King
        Bitboard king = 0;
        king |= north(b);
        king |= south(b);
        king |= east(b);
        king |= west(b);
        king |= north_east(b);
        king |= north_west(b);
        king |= south_east(b);
        king |= south_west(b);
        KING_[s] = king;

        // Pawn captures
        WPA_[s] = north_east(b) | north_west(b);
        BPA_[s] = south_east(b) | south_west(b);
    }
}

Bitboard attacks_knight(Square s) { return KNIGHT_[s]; }
Bitboard attacks_king  (Square s) { return KING_[s];   }
Bitboard attacks_pawn(Color side, Square s) { return side==WHITE ? WPA_[s] : BPA_[s]; }

// On-the-fly sliding rays (fast enough to start; can swap to magics later)
static inline Bitboard ray_north(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while (b & ~rank_mask(7)) { b <<= 8; mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_south(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while (b & ~rank_mask(0)) { b >>= 8; mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_east(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while (b & ~FILE_H) { b = (b & ~FILE_H) << 1; mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_west(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while (b & ~FILE_A) { b = (b & ~FILE_A) >> 1; mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_ne(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while ((b & ~FILE_H) && (b & ~rank_mask(7))) { b = north_east(b); mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_nw(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while ((b & ~FILE_A) && (b & ~rank_mask(7))) { b = north_west(b); mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_se(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while ((b & ~FILE_H) && (b & ~rank_mask(0))) { b = south_east(b); mask |= b; if (b & occ) break; }
    return mask;
}
static inline Bitboard ray_sw(Square s, Bitboard occ){
    Bitboard mask = 0, b = bb(s);
    while ((b & ~FILE_A) && (b & ~rank_mask(0))) { b = south_west(b); mask |= b; if (b & occ) break; }
    return mask;
}

Bitboard attacks_bishop(Square s, Bitboard occ_all){
    return ray_ne(s, occ_all) | ray_nw(s, occ_all) | ray_se(s, occ_all) | ray_sw(s, occ_all);
}
Bitboard attacks_rook(Square s, Bitboard occ_all){
    return ray_north(s, occ_all) | ray_south(s, occ_all) | ray_east(s, occ_all) | ray_west(s, occ_all);
}

} // namespace chess
