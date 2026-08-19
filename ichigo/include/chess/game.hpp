#pragma once
#include <string>
#include <vector>
#include <optional>
#include "chess/types.hpp"
#include "chess/board.hpp"

namespace chess {

struct Strategy; // fwd

class Game {
    Board b;
    Color turn = Color::White;

    struct EP {
        bool valid=false; int target_r=-1,target_c=-1; int captured_r=-1,captured_c=-1; Color pawnColor=Color::None;
    } ep;

    static int c2i(char c);
    bool in_check(Color) const;
    bool leaves_self_in_check(int r0,int c0,int r1,int c1,
        std::optional<std::pair<int,int>> extra_capture = std::nullopt);

    bool can_castle_king_side(Color) const;
    bool can_castle_queen_side(Color) const;
    void do_castle_king_side(Color);
    void do_castle_queen_side(Color);
    void maybe_promote(int r1,int c1);
    bool has_any_legal_move(Color);

public:
    Game();
    Game(const Game&);
    Game& operator=(const Game&);

    void print() const;
    const Board& get_board() const { return b; }
    Color side_to_move() const { return turn; }

    bool parse_move(const std::string&, int& r0,int& c0,int& r1,int& c1, char& pieceLetter);
    bool move(const std::string& input, std::string& errmsg);

    bool is_checkmate(Color);
    bool is_stalemate(Color);
    std::vector<std::string> legal_moves();

    bool load_fen(const std::string& fen, std::string& errmsg);
    bool load_startpos();

    // debug helpers
    bool debug_can_castle_king_side(Color) const;
    bool debug_can_castle_queen_side(Color) const;
    bool debug_in_check(Color) const;

    void loop_with_strategies(Strategy* white, Strategy* black);

    void loop();
};

} // namespace chess
