#pragma once
#include <cstdint>
#include "chess/types.hpp"  // uses chess::Color (White, Black, None)

namespace chess {

using Bitboard = std::uint64_t;

constexpr int BOARD_SIZE = 64;
constexpr Bitboard ONE = 1ULL;

// Map your Color enum values to short aliases used by the bitboard code
constexpr Color WHITE = Color::White;
constexpr Color BLACK = Color::Black;

// Board squares (A1 = 0 .. H8 = 63), row-major from White’s perspective.
enum Square : int {
    A1=0,B1,C1,D1,E1,F1,G1,H1,
    A2,B2,C2,D2,E2,F2,G2,H2,
    A3,B3,C3,D3,E3,F3,G3,H3,
    A4,B4,C4,D4,E4,F4,G4,H4,
    A5,B5,C5,D5,E5,F5,G5,H5,
    A6,B6,C6,D6,E6,F6,G6,H6,
    A7,B7,C7,D7,E7,F7,G7,H7,
    A8,B8,C8,D8,E8,F8,G8,H8
};

enum PieceType : std::uint8_t { PAWN=0, KNIGHT=1, BISHOP=2, ROOK=3, QUEEN=4, KING=5, NO_PIECE=6 };

// single-bit mask for a square
inline constexpr Bitboard bb(Square s) { return ONE << static_cast<int>(s); }

// coord helpers
inline constexpr Square sq(int r, int c) { return Square(r*8 + c); }
inline constexpr int row_of(Square s) { return static_cast<int>(s) / 8; }
inline constexpr int col_of(Square s) { return static_cast<int>(s) % 8; }

// bit ops
inline int popcount(Bitboard b) { return __builtin_popcountll(b); }
inline int lsb(Bitboard b)      { return __builtin_ctzll(b); } // precond: b != 0
inline Bitboard pop_lsb(Bitboard &b){ Bitboard x=b&-b; b^=x; return x; }

// masks
inline constexpr Bitboard file_mask(int file) { return 0x0101010101010101ULL << file; } // 0..7
inline constexpr Bitboard rank_mask(int rank) { return 0xFFULL << (rank*8); }           // 0..7

// files
constexpr Bitboard FILE_A = file_mask(0);
constexpr Bitboard FILE_B = file_mask(1);
constexpr Bitboard FILE_G = file_mask(6);
constexpr Bitboard FILE_H = file_mask(7);

// ranks
constexpr Bitboard RANK_1 = rank_mask(0);
constexpr Bitboard RANK_2 = rank_mask(1);
constexpr Bitboard RANK_7 = rank_mask(6);
constexpr Bitboard RANK_3 = rank_mask(2);  // + add
constexpr Bitboard RANK_6 = rank_mask(5);  // + add
constexpr Bitboard RANK_8 = rank_mask(7);

// shifts (caller masks edges as needed)
inline Bitboard north(Bitboard b){ return b << 8; }
inline Bitboard south(Bitboard b){ return b >> 8; }
inline Bitboard east (Bitboard b){ return (b & ~FILE_H) << 1; }
inline Bitboard west (Bitboard b){ return (b & ~FILE_A) >> 1; }

// Aggregate bitboards for a position
struct Bitboards {
    Bitboard occ[2]{};      // occupancy per color
    Bitboard occ_all{};     // all pieces
    Bitboard pcs[2][6]{};   // [color][piece]
};

} // namespace chess
