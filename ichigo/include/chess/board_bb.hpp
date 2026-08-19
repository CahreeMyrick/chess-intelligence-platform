#pragma once
#include <vector>
#include <string>
#include "chess/bitboard.hpp"
#include "chess/move.hpp"

namespace chess {

// Castling rights bitfield: 0..3 = KQkq
enum Castle : uint8_t { CR_WK=1<<0, CR_WQ=1<<1, CR_BK=1<<2, CR_BQ=1<<3 };

// map Color to array index
inline constexpr int ci(Color c) {
    return (c == Color::White) ? 0 : (c == Color::Black ? 1 : -1);
}

struct State {
    uint8_t castling{};
    int8_t  ep_sq{-1};       // -1 if none, else 0..63
    uint8_t halfmove{};
    uint8_t captured{NO_PIECE};
    // For undo
    uint8_t moved_piece{NO_PIECE};
    uint8_t moved_from{}, moved_to{};
    uint8_t promo_to{NO_PIECE};
};

class BoardBB {
public:
    Bitboards bb;
    Color side{WHITE};
    uint8_t castling{CR_WK|CR_WQ|CR_BK|CR_BQ};
    int8_t ep_sq{-1};                  // en-passant target square (move-to square)
    uint16_t halfmove{0}, fullmove{1}; // 50-move + ply count
    std::vector<State> stack;          // simple state stack

    // --- construction / IO ---
    BoardBB();
    void clear();
    void set_startpos();
    bool set_fen(const std::string& fen);
    std::string to_fen() const;

    // --- queries ---
    inline Bitboard occ_side(Color c) const { return bb.occ[ci(c)]; }
    inline Bitboard occ_all() const { return bb.occ_all; }
    inline Bitboard pieces(Color c, PieceType p) const { return bb.pcs[ci(c)][p]; }
    inline Square king_square(Color c) const {
        Bitboard k = bb.pcs[ci(c)][KING]; return k? Square(lsb(k)) : Square(-1);
    }

    // --- move plumbing ---
    void do_move(Move m);
    void undo_move();

    // --- generation ---
    void generate_moves(std::vector<Move>& out) const; // pseudo-legal
    void generate_legal_moves(std::vector<Move>& out); // filtered

    // --- attack helpers ---
    bool square_attacked(Square s, Color by) const;

private:
    void put_piece(Color c, PieceType p, Square s);
    void remove_piece(Color c, PieceType p, Square s);
    void move_piece(Color c, PieceType p, Square from, Square to);
};

} // namespace chess
