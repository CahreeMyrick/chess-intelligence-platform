#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <cctype>
#include <algorithm>

#include "chess/game.hpp"
#include "chess/strategy.hpp"

using namespace chess;

static inline int file_to_col(char f){ return int(f - 'a'); }
static inline int rank_to_row(char r){ return int(r - '1'); }
static inline char col_to_file(int c){ return char('a' + c); }
static inline char row_to_rank(int r){ return char('1' + r); }

static std::string uci_move_to_engine(const std::string& u) {
    if (u.size() < 4) return "";
    int c0 = file_to_col(u[0]);
    int r0 = rank_to_row(u[1]);
    int c1 = file_to_col(u[2]);
    int r1 = rank_to_row(u[3]);
    if (r0<0||r0>7||c0<0||c0>7||r1<0||r1>7||c1<0||c1>7) return "";
    std::string a, b;
    a.push_back(char('0'+r0)); a.push_back(char('0'+c0));
    b.push_back(char('0'+r1)); b.push_back(char('0'+c1));
    return a + " " + b;
}

static std::string engine_move_to_uci(const std::string& m) {
    if (m.size() != 5 || m[2] != ' ') return "";
    int r0 = m[0]-'0', c0 = m[1]-'0', r1 = m[3]-'0', c1 = m[4]-'0';
    std::string u;
    u += col_to_file(c0); u += row_to_rank(r0);
    u += col_to_file(c1); u += row_to_rank(r1);
    return u;
}

struct UciEngine {
    Game game;
    MinimaxStrategy strat;
    bool thinking = false;

    UciEngine() { strat.max_depth = 3; }

    void new_game() { game = Game{}; }

    void set_position_from_cmd(const std::string& cmd) {
        std::istringstream ss(cmd);
        std::string tok; ss >> tok;
        ss >> tok;
        if (tok == "startpos") {
            game = Game{};
            if (ss >> tok && tok == "moves") {
                std::string um;
                while (ss >> um) {
                    std::string mv = uci_move_to_engine(um);
                    std::string err;
                    game.move(mv, err); // ignore failures
                }
            }
        } else if (tok == "fen") {
            // optional: implement FEN parsing from the rest of the line
            std::string fen, rest;
            std::getline(ss, rest);
            // You can parse and call game.load_fen(fen, err) here if desired.
        }
    }

    void go(const std::string& cmd) {
        thinking = true;
        int depth = strat.max_depth;
        int movetime_ms = -1;
        {
            std::istringstream ss(cmd);
            std::string tok; ss >> tok;
            while (ss >> tok) {
                if (tok == "depth") { ss >> depth; }
                else if (tok == "movetime") { ss >> movetime_ms; }
            }
        }
        strat.max_depth = std::max(1, depth);
        std::string best = strat.select_move(game);
        if (best.empty()) std::cout << "bestmove 0000\n";
        else              std::cout << "bestmove " << engine_move_to_uci(best) << "\n";
        std::cout.flush();
        thinking = false;
    }
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    std::cout.setf(std::ios::unitbuf);

    UciEngine E;
    std::string line;

    while (std::getline(std::cin, line)) {
        if (line == "uci") {
            std::cout << "id name MyEngine\n";
            std::cout << "id author You\n";
            std::cout << "uciok\n";
        } else if (line == "isready") {
            std::cout << "readyok\n";
        } else if (line.rfind("setoption", 0) == 0) {
        } else if (line == "ucinewgame") {
            E.new_game();
        } else if (line.rfind("position", 0) == 0) {
            E.set_position_from_cmd(line);
        } else if (line.rfind("go", 0) == 0) {
            E.go(line);
        } else if (line == "stop") {
        } else if (line == "quit") {
            break;
        }
    }
    return 0;
}
