#include "chess/piece.hpp"
#include "chess/board.hpp"
#include <cmath>
#include <algorithm> // for std::max

namespace chess {

// ---- ctors / displays ----
Pawn::Pawn(Color col)     : Piece(col) {}
Knight::Knight(Color col) : Piece(col) {}
Bishop::Bishop(Color col) : Piece(col) {}
Rook::Rook(Color col)     : Piece(col) {}
Queen::Queen(Color col)   : Piece(col) {}
King::King(Color col)     : Piece(col) {}

Empty_Square::Empty_Square() : Piece(Color::None) {}
std::string Empty_Square::display() const { return "-"; }
bool Empty_Square::can_move(const Board&, int, int, int, int) const { return false; }
std::unique_ptr<Piece> Empty_Square::clone() const {
    return std::make_unique<Empty_Square>(*this);
}

std::string Pawn::display()   const { return (color == Color::White) ? "P" : "p"; }
std::string Knight::display() const { return (color == Color::White) ? "N" : "n"; }
std::string Bishop::display() const { return (color == Color::White) ? "B" : "b"; }
std::string Rook::display()   const { return (color == Color::White) ? "R" : "r"; }
std::string Queen::display()  const { return (color == Color::White) ? "Q" : "q"; }
std::string King::display()   const { return (color == Color::White) ? "K" : "k"; }

std::unique_ptr<Piece> Pawn::clone()   const { return std::make_unique<Pawn>(*this); }
std::unique_ptr<Piece> Knight::clone() const { return std::make_unique<Knight>(*this); }
std::unique_ptr<Piece> Bishop::clone() const { return std::make_unique<Bishop>(*this); }
std::unique_ptr<Piece> Rook::clone()   const { return std::make_unique<Rook>(*this); }
std::unique_ptr<Piece> Queen::clone()  const { return std::make_unique<Queen>(*this); }
std::unique_ptr<Piece> King::clone()   const { return std::make_unique<King>(*this); }

// ---- can_move implementations (pseudo-legal) ----
bool Pawn::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;

    int dir = (color == Color::White) ? +1 : -1;
    int start_row = (color == Color::White) ? 1 : 6;

    int dr = r1 - r0;
    int dc = c1 - c0;

    if (dc == 0 && dr == dir && b.is_empty(r1, c1)) return true;

    if (dc == 0 && dr == 2*dir && r0 == start_row) {
        int midr = r0 + dir;
        if (b.is_empty(midr, c0) && b.is_empty(r1, c1)) return true;
    }

    if (std::abs(dc) == 1 && dr == dir && b.is_enemy(r1, c1, color)) return true;

    return false; // EP handled in Game
}

bool Knight::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;
    int dr = std::abs(r1 - r0), dc = std::abs(c1 - c0);
    return (dr == 2 && dc == 1) || (dr == 1 && dc == 2);
}

bool Bishop::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;
    int dr = std::abs(r1 - r0), dc = std::abs(c1 - c0);
    if (dr != dc) return false;
    return b.path_clear(r0, c0, r1, c1);
}

bool Rook::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;
    if (r0 != r1 && c0 != c1) return false;
    return b.path_clear(r0, c0, r1, c1);
}

bool Queen::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;
    int dr = std::abs(r1 - r0), dc = std::abs(c1 - c0);
    if (!(r0 == r1 || c0 == c1 || dr == dc)) return false;
    return b.path_clear(r0, c0, r1, c1);
}

bool King::can_move(const Board& b, int r0, int c0, int r1, int c1) const {
    if (r0 == r1 && c0 == c1) return false;
    if (!b.in_bounds(r1, c1) || b.is_friend(r1, c1, color)) return false;
    int dr = std::abs(r1 - r0), dc = std::abs(c1 - c0);
    return std::max(dr, dc) == 1; // castling handled in Game
}

} // namespace chess
