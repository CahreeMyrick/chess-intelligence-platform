#include "chess/game.hpp"
#include "chess/strategy.hpp"
#include "chess/piece.hpp"
#include <sstream>
#include <iostream>
#include <cctype>
#include <utility>
#include <algorithm>
#include <optional>
#include <memory>

namespace chess {

static const char* to_cstr_local(Color c) { return to_cstr(c); } // reuse helper

// ---- private helpers ----
int Game::c2i(char c) {
    if (c < '0' || c > '7') throw std::out_of_range("index not 0-7");
    return c - '0';
}

bool Game::in_check(Color col) const {
    auto [kr,kc] = b.king_pos(col);
    if (kr < 0) return false; // not found
    return b.attacks_square(other(col), kr, kc);
}

// Simulate (optionally removing an extra captured piece for EP), then restore.
bool Game::leaves_self_in_check(int r0,int c0,int r1,int c1,
                          std::optional<std::pair<int,int>> extra_capture)
{
    auto& from = b.board[r0][c0];
    auto& to   = b.board[r1][c1];
    if (!from) return true;

    Color mover = from->color;

    // Handle temporary EP removal (captured pawn behind the target square)
    std::unique_ptr<Piece> ep_saved;
    int er=-1, ec=-1;
    if (extra_capture) {
        er = extra_capture->first;
        ec = extra_capture->second;
        ep_saved = std::move(b.board[er][ec]); // temporarily remove captured pawn
    }

    // ---- Proper capture simulation (no swap) ----
    std::unique_ptr<Piece> captured = std::move(to);   // may be null
    std::unique_ptr<Piece> moving   = std::move(from); // must exist
    to   = std::move(moving);                          // piece now at destination

    bool check = in_check(mover);

    // ---- Revert ----
    from = std::move(to);           // move piece back to origin
    to   = std::move(captured);     // restore captured piece (if any)
    if (extra_capture) {
        b.board[er][ec] = std::move(ep_saved); // restore EP-captured pawn
    }

    return check;
}

bool Game::can_castle_king_side(Color col) const {
    int row = (col==Color::White) ? 0 : 7;
    int kcol = 4, rcol = 7;
    const Piece* king = b.board[row][kcol].get();
    const Piece* rook = b.board[row][rcol].get();
    if (!king || !rook) return false;
    if (!dynamic_cast<const King*>(king) || !dynamic_cast<const Rook*>(rook)) return false;
    if (king->color!=col || rook->color!=col) return false;
    if (king->hasMoved || rook->hasMoved) return false;
    if (!b.path_clear(row, kcol, row, rcol)) return false;
    if (in_check(col)) return false;
    if (b.attacks_square(other(col), row, kcol+1)) return false;
    if (b.attacks_square(other(col), row, kcol+2)) return false;
    return true;
}

bool Game::can_castle_queen_side(Color col) const {
    int row = (col==Color::White) ? 0 : 7;
    int kcol = 4, rcol = 0;
    const Piece* king = b.board[row][kcol].get();
    const Piece* rook = b.board[row][rcol].get();
    if (!king || !rook) return false;
    if (!dynamic_cast<const King*>(king) || !dynamic_cast<const Rook*>(rook)) return false;
    if (king->color!=col || rook->color!=col) return false;
    if (king->hasMoved || rook->hasMoved) return false;
    if (!b.path_clear(row, kcol, row, rcol)) return false;
    if (in_check(col)) return false;
    if (b.attacks_square(other(col), row, kcol-1)) return false;
    if (b.attacks_square(other(col), row, kcol-2)) return false;
    return true;
}

void Game::do_castle_king_side(Color col) {
    int row = (col==Color::White) ? 0 : 7;
    // king e->g (4->6), rook h->f (7->5)
    auto& king = b.board[row][4];
    auto& rook = b.board[row][7];
    b.board[row][6] = std::move(king);
    b.board[row][5] = std::move(rook);
    b.board[row][4].reset();
    b.board[row][7].reset();
    b.board[row][6]->hasMoved = true;
    b.board[row][5]->hasMoved = true;
}

void Game::do_castle_queen_side(Color col) {
    int row = (col==Color::White) ? 0 : 7;
    // king e->c (4->2), rook a->d (0->3)
    auto& king = b.board[row][4];
    auto& rook = b.board[row][0];
    b.board[row][2] = std::move(king);
    b.board[row][3] = std::move(rook);
    b.board[row][4].reset();
    b.board[row][0].reset();
    b.board[row][2]->hasMoved = true;
    b.board[row][3]->hasMoved = true;
}

void Game::maybe_promote(int r1, int c1) {
    if (!b.board[r1][c1]) return;
    if (dynamic_cast<Pawn*>(b.board[r1][c1].get()) == nullptr) return;
    // white promotes at row 7, black at row 0
    if ((b.board[r1][c1]->color==Color::White && r1==7) ||
        (b.board[r1][c1]->color==Color::Black && r1==0))
    {
        Color col = b.board[r1][c1]->color;
        b.board[r1][c1] = std::make_unique<Queen>(col); // auto-queen
        b.board[r1][c1]->hasMoved = true;
    }
}

bool Game::has_any_legal_move(Color col) {
    for (int r0=0;r0<ROWS;++r0)
        for (int c0=0;c0<COLS;++c0) {
            Piece* p = b.board[r0][c0].get();
            if (!p || p->color!=col) continue;

            for (int r1=0;r1<ROWS;++r1)
                for (int c1=0;c1<COLS;++c1) {
                    if (r0==r1 && c0==c1) continue;

                    // Special: castling
                    if (dynamic_cast<King*>(p) && r0==r1 && std::abs(c1-c0)==2) {
                        if (c1>c0 ? can_castle_king_side(col) : can_castle_queen_side(col))
                            return true;
                        continue;
                    }

                    // En passant possibility
                    if (dynamic_cast<Pawn*>(p) && std::abs(c1-c0)==1) {
                        int dir = (col==Color::White)?+1:-1;
                        if (r1==r0+dir && b.is_empty(r1,c1) && ep.valid
                            && ep.target_r==r1 && ep.target_c==c1 && ep.pawnColor!=col) {
                            if (!leaves_self_in_check(r0,c0,r1,c1, std::make_pair(ep.captured_r,ep.captured_c)))
                                return true;
                            continue;
                        }
                    }

                    // Normal pseudo-legal then legality check
                    if (p->can_move(b,r0,c0,r1,c1)) {
                        if (!leaves_self_in_check(r0,c0,r1,c1))
                            return true;
                    }
                }
        }
    return false;
}

// ---- public methods ----
Game::Game() { b.create_board(); }
Game::Game(const Game& g) : b(g.b), turn(g.turn), ep(g.ep) {}
Game& Game::operator=(const Game& g){ b=g.b; turn=g.turn; ep=g.ep; return *this; }

void Game::print() const { b.display_board(); }

bool Game::parse_move(const std::string& line, int& r0,int& c0,int& r1,int& c1, char& pieceLetter) {
    std::stringstream ss(line);
    std::string a,bm;
    if (!(ss>>a>>bm)) return false;
    int ooff = (std::isdigit(static_cast<unsigned char>(a[0])) ? 0 : 1);
    if ((int)a.size() < ooff+2 || (int)bm.size()!=2) return false;
    pieceLetter = (ooff==0 ? '?' : a[0]);
    r0 = c2i(a[ooff]); c0 = c2i(a[ooff+1]);
    r1 = c2i(bm[0]);   c1 = c2i(bm[1]);
    return true;
}

bool Game::move(const std::string& input, std::string& errmsg) {
    int r0,c0,r1,c1; char letter='?';
    if (!parse_move(input, r0,c0,r1,c1, letter)) {
        errmsg = "Format error. Use P10 30 or 10 30";
        return false;
    }

    if (!b.in_bounds(r0,c0) || !b.in_bounds(r1,c1)) {
        errmsg = "Out of bounds";
        return false;
    }

    auto& src = b.board[r0][c0];
    if (!src) {
        errmsg = "No piece at origin";
        return false;
    }
    if (src->color != turn) {
        errmsg = std::string("It's ") + to_cstr_local(turn) + "'s turn";
        return false;
    }

    // Optional sanity: if a letter was supplied, check it matches
    if (letter!='?') {
        char disp = src->display()[0];
        if (std::tolower(static_cast<unsigned char>(disp)) != std::tolower(static_cast<unsigned char>(letter))) {
            errmsg = "Piece letter doesn't match the origin square";
            return false;
        }
    }

    // ---------- Castling ----------
    if (dynamic_cast<King*>(src.get()) && r0==r1 && std::abs(c1-c0)==2) {
        bool kingside = (c1>c0);
        if (kingside ? can_castle_king_side(turn) : can_castle_queen_side(turn)) {
            if (kingside) do_castle_king_side(turn);
            else          do_castle_queen_side(turn);
            ep.valid = false; // EP cleared on any non-double-pawn move
            turn = other(turn);
            return true;
        } else {
            errmsg = "Castling not allowed now";
            return false;
        }
    }

    // ---------- En passant ----------
    if (dynamic_cast<Pawn*>(src.get()) && std::abs(c1-c0)==1) {
        int dir = (turn==Color::White)?+1:-1;
        if (r1==r0+dir && b.is_empty(r1,c1) && ep.valid
            && ep.target_r==r1 && ep.target_c==c1 && ep.pawnColor!=turn) {

            if (leaves_self_in_check(r0,c0,r1,c1, std::make_pair(ep.captured_r,ep.captured_c))) {
                errmsg = "Move would leave king in check";
                return false;
            }
            // perform EP capture
            b.board[ep.captured_r][ep.captured_c].reset();
            b.board[r1][c1] = std::move(b.board[r0][c0]);
            b.board[r0][c0].reset();
            b.board[r1][c1]->hasMoved = true;

            maybe_promote(r1,c1);
            ep.valid = false;
            turn = other(turn);
            return true;
        }
    }

    // ---------- Normal move (pseudo-legal + king safety) ----------
    if (!src->can_move(b,r0,c0,r1,c1)) {
        errmsg = "Illegal move for that piece";
        return false;
    }
    if (leaves_self_in_check(r0,c0,r1,c1)) {
        errmsg = "Move would leave king in check";
        return false;
    }

    // Execute normal move
    b.board[r1][c1].reset(); // drop captured piece if any
    b.board[r1][c1] = std::move(b.board[r0][c0]);
    b.board[r0][c0].reset();
    b.board[r1][c1]->hasMoved = true;

    // EP bookkeeping
    ep.valid = false;
    if (dynamic_cast<Pawn*>(b.board[r1][c1].get())) {
        int dir = (turn==Color::White)?+1:-1;
        if (std::abs(r1 - r0) == 2) {
            ep.valid = true;
            ep.target_r = r0 + dir;
            ep.target_c = c0;
            ep.captured_r = r1;
            ep.captured_c = c0;
            ep.pawnColor  = turn;
        }
    }

    // Promotion
    maybe_promote(r1,c1);

    // Switch sides
    turn = other(turn);
    return true;
}

bool Game::is_checkmate(Color col) {
    return in_check(col) && !has_any_legal_move(col);
}
bool Game::is_stalemate(Color col) {
    return !in_check(col) && !has_any_legal_move(col);
}

std::vector<std::string> Game::legal_moves() {
    std::vector<std::string> out;
    auto fmt = [](int r, int c){
        std::string s; s.push_back(char('0'+r)); s.push_back(char('0'+c));
        return s;
    };

    for (int r0 = 0; r0 < ROWS; ++r0) for (int c0 = 0; c0 < COLS; ++c0) {
        const Piece* p = b.board[r0][c0].get();
        if (!p || p->color != turn) continue;

        // ---- Castling: add once per king on the home e-file ----
        if (dynamic_cast<const King*>(p)) {
            int homeRow = (turn == Color::White) ? 0 : 7;

            // Castling is only generated if King is on its home square (r0, c0) = (0,4) or (7,4)
            if (r0 == homeRow && c0 == 4) {
                // kingside e->g
                if (can_castle_king_side(turn))
                    out.push_back(fmt(r0, c0) + " " + fmt(homeRow, 6));
                // queenside e->c
                if (can_castle_queen_side(turn))
                    out.push_back(fmt(r0, c0) + " " + fmt(homeRow, 2));
            }
        }

        // ---- Normal moves / EP (scan destinations) ----
        for (int r1 = 0; r1 < ROWS; ++r1) for (int c1 = 0; c1 < COLS; ++c1) {
            if (r0 == r1 && c0 == c1) continue;

            // En passant (mirror move() logic)
            if (dynamic_cast<const Pawn*>(p) && std::abs(c1 - c0) == 1) {
                int dir = (turn == Color::White) ? +1 : -1;
                if (r1 == r0 + dir && b.is_empty(r1, c1) && ep.valid
                    && ep.target_r == r1 && ep.target_c == c1 && ep.pawnColor != turn) {
                    if (!leaves_self_in_check(r0, c0, r1, c1, std::make_pair(ep.captured_r, ep.captured_c)))
                        out.push_back(fmt(r0, c0) + " " + fmt(r1, c1));
                    continue;
                }
            }

            // King normal moves are ONLY one-square now; castling handled above
            if (p->can_move(b, r0, c0, r1, c1) && !leaves_self_in_check(r0, c0, r1, c1))
                out.push_back(fmt(r0, c0) + " " + fmt(r1, c1));
        }
    }
    return out;
}

void Game::loop() {
    while (true) {
        std::cout << "\n" << to_cstr_local(turn) << " to move. Enter (e.g.) P10 30 or 10 30. Type 'quit' to exit.\n";
        b.display_board();
        std::cout << "> ";
        std::string line;
        if (!std::getline(std::cin, line)) break;
        if (line=="quit" || line=="exit") break;
        if (line.empty()) continue;

        std::string err;
        if (!move(line, err)) {
            std::cout << "Invalid: " << err << "\n";
            continue;
        }

        if (is_checkmate(turn)) {
            b.display_board();
            std::cout << "Checkmate! " << to_cstr_local(other(turn)) << " wins.\n";
            break;
        }
        if (is_stalemate(turn)) {
            b.display_board();
            std::cout << "Stalemate! Draw.\n";
            break;
        }
        if (in_check(turn)) {
            std::cout << "Check on " << to_cstr_local(turn) << "!\n";
        }
    }
}

bool Game::load_fen(const std::string& fen, std::string& errmsg) {
    // FEN: <pieces> <side> <castling> <ep> <halfmove> <fullmove>
    std::istringstream ss(fen);
    std::string boardpart, stm, castle, epstr, half, full;
    if (!(ss >> boardpart >> stm >> castle >> epstr >> half >> full)) {
        errmsg = "Bad FEN: missing fields"; return false;
    }

    b.clear();

    // --- piece placement ---
    int r = 7, c = 0;
    for (char ch : boardpart) {
        if (ch == '/') { r--; c = 0; continue; }
        if (std::isdigit(static_cast<unsigned char>(ch))) { c += (ch - '0'); continue; }
        if (c > 7 || r < 0) { errmsg = "Bad FEN: placement overflow"; return false; }

        std::unique_ptr<Piece> up;
        Color col = std::isupper(static_cast<unsigned char>(ch)) ? Color::White : Color::Black;
        char pc = std::tolower(static_cast<unsigned char>(ch));
        switch (pc) {
            case 'p': up = std::make_unique<Pawn>(col);   break;
            case 'n': up = std::make_unique<Knight>(col); break;
            case 'b': up = std::make_unique<Bishop>(col); break;
            case 'r': up = std::make_unique<Rook>(col);   break;
            case 'q': up = std::make_unique<Queen>(col);  break;
            case 'k': up = std::make_unique<King>(col);   break;
            default: errmsg = "Bad FEN: bad piece"; return false;
        }
        b.board[r][c++] = std::move(up);
    }

    if (stm == "w") turn = Color::White;
    else if (stm == "b") turn = Color::Black;
    else { errmsg = "Bad FEN: side to move"; return false; }

    // --- castling rights: default to "moved" (no castling), then enable only if pieces present
    auto setMoved = [&](int rr, int cc, bool moved){
        if (b.board[rr][cc]) b.board[rr][cc]->hasMoved = moved;
    };
    auto kingAt = [&](int rr, int cc){
        return b.board[rr][cc] && dynamic_cast<King*>(b.board[rr][cc].get());
    };
    auto rookAt = [&](int rr, int cc){
        return b.board[rr][cc] && dynamic_cast<Rook*>(b.board[rr][cc].get());
    };

    // Disable all by default
    setMoved(0,4,true); setMoved(0,7,true); setMoved(0,0,true);
    setMoved(7,4,true); setMoved(7,7,true); setMoved(7,0,true);

    // Enable only the specific pieces if rights exist AND pieces are present
    for (char cch : castle) {
        switch (cch) {
            case 'K': if (kingAt(0,4) && rookAt(0,7)) { setMoved(0,4,false); setMoved(0,7,false); } break;
            case 'Q': if (kingAt(0,4) && rookAt(0,0)) { setMoved(0,4,false); setMoved(0,0,false); } break;
            case 'k': if (kingAt(7,4) && rookAt(7,7)) { setMoved(7,4,false); setMoved(7,7,false); } break;
            case 'q': if (kingAt(7,4) && rookAt(7,0)) { setMoved(7,4,false); setMoved(7,0,false); } break;
            case '-': /* nothing */ break;
            default: /* ignore unknown chars */ break;
        }
    }

    // --- en passant target square (square the capturing pawn would move TO)
    ep.valid = false;
    if (epstr != "-" && epstr.size() == 2) {
        int file = epstr[0] - 'a';
        int rank = epstr[1] - '1';
        if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
            ep.valid     = true;
            ep.target_r  = rank;
            ep.target_c  = file;
            ep.captured_r = (turn == Color::White ? rank - 1 : rank + 1); // square of pawn that double-stepped
            ep.captured_c = file;
            ep.pawnColor  = other(turn); // color that double-stepped last move
        }
    }
    return true;
}

bool Game::load_startpos() {
    std::string err;
    return load_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", err);
}

// Debug-only accessors
bool Game::debug_can_castle_king_side(Color c) const { return can_castle_king_side(c); }
bool Game::debug_can_castle_queen_side(Color c) const { return can_castle_queen_side(c); }
bool Game::debug_in_check(Color c) const { return in_check(c); }

void Game::loop_with_strategies(Strategy* white, Strategy* black) {
    while (true) {
        std::cout << "\n" << to_cstr_local(turn) << " to move.\n";
        b.display_board();

        Strategy* who = (turn==Color::White ? white : black);
        std::string line;
        if (who) {
            line = who->select_move(*this);
            if (line.empty()) { std::cout << to_cstr_local(turn) << " has no move.\n"; break; }
            std::cout << "> " << line << "\n";
        } else {
            std::cout << "Enter move (e.g., 10 30): ";
            if (!std::getline(std::cin, line)) break;
            if (line=="quit" || line=="exit") break;
        }

        std::string err;
        if (!move(line, err)) { std::cout << "Invalid: " << err << "\n"; continue; }

        if (is_checkmate(turn)) { b.display_board(); std::cout << "Checkmate! " << to_cstr_local(other(turn)) << " wins.\n"; break; }
        if (is_stalemate(turn)) { b.display_board(); std::cout << "Stalemate! Draw.\n"; break; }
        if (in_check(turn))     { std::cout << "Check on " << to_cstr_local(turn) << "!\n"; }
    }
}

} // namespace chess
