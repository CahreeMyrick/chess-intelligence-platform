#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <cctype>
#include "chess/board_bb.hpp"
#include "chess/search_bb.hpp"
#include "chess/attacks.hpp"

using namespace chess;

static inline int file_to_col(char f){ return int(f - 'a'); }
static inline int rank_to_row(char r){ return int(r - '1'); }
static inline char col_to_file(int c){ return char('a' + c); }
static inline char row_to_rank(int r){ return char('1' + r); }

static std::string move_to_uci(const Move& m){
    int f = m.from(), t = m.to();
    int fr = f / 8, fc = f % 8;
    int tr = t / 8, tc = t % 8;
    std::string u;
    u += col_to_file(fc); u += row_to_rank(fr);
    u += col_to_file(tc); u += row_to_rank(tr);
    switch (m.flag()){
        case MF_PROMO_Q: u += 'q'; break;
        case MF_PROMO_R: u += 'r'; break;
        case MF_PROMO_B: u += 'b'; break;
        case MF_PROMO_N: u += 'n'; break;
        default: break;
    }
    return u;
}

static bool pick_uci_move(BoardBB& pos, const std::string& uci, Move& out){
    if (uci.size() < 4) return false;
    int c0 = file_to_col(uci[0]);
    int r0 = rank_to_row(uci[1]);
    int c1 = file_to_col(uci[2]);
    int r1 = rank_to_row(uci[3]);
    if (r0|c0|r1|c1) {
        if (r0<0||r0>7||c0<0||c0>7||r1<0||r1>7||c1<0||c1>7) return false;
    }
    int from = r0*8 + c0, to = r1*8 + c1;
    char promo = (uci.size() >= 5) ? uci[4] : 0;

    std::vector<Move> legal;
    pos.generate_legal_moves(legal);

    auto pref = [&](Move m)->int{
        // prefer correct promotion piece if present
        if (promo) {
            if (promo=='q' && m.flag()==MF_PROMO_Q) return 100;
            if (promo=='r' && m.flag()==MF_PROMO_R) return 90;
            if (promo=='b' && m.flag()==MF_PROMO_B) return 80;
            if (promo=='n' && m.flag()==MF_PROMO_N) return 70;
        }
        switch (m.flag()){
            case MF_PROMO_Q: return 60;
            case MF_PROMO_R: return 50;
            case MF_PROMO_B: return 40;
            case MF_PROMO_N: return 30;
            case MF_CAPTURE : return 20;
            default: return 10;
        }
    };

    bool found=false; int best=-1;
    for (auto m: legal){
        if (m.from()==from && m.to()==to){
            int p = pref(m);
            if (p>best){ best=p; out=m; found=true; }
        }
    }
    return found;
}

struct UciBB {
    BoardBB pos;

    UciBB(){ init_attacks(); pos.set_startpos(); }

    void ucinewgame(){ pos.set_startpos(); }

    void set_position(const std::string& line){
        std::istringstream ss(line);
        std::string tok; ss >> tok; // "position"
        ss >> tok;
        if (tok=="startpos"){
            pos.set_startpos();
            if (ss >> tok && tok=="moves"){
                std::string u;
                while (ss >> u){
                    Move m;
                    if (pick_uci_move(pos, u, m)) pos.do_move(m);
                    else {
                        // try to resync by regenerating from current FEN if needed
                    }
                }
            }
        } else if (tok=="fen"){
            std::string fen;
            // read the next 6 tokens (standard FEN fields)
            std::string a,b,c,d,e,fm;
            if ((ss >> a >> b >> c >> d >> e >> fm)) {
                fen = a + " " + b + " " + c + " " + d + " " + e + " " + fm;
                pos.set_fen(fen);
                if (ss >> tok && tok=="moves"){
                    std::string u;
                    while (ss >> u){
                        Move m;
                        if (pick_uci_move(pos, u, m)) pos.do_move(m);
                    }
                }
            }
        }
    }

    void go(const std::string& line){
        int depth = 6;
        int movetime_ms = -1;
        {
            std::istringstream ss(line);
            std::string t; ss >> t; // "go"
            while (ss >> t){
                if (t=="depth") ss >> depth;
                else if (t=="movetime") ss >> movetime_ms;
                // (You can parse wtime/btime/inc here if you later add time mgmt)
            }
        }
        int score = 0;
        int d = std::max(1, depth);
        Move best = search_best_move(pos, d, &score);
        std::string uciMove = move_to_uci(best);
        std::cout << "info depth " << d << " score cp " << score << " pv " << uciMove << "\n";
        std::cout << "bestmove " << uciMove << "\n";
        std::cout.flush();
    }

};

int main(){
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    std::cout.setf(std::ios::unitbuf);
    UciBB E;

    std::string line;

    while (std::getline(std::cin, line)){
        if (line=="uci"){
            std::cout << "id name Ichigo-BB\n";
            std::cout << "id author Cahree\n";
            std::cout << "uciok\n";
        } else if (line=="isready"){
            std::cout << "readyok\n";
        } else if (line=="ucinewgame"){
            E.ucinewgame();
        } else if (line.rfind("position",0)==0){
            E.set_position(line);
        } else if (line.rfind("go",0)==0){
            E.go(line);
        } else if (line=="quit"){
            break;
        }
    }
    return 0;
}
