#include "chess/game.hpp"
#include "chess/strategy.hpp"
#include "chess/eval.hpp"
#include "chess/attacks.hpp"
#include "chess/board_bb.hpp"
#include "chess/search_bb.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <cctype>
#include <sstream>
#include <thread>
#include <chrono>

using namespace chess;

// ---- (same board printer / parser from the previous message) ----
static void display_board_bb(const BoardBB& pos) {
    auto at = [&](int r, int c)->char {
        Square s = Square(r*8 + c);
        for (int col = 0; col < 2; ++col) {
            for (int pt = 0; pt < 6; ++pt) {
                if (pos.bb.pcs[col][pt] & bb(s)) {
                    const char map[6] = {'p','n','b','r','q','k'};
                    char ch = map[pt];
                    return (col==0) ? std::toupper(ch) : ch;
                }
            }
        }
        return '-';
    };

    auto colLetters = []() {
        std::cout << "    ";
        for (int c = 0; c < 8; ++c) std::cout << "  " << char('a' + c) << " ";
        std::cout << "\n";
    };

    const char* TL = "┌"; const char* TR = "┐";
    const char* BL = "└"; const char* BR = "┘";
    const char* T  = "┬"; const char* M  = "┼"; const char* B  = "┴";
    const char* H  = "───"; const char* V = "│";

    colLetters();
    std::cout << "    " << TL;
    for (int c = 0; c < 8; ++c) std::cout << H << (c == 7 ? TR : T);
    std::cout << "\n";

    for (int r = 0; r<8; ++r) {
        std::cout << "  " << r+1 << " " << V;
        for (int c = 0; c < 8; ++c) std::cout << " " << at(r,c) << " " << V;
        std::cout << " " << r+1 << "\n";
        if (r != 7) {
            std::cout << "    " << "├";
            for (int c = 0; c < 8; ++c) std::cout << H << (c == 7 ? "┤" : M);
            std::cout << "\n";
        }
    }

    std::cout << "    " << BL;
    for (int c = 0; c < 8; ++c) std::cout << H << (c == 7 ? BR : B);
    std::cout << "\n";
    colLetters();
}

// --- add this helper above parse_engine_move ---
static bool parse_square(const std::string& s, int& r, int& c) {
    if (s.size() != 2) return false;
    char file = std::tolower(static_cast<unsigned char>(s[0]));
    char rank = s[1];
    if (file < 'a' || file > 'h') return false;
    if (rank < '1' || rank > '8') return false;
    c = file - 'a';         // file a..h -> 0..7
    r = (rank - '1');       // rank 1..8 -> 0..7  (matches board indexing used elsewhere)
    return true;
}

// --- replace your existing parse_engine_move with this one ---
static bool parse_engine_move(const std::string& line, int& r0,int& c0,int& r1,int& c1) {
    // normalize: replace commas with spaces, collapse spaces
    std::string norm; norm.reserve(line.size());
    for (char ch : line) norm.push_back((ch == ',') ? ' ' : ch);

    std::stringstream ss(norm);
    std::string a, b;
    if (!(ss >> a >> b)) return false;

    // Case 1: Algebraic squares, possibly with a leading piece letter on the first token (e.g., "pa1 a3" or "Pa1 a3")
    auto strip_piece_prefix = [](std::string s) -> std::string {
        if (!s.empty()) {
            char p = std::tolower(static_cast<unsigned char>(s[0]));
            if (p=='p' || p=='n' || p=='b' || p=='r' || p=='q' || p=='k') {
                if (s.size() >= 3) s.erase(s.begin()); // only strip if we still have at least 2 chars for the square
            }
        }
        return s;
    };

    std::string a2 = strip_piece_prefix(a);
    if (parse_square(a2, r0, c0) && parse_square(b, r1, c1)) {
        return true;
    }

    // Case 2: Old numeric format "rc rc" (e.g., "10 30") — each token must be exactly 2 digits in [0..7]
    auto twoDigits = [](const std::string& t)->bool {
        return t.size()==2 && std::isdigit(static_cast<unsigned char>(t[0])) && std::isdigit(static_cast<unsigned char>(t[1]));
    };
    if (twoDigits(a) && twoDigits(b)) {
        auto d = [](char ch)->int { return ch - '0'; };
        r0 = d(a[0]); c0 = d(a[1]);
        r1 = d(b[0]); c1 = d(b[1]);
        if (r0>=0 && r0<8 && c0>=0 && c0<8 && r1>=0 && r1<8 && c1>=0 && c1<8) return true;
    }

    return false;
}

/*
static bool parse_engine_move(const std::string& line, int& r0,int& c0,int& r1,int& c1) {
    std::stringstream ss(line);
    std::string a,bm;
    if (!(ss>>a>>bm)) return false;
    int ooff = (std::isdigit(static_cast<unsigned char>(a[0])) ? 0 : 1);
    if ((int)a.size() < ooff+2 || (int)bm.size()!=2) return false;
    auto c2i = [](char d)->int { if (d<'0'||d>'7') return -1; return d-'0'; };
    r0 = c2i(a[ooff]); c0 = c2i(a[ooff+1]);
    r1 = c2i(bm[0]);   c1 = c2i(bm[1]);
    return (r0|c0|r1|c1) >= 0;
}
*/
static bool pick_move_from_to(BoardBB& pos, int r0,int c0,int r1,int c1, Move& out) {
    std::vector<Move> moves;
    pos.generate_legal_moves(moves);
    int from = r0*8 + c0, to = r1*8 + c1;
    auto pref = [](Move m)->int {
        switch (m.flag()) {
            case MF_PROMO_Q: return 5;
            case MF_PROMO_R: return 4;
            case MF_PROMO_B: return 3;
            case MF_PROMO_N: return 2;
            case MF_CASTLE : return 1;
            default: return 0;
        }
    };
    bool found = false; int best = -1;
    for (auto m : moves) if (m.from()==from && m.to()==to) {
        int pr = pref(m);
        if (pr > best) { best = pr; out = m; found = true; }
    }
    return found;
}

static const char* to_cstr_color(Color c) {
    return c==Color::White ? "white" : (c==Color::Black ? "black" : "none");
}

// ---- Bitboard modes ----
static void cli_bitboard_hvh(){
    BoardBB pos; pos.set_startpos();
    while (true) {
        std::cout << "\n" << to_cstr_color(pos.side)
          << " to move. Enter like 'pa1 a3' or 'a1 a3' (commas ok), or '10 30'. Type 'quit' to exit.\n";
        /*std::cout << "\n" << to_cstr_color(pos.side) << " to move. Enter (e.g.) 10 30. Type 'quit' to exit.\n";*/
        display_board_bb(pos);
        std::cout << "> ";
        std::string line;
        if (!std::getline(std::cin, line)) break;
        if (line=="quit" || line=="exit") break;
        if (line.empty()) continue;

        int r0,c0,r1,c1;
        if (!parse_engine_move(line, r0,c0,r1,c1)) { std::cout << "Invalid format.\n"; continue; }

        Move m;
        if (!pick_move_from_to(pos, r0,c0,r1,c1, m)) { std::cout << "Not a legal move.\n"; continue; }
        pos.do_move(m);

        std::vector<Move> reply; pos.generate_legal_moves(reply);
        if (reply.empty()){
            display_board_bb(pos);
            if (pos.square_attacked(pos.king_square(pos.side), other(pos.side)))
                std::cout << "Checkmate! " << to_cstr_color(other(pos.side)) << " wins.\n";
            else std::cout << "Stalemate! Draw.\n";
            break;
        } else if (pos.square_attacked(pos.king_square(pos.side), other(pos.side))){
            std::cout << "Check on " << to_cstr_color(pos.side) << "!\n";
        }
    }
}

static void cli_bitboard_hvai(bool humanIsWhite, int aiDepth){
    BoardBB pos; pos.set_startpos();

    auto human_move = [&](Color who)->bool{
        while (true){
            std::cout << "\n" << to_cstr_color(pos.side)
          << " to move. Enter like 'pa1 a3' or 'a1 a3' (commas ok), or '10 30'. Type 'quit' to exit.\n";
            /*std::cout << "\n" << to_cstr_color(who) << " to move. Enter (e.g.) 10 30, or 'quit'.\n";*/
            display_board_bb(pos);
            std::cout << "> ";
            std::string line;
            if (!std::getline(std::cin, line)) return false;
            if (line=="quit" || line=="exit") return false;
            if (line.empty()) continue;

            int r0,c0,r1,c1;
            if (!parse_engine_move(line, r0,c0,r1,c1)) { std::cout << "Invalid format.\n"; continue; }
            Move m;
            if (!pick_move_from_to(pos, r0,c0,r1,c1, m)) { std::cout << "Not a legal move.\n"; continue; }
            pos.do_move(m);
            return true;
        }
    };

    auto ai_move = [&](Color who)->bool{
        std::vector<Move> ml; pos.generate_legal_moves(ml);
        if (ml.empty()) return false;
        Move best = search_best_move(pos, aiDepth);
        std::cout << to_cstr_color(who) << " (AI, depth " << aiDepth << ") plays " << to_uci(best) << "\n";
        pos.do_move(best);
        return true;
    };

    while (true){
        // current side has to play
        bool ok = true;
        if ((pos.side==WHITE && humanIsWhite) || (pos.side==BLACK && !humanIsWhite)){
            ok = human_move(pos.side);
        } else {
            display_board_bb(pos); // show before AI moves
            ok = ai_move(pos.side);
            // small pause so it doesn't feel instant
            std::this_thread::sleep_for(std::chrono::milliseconds(150));
        }
        if (!ok) break;

        // terminal?
        std::vector<Move> reply; pos.generate_legal_moves(reply);
        if (reply.empty()){
            display_board_bb(pos);
            if (pos.square_attacked(pos.king_square(pos.side), other(pos.side)))
                std::cout << "Checkmate! " << to_cstr_color(other(pos.side)) << " wins.\n";
            else std::cout << "Stalemate! Draw.\n";
            break;
        } else if (pos.square_attacked(pos.king_square(pos.side), other(pos.side))){
            std::cout << "Check on " << to_cstr_color(pos.side) << "!\n";
        }
    }
}

static void cli_bitboard_aivai(int depthW, int depthB, int msDelay=150){
    BoardBB pos; pos.set_startpos();
    while (true){
        display_board_bb(pos);
        std::vector<Move> ml; pos.generate_legal_moves(ml);
        if (ml.empty()){
            if (pos.square_attacked(pos.king_square(pos.side), other(pos.side)))
                std::cout << "Checkmate! " << to_cstr_color(other(pos.side)) << " wins.\n";
            else std::cout << "Stalemate! Draw.\n";
            break;
        }
        int d = (pos.side==WHITE? depthW : depthB);
        Move best = search_best_move(pos, d);
        std::cout << to_cstr_color(pos.side) << " (AI d" << d << ") plays " << to_uci(best) << "\n";
        pos.do_move(best);
        std::this_thread::sleep_for(std::chrono::milliseconds(msDelay));
    }
}

// ---- Your original OOP engine loop remains below ----
int main() {
    chess::init_attacks();

    Game game;
    MinimaxStrategy aiWhite, aiBlack;
    aiWhite.max_depth = 3; aiBlack.max_depth = 3;

    std::cout << "Choose game mode:\n"
              << "  1) Human (White) vs AI (Black)\n"
              << "  2) AI (White) vs Human (Black)\n"
              << "  3) AI vs AI\n"
              << "  4) Human vs Human (Player vs Player)\n"
              << "  5) Bitboard CLI (Human vs Human)\n"
              << "  6) Bitboard: Human (White) vs AI\n"
              << "  7) Bitboard: AI (White) vs Human\n"
              << "  8) Bitboard: AI vs AI\n"
              << "Enter 1-8: ";

    int mode = 0;
    std::string line;
    if (!std::getline(std::cin, line)) return 0;
    try { mode = std::stoi(line); } catch (...) {mode = 0;}

    switch (mode){
        case 5: cli_bitboard_hvh(); return 0;
        case 6: cli_bitboard_hvai(true,  1 /*depth*/); return 0;
        case 7: cli_bitboard_hvai(false, 6 /*depth*/); return 0;
        case 8: cli_bitboard_aivai(6,6,150); return 0;
        default: break; // fall through to classic engine modes
    }

    Strategy* white = nullptr;
    Strategy* black = nullptr;
    switch (mode) {
        case 1: white = nullptr;  black = &aiBlack; break;
        case 2: white = &aiWhite; black = nullptr;  break;
        case 3: white = &aiWhite; black = &aiBlack; break;
        case 4: white = nullptr;  black = nullptr;  break;
        default:
            std::cout << "Invalid choice. Defaulting to Human (White) vs AI (Black).\n";
            white = nullptr; black = &aiBlack; break;
    }
    game.loop_with_strategies(white, black);
    return 0;
}
