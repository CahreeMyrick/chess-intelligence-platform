#include "chess/board.hpp"
#include <iostream>
#include <cmath>
#include <cctype>

namespace chess {

class Empty_Square; // only used for dynamic_cast in is_empty()

Board::Board(const Board& other) {
    for (int r=0;r<ROWS;++r)
        for (int c=0;c<COLS;++c)
            board[r][c] = other.board[r][c] ? other.board[r][c]->clone() : nullptr;
}

Board& Board::operator=(const Board& other){
    if (this==&other) return *this;
    for (int r=0;r<ROWS;++r)
        for (int c=0;c<COLS;++c)
            board[r][c] = other.board[r][c] ? other.board[r][c]->clone() : nullptr;
    return *this;
}

void Board::set_major_pieces(Color color, int row) {
    // rooks
    board[row][0] = std::make_unique<Rook>(color);
    board[row][7] = std::make_unique<Rook>(color);
    // knights
    board[row][1] = std::make_unique<Knight>(color);
    board[row][6] = std::make_unique<Knight>(color);
    // bishops
    board[row][2] = std::make_unique<Bishop>(color);
    board[row][5] = std::make_unique<Bishop>(color);
    // queen & king
    board[row][3] = std::make_unique<Queen>(color);
    board[row][4] = std::make_unique<King>(color);

    // pawns
    int pawn_row = (row == 0) ? 1 : 6;
    for (int j = 0; j < COLS; j++) {
        board[pawn_row][j] = std::make_unique<Pawn>(color);
    }
}

void Board::create_board() {
    set_major_pieces(Color::White, 0);
    set_major_pieces(Color::Black, 7);
}

void Board::display_board() const {
    auto colLetters = []() {
        std::cout << "    ";
        for (int c = 0; c < COLS; ++c) std::cout << "  " << char('a' + c) << " ";
        std::cout << "\n";
    };

    const char* TL = "┌"; const char* TR = "┐";
    const char* BL = "└"; const char* BR = "┘";
    const char* T  = "┬"; const char* M  = "┼"; const char* B  = "┴";
    const char* H  = "───"; const char* V = "│";

    auto top_border = [&]() {
        std::cout << "    " << TL;
        for (int c = 0; c < COLS; ++c) {
            std::cout << H << (c == COLS - 1 ? TR : T);
        }
        std::cout << "\n";
    };
    auto mid_border = [&]() {
        std::cout << "    " << "├";
        for (int c = 0; c < COLS; ++c) {
            std::cout << H << (c == COLS - 1 ? "┤" : M);
        }
        std::cout << "\n";
    };
    auto bot_border = [&]() {
        std::cout << "    " << BL;
        for (int c = 0; c < COLS; ++c) {
            std::cout << H << (c == COLS - 1 ? BR : B);
        }
        std::cout << "\n";
    };

    colLetters();
    top_border();

    for (int r = 0; r < ROWS; ++r) {
        std::cout << "  " << r << " " << V;
        for (int c = 0; c < COLS; ++c) {
            char pc = board[r][c] ? board[r][c]->display()[0] : '-';
            std::cout << " " << pc << " " << V;
        }
        std::cout << " " << r << "\n";
        if (r != ROWS - 1) mid_border();
    }

    bot_border();
    colLetters();
}

bool Board::in_bounds(int r, int c) const {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

bool Board::is_empty(int r, int c) const {
    if (!board[r][c]) return true;
    return (board[r][c]->color == Color::None) ||
           (dynamic_cast<Empty_Square*>(board[r][c].get()) != nullptr);
}

bool Board::is_friend(int r, int c, Color col) const {
    return !is_empty(r, c) && board[r][c]->color == col;
}

bool Board::is_enemy(int r, int c, Color col) const {
    return !is_empty(r, c) && board[r][c]->color != col;
}

bool Board::path_clear(int r0, int c0, int r1, int c1) const {
    int dr = (r1 > r0) - (r1 < r0);  // -1,0,1
    int dc = (c1 > c0) - (c1 < c0);  // -1,0,1
    if (dr == 0 && dc == 0) return true;
    int r = r0 + dr, c = c0 + dc;
    while (r != r1 || c != c1) {
        if (!in_bounds(r, c) || !is_empty(r, c)) return false;
        r += dr; c += dc;
    }
    return true;
}

std::pair<int,int> Board::king_pos(Color col) const {
    for (int r = 0; r < ROWS; ++r)
        for (int c = 0; c < COLS; ++c)
            if (board[r][c] && board[r][c]->color == col && dynamic_cast<King*>(board[r][c].get()))
                return {r,c};
    return {-1,-1};
}

bool Board::attacks_square(Color attackerColor, int r, int c) const {
    auto inb = [&](int rr, int cc){ return rr>=0 && rr<ROWS && cc>=0 && cc<COLS; };
    auto pawn_dir = [&](Color col){ return (col==Color::White) ? +1 : -1; };

    for (int rr=0; rr<ROWS; ++rr) {
        for (int cc=0; cc<COLS; ++cc) {
            const Piece* p = board[rr][cc].get();
            if (!p || p->color != attackerColor) continue;

            // Knight
            if (dynamic_cast<const Knight*>(p)) {
                int dr = std::abs(r-rr), dc = std::abs(c-cc);
                if ((dr==2 && dc==1) || (dr==1 && dc==2)) return true;
                continue;
            }
            // King
            if (dynamic_cast<const King*>(p)) {
                int dr = std::abs(r-rr), dc = std::abs(c-cc);
                if (std::max(dr,dc)==1) return true;
                continue;
            }
            // Pawn (captures only diagonally)
            if (dynamic_cast<const Pawn*>(p)) {
                int dir = pawn_dir(p->color);
                if (r == rr + dir && std::abs(c - cc) == 1) return true;
                continue;
            }
            // Bishop / Rook / Queen sliding
            auto ray = [&](int drr, int dcc)->bool {
                int tr = rr + drr, tc = cc + dcc;
                while (inb(tr,tc)) {
                    if (tr == r && tc == c) return true;
                    if (!is_empty(tr,tc)) break;
                    tr += drr; tc += dcc;
                }
                return false;
            };
            if (dynamic_cast<const Bishop*>(p) || dynamic_cast<const Queen*>(p)) {
                if (ray(+1,+1) || ray(+1,-1) || ray(-1,+1) || ray(-1,-1)) return true;
            }
            if (dynamic_cast<const Rook*>(p) || dynamic_cast<const Queen*>(p)) {
                if (ray(+1,0) || ray(-1,0) || ray(0,+1) || ray(0,-1)) return true;
            }
        }
    }
    return false;
}

void Board::clear() {
    for (int r=0;r<ROWS;++r)
        for (int c=0;c<COLS;++c)
            board[r][c].reset();
}

} // namespace chess
