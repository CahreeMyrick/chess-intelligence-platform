#pragma once
#include <memory>
#include <utility>
#include <vector>
#include "chess/types.hpp"
#include "chess/piece.hpp"

namespace chess {

class Board {
public:
    std::unique_ptr<Piece> board[ROWS][COLS];

    Board() = default;
    Board(const Board& other);
    Board& operator=(const Board& other);

    void create_board();
    void set_major_pieces(Color color, int row);
    void display_board() const;

    bool in_bounds(int r, int c) const;
    bool is_empty(int r, int c) const;
    bool is_friend(int r, int c, Color) const;
    bool is_enemy(int r, int c, Color) const;

    bool path_clear(int r0,int c0,int r1,int c1) const;
    std::pair<int,int> king_pos(Color col) const;
    bool attacks_square(Color attacker, int r, int c) const;

    void clear();
};

} // namespace chess
