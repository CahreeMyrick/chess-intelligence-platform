#pragma once
#include <memory>
#include <string>
#include "chess/types.hpp"

namespace chess {

class Board; // fwd

class Piece {
public:
    Color color = Color::None;
    bool hasMoved = false;
    explicit Piece(Color col = Color::None) : color(col) {}
    virtual ~Piece() = default;
    virtual std::string display() const { return "?"; }
    virtual bool can_move(const Board&, int r0, int c0, int r1, int c1) const = 0;
    virtual std::unique_ptr<Piece> clone() const = 0;
};

class Pawn   : public Piece { public: explicit Pawn(Color);   std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class Knight : public Piece { public: explicit Knight(Color); std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class Bishop : public Piece { public: explicit Bishop(Color); std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class Rook   : public Piece { public: explicit Rook(Color);   std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class Queen  : public Piece { public: explicit Queen(Color);  std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class King   : public Piece { public: explicit King(Color);   std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
class Empty_Square : public Piece { public: explicit Empty_Square();  std::string display() const override; bool can_move(const Board&,int,int,int,int) const override; std::unique_ptr<Piece> clone() const override; };
} // namespace chess
