#include "chess/board_bb.hpp"
#include "chess/attacks.hpp"
#include <cctype>
#include <cassert>
#include <sstream>
#include <cmath>   // for std::abs

namespace chess {

// Helper to get a single-bit mask for a square, avoiding the member `bb` name clash.
static inline Bitboard SQ(Square s) { return ::chess::bb(s); }
// Keep SBB for from/to masks, routed through SQ
static inline Bitboard SBB(Square s){ return SQ(s); }

void BoardBB::put_piece(Color c, PieceType p, Square s){
    Bitboard b = SBB(s);
    bb.pcs[ci(c)][p] |= b;
    bb.occ[ci(c)]    |= b;
    bb.occ_all       |= b;
}

void BoardBB::remove_piece(Color c, PieceType p, Square s){
    Bitboard b = SBB(s);
    bb.pcs[ci(c)][p] &= ~b;
    bb.occ[ci(c)]    &= ~b;
    bb.occ_all       &= ~b;
}

void BoardBB::move_piece(Color c, PieceType p, Square from, Square to){
    Bitboard f = SBB(from), t = SBB(to);
    bb.pcs[ci(c)][p] ^= (f | t);
    bb.occ[ci(c)]    ^= (f | t);
    bb.occ_all       ^= (f | t);
}

BoardBB::BoardBB(){ clear(); }

void BoardBB::clear(){
    bb = {};
    side = WHITE;
    castling = 0;
    ep_sq = -1;
    halfmove = 0; fullmove = 1;
    stack.clear();
}

void BoardBB::set_startpos(){
    clear();
    // Pawns
    for (int c=0;c<8;++c){
        put_piece(WHITE, PAWN,  Square(A2 + c));
        put_piece(BLACK, PAWN,  Square(A7 + c));
    }
    // Back ranks
    put_piece(WHITE, ROOK, A1);   put_piece(WHITE, KNIGHT, B1);
    put_piece(WHITE, BISHOP, C1); put_piece(WHITE, QUEEN, D1);
    put_piece(WHITE, KING, E1);   put_piece(WHITE, BISHOP, F1);
    put_piece(WHITE, KNIGHT, G1); put_piece(WHITE, ROOK, H1);

    put_piece(BLACK, ROOK, A8);   put_piece(BLACK, KNIGHT, B8);
    put_piece(BLACK, BISHOP, C8); put_piece(BLACK, QUEEN, D8);
    put_piece(BLACK, KING, E8);   put_piece(BLACK, BISHOP, F8);
    put_piece(BLACK, KNIGHT, G8); put_piece(BLACK, ROOK, H8);

    castling = CR_WK|CR_WQ|CR_BK|CR_BQ;
    side = WHITE;
}

bool BoardBB::set_fen(const std::string& fen){
    clear();
    // <pieces> <side> <castling> <ep> <half> <full>
    std::string p, stm, cr, ep, h, f;
    std::istringstream ss(fen);
    if(!(ss>>p>>stm>>cr>>ep>>h>>f)) return false;

    int r=7, c=0;
    for(char ch: p){
        if (ch=='/'){ --r; c=0; continue; }
        if (std::isdigit(static_cast<unsigned char>(ch))){ c += ch-'0'; continue; }
        Color col = std::isupper(static_cast<unsigned char>(ch)) ? WHITE : BLACK;
        char pc = std::tolower(static_cast<unsigned char>(ch));
        PieceType pt=NO_PIECE;
        switch (pc){
            case 'p': pt=PAWN; break; case 'n': pt=KNIGHT; break;
            case 'b': pt=BISHOP; break; case 'r': pt=ROOK; break;
            case 'q': pt=QUEEN; break; case 'k': pt=KING; break;
            default: return false;
        }
        put_piece(col, pt, Square(r*8 + c));
        ++c;
    }

    side = (stm=="w")?WHITE:BLACK;

    castling = 0;
    for(char ch: cr){
        if (ch=='K') castling |= CR_WK;
        else if (ch=='Q') castling |= CR_WQ;
        else if (ch=='k') castling |= CR_BK;
        else if (ch=='q') castling |= CR_BQ;
    }

    ep_sq = -1;
    if (ep!="-"){
        int file = ep[0]-'a';
        int rank = ep[1]-'1';
        if (file>=0 && file<8 && rank>=0 && rank<8) ep_sq = rank*8 + file;
    }

    halfmove = h.empty()?0:std::stoi(h);
    fullmove = f.empty()?1:std::stoi(f);
    return true;
}

std::string BoardBB::to_fen() const{
    auto piece_at = [&](int r, int c)->char{
        Square s = Square(r*8+c);
        for(int col=0; col<2; ++col){
            for(int pt=0; pt<6; ++pt){
                if (bb.pcs[col][pt] & SBB(s)){
                    const char map[6] = {'p','n','b','r','q','k'};
                    char ch = map[pt];
                    return (col==0) ? std::toupper(ch) : ch; // 0=White, 1=Black
                }
            }
        }
        return '1';
    };
    std::string out;
    for(int r=7;r>=0;--r){
        int empties=0;
        for(int c=0;c<8;++c){
            char ch = piece_at(r,c);
            if (ch=='1'){ ++empties; }
            else{
                if (empties){ out.push_back(char('0'+empties)); empties=0; }
                out.push_back(ch);
            }
        }
        if (empties) out.push_back(char('0'+empties));
        if (r) out.push_back('/');
    }
    out += side==WHITE ? " w " : " b ";
    if (!castling) out += "-";
    else{
        if (castling & CR_WK) out+='K';
        if (castling & CR_WQ) out+='Q';
        if (castling & CR_BK) out+='k';
        if (castling & CR_BQ) out+='q';
    }
    out += ' ';
    if (ep_sq<0) out += "-";
    else{
        int f = ep_sq % 8, r = ep_sq / 8;
        out.push_back(char('a'+f));
        out.push_back(char('1'+r));
    }
    out += ' ';
    out += std::to_string(halfmove);
    out += ' ';
    out += std::to_string(fullmove);
    return out;
}

// --- attack detector (used for legality checks)
bool BoardBB::square_attacked(Square s, Color by) const {
    // Pawns
    if (attacks_pawn(other(by), s) & bb.pcs[ci(by)][PAWN]) return true; // square attacked by 'by'
    // Knights
    if (attacks_knight(s) & bb.pcs[ci(by)][KNIGHT]) return true;
    // Kings
    if (attacks_king(s) & bb.pcs[ci(by)][KING]) return true;
    // Sliders
    Bitboard occ = bb.occ_all;
    if (attacks_bishop(s, occ) & (bb.pcs[ci(by)][BISHOP] | bb.pcs[ci(by)][QUEEN])) return true;
    if (attacks_rook  (s, occ) & (bb.pcs[ci(by)][ROOK]   | bb.pcs[ci(by)][QUEEN])) return true;
    return false;
}

// --- move do/undo (simple, stateful)
void BoardBB::do_move(Move m){
    State st{};
    st.castling = castling;
    st.ep_sq    = ep_sq;
    st.halfmove = (uint8_t)halfmove;

    Square from = Square(m.from()), to = Square(m.to());
    Color us = side, them = other(us);

    // identify moving piece
    PieceType pt = NO_PIECE;
    for(int p=0;p<6;++p) if (bb.pcs[ci(us)][p] & SBB(from)){ pt = (PieceType)p; break; }
    st.moved_piece = pt; st.moved_from = m.from(); st.moved_to = m.to();

    // captures (including EP)
    if (m.flag()==MF_EP){
        // capture pawn behind the to-square
        int to_r = row_of(to), to_c = col_of(to);
        int cap_r = (us==WHITE) ? to_r - 1 : to_r + 1;
        Square cap = Square(cap_r*8 + to_c);
        remove_piece(them, PAWN, cap);
        st.captured = PAWN;
        // move pawn
        move_piece(us, PAWN, from, to);
        halfmove = 0;
    } else {
        // normal capture?
        if (bb.occ[ci(them)] & SBB(to)){
            // find captured type
            for(int p=0;p<6;++p){
                if (bb.pcs[ci(them)][p] & SBB(to)){ remove_piece(them, (PieceType)p, to); st.captured = p; break; }
            }
            halfmove = 0;
        } else {
            halfmove += 1;
        }
        // move piece
        move_piece(us, pt, from, to);
    }

    // promotions
    if (m.flag()>=MF_PROMO_N && m.flag()<=MF_PROMO_Q){
        PieceType promo = (PieceType)(m.flag()-MF_PROMO_N+KNIGHT);
        remove_piece(us, PAWN, to);
        put_piece(us, promo, to);
        st.promo_to = promo;
        halfmove = 0;
    }

    // castling move
    if (m.flag()==MF_CASTLE){
        // determine side by squares
        if (us==WHITE){
            if (to==G1){ // e1g1 rook h1f1
                move_piece(WHITE, ROOK, H1, F1);
            } else {     // e1c1 rook a1d1
                move_piece(WHITE, ROOK, A1, D1);
            }
        } else {
            if (to==G8){
                move_piece(BLACK, ROOK, H8, F8);
            } else {
                move_piece(BLACK, ROOK, A8, D8);
            }
        }
        halfmove += 1;
    }

    // update castling rights (if king or rook moved/captured)
    auto clear_rook_right = [&](Color c, Square s){
        if (c==WHITE){
            if (s==H1) castling &= ~CR_WK;
            if (s==A1) castling &= ~CR_WQ;
        } else {
            if (s==H8) castling &= ~CR_BK;
            if (s==A8) castling &= ~CR_BQ;
        }
    };
    if (pt==KING){
        if (us==WHITE) castling &= ~(CR_WK|CR_WQ);
        else           castling &= ~(CR_BK|CR_BQ);
    }
    if (pt==ROOK) clear_rook_right(us, from);
    if (st.captured==ROOK) clear_rook_right(them, to);

    // EP target
    if (pt==PAWN && (row_of(to) - row_of(from) == 2 || row_of(from) - row_of(to) == 2)){
        // set target square behind the pawn
        ep_sq = (row_of(from) + row_of(to))/2 * 8 + col_of(from);
        halfmove = 0;
    } else ep_sq = -1;

    // side/fullmove
    if (us==BLACK) fullmove += 1;
    side = other(side);

    stack.push_back(st);
}

void BoardBB::undo_move(){
    assert(!stack.empty());
    State st = stack.back(); stack.pop_back();

    side = other(side);
    castling = st.castling;
    ep_sq    = st.ep_sq;
    halfmove = st.halfmove;

    Square from = Square(st.moved_from), to = Square(st.moved_to);
    Color us = side, them = other(side);
    PieceType pt = (PieceType)st.moved_piece;

    // undo promotions
    if (st.promo_to != NO_PIECE){
        remove_piece(us, (PieceType)st.promo_to, to);
        put_piece(us, PAWN, to);
    }

    // if castling, move rook back
    if ( (pt==KING) && (std::abs(col_of(to)-col_of(from))==2) ){
        if (us==WHITE){
            if (to==G1){ move_piece(WHITE, ROOK, F1, H1); }
            else        { move_piece(WHITE, ROOK, D1, A1); }
        } else {
            if (to==G8){ move_piece(BLACK, ROOK, F8, H8); }
            else        { move_piece(BLACK, ROOK, D8, A8); }
        }
    }

    // move piece back
    move_piece(us, pt, to, from);

    // restore captured
    if (st.captured != NO_PIECE){
        if (st.promo_to==NO_PIECE && st.moved_piece==PAWN && ep_sq!=-1 && st.ep_sq!=-1 && st.moved_to==st.ep_sq && st.captured==PAWN){
            // EP undo (rare path); simpler: track an EP flag in State if preferred
            int to_r = row_of(Square(st.moved_to)), to_c = col_of(Square(st.moved_to));
            int cap_r = (us==WHITE) ? to_r - 1 : to_r + 1;
            Square cap = Square(cap_r*8 + to_c);
            put_piece(them, PAWN, cap);
        } else {
            put_piece(them, (PieceType)st.captured, to);
        }
    }

    if (us==BLACK) fullmove -= 1;
}

// --- move generation (pseudo-legal) ---
void BoardBB::generate_moves(std::vector<Move>& out) const {
    out.clear();
    Color us = side, them = other(us);
    Bitboard occUs = bb.occ[ci(us)], occThem = bb.occ[ci(them)], occAll = bb.occ_all;

    // Pawns
    Bitboard P = bb.pcs[ci(us)][PAWN];
    if (us==WHITE){
                // White
        Bitboard single = north(P) & ~occAll;
        Bitboard dbl    = north(single & RANK_3) & ~occAll;  // was RANK_2

        // pushes
        for (Bitboard b=single; b;){ int to = lsb(b); pop_lsb(b);
            int r = row_of(Square(to));
            if (r==7) { // promotions
                out.emplace_back(to-8, to, MF_PROMO_Q);
                out.emplace_back(to-8, to, MF_PROMO_R);
                out.emplace_back(to-8, to, MF_PROMO_B);
                out.emplace_back(to-8, to, MF_PROMO_N);
            } else {
                out.emplace_back(to-8, to, MF_QUIET);
            }
        }
        for (Bitboard b=dbl; b;){ int to = lsb(b); pop_lsb(b);
            out.emplace_back(to-16, to, MF_QUIET);
        }
        // captures
        Bitboard left  = (P & ~FILE_A) << 7;
        Bitboard right = (P & ~FILE_H) << 9;
        Bitboard capsL = left  & occThem;
        Bitboard capsR = right & occThem;
        for (Bitboard b=capsL; b;){ int to = lsb(b); pop_lsb(b);
            int from = to - 7;
            int r = row_of(Square(to));
            if (r==7){
                out.emplace_back(from, to, MF_PROMO_Q);
                out.emplace_back(from, to, MF_PROMO_R);
                out.emplace_back(from, to, MF_PROMO_B);
                out.emplace_back(from, to, MF_PROMO_N);
            } else out.emplace_back(from, to, MF_CAPTURE);
        }
        for (Bitboard b=capsR; b;){ int to = lsb(b); pop_lsb(b);
            int from = to - 9; int r=row_of(Square(to));
            if (r==7){
                out.emplace_back(from, to, MF_PROMO_Q);
                out.emplace_back(from, to, MF_PROMO_R);
                out.emplace_back(from, to, MF_PROMO_B);
                out.emplace_back(from, to, MF_PROMO_N);
            } else out.emplace_back(from, to, MF_CAPTURE);
        }
        // en-passant
        if (ep_sq>=0){
            Bitboard ep = SQ(Square(ep_sq));
            Bitboard can = ((P & ~FILE_A) << 7) | ((P & ~FILE_H) << 9);
            if (can & ep){
                int to = ep_sq;
                int fromL = to - 7, fromR = to - 9;
                if ((P & SQ(Square(fromL))) && col_of(Square(to))==col_of(Square(fromL))+1)
                    out.emplace_back(fromL, to, MF_EP);
                if ((P & SQ(Square(fromR))) && col_of(Square(to))==col_of(Square(fromR))-1)
                    out.emplace_back(fromR, to, MF_EP);
            }
        }
    } else { // BLACK
       
         // Black
        Bitboard single = south(P) & ~occAll;
        Bitboard dbl    = south(single & RANK_6) & ~occAll;  // was RANK_7

        for (Bitboard b=single; b;){ int to = lsb(b); pop_lsb(b);
            int r = row_of(Square(to));
            if (r==0){
                out.emplace_back(to+8, to, MF_PROMO_Q);
                out.emplace_back(to+8, to, MF_PROMO_R);
                out.emplace_back(to+8, to, MF_PROMO_B);
                out.emplace_back(to+8, to, MF_PROMO_N);
            } else out.emplace_back(to+8, to, MF_QUIET);
        }
        for (Bitboard b=dbl; b;){ int to = lsb(b); pop_lsb(b);
            out.emplace_back(to+16, to, MF_QUIET);
        }
        Bitboard left  = (P & ~FILE_A) >> 9;
        Bitboard right = (P & ~FILE_H) >> 7;
        Bitboard capsL = left  & occThem;
        Bitboard capsR = right & occThem;
        for (Bitboard b=capsL; b;){ int to = lsb(b); pop_lsb(b);
            int from = to + 9; int r=row_of(Square(to));
            if (r==0){
                out.emplace_back(from, to, MF_PROMO_Q);
                out.emplace_back(from, to, MF_PROMO_R);
                out.emplace_back(from, to, MF_PROMO_B);
                out.emplace_back(from, to, MF_PROMO_N);
            } else out.emplace_back(from, to, MF_CAPTURE);
        }
        for (Bitboard b=capsR; b;){ int to = lsb(b); pop_lsb(b);
            int from = to + 7; int r=row_of(Square(to));
            if (r==0){
                out.emplace_back(from, to, MF_PROMO_Q);
                out.emplace_back(from, to, MF_PROMO_R);
                out.emplace_back(from, to, MF_PROMO_B);
                out.emplace_back(from, to, MF_PROMO_N);
            } else out.emplace_back(from, to, MF_CAPTURE);
        }
        if (ep_sq>=0){
            Bitboard ep = SQ(Square(ep_sq));
            Bitboard can = ((P & ~FILE_A) >> 9) | ((P & ~FILE_H) >> 7);
            if (can & ep){
                int to = ep_sq;
                int fromL = to + 9, fromR = to + 7;
                if ((P & SQ(Square(fromL))) && col_of(Square(to))==col_of(Square(fromL))-1)
                    out.emplace_back(fromL, to, MF_EP);
                if ((P & SQ(Square(fromR))) && col_of(Square(to))==col_of(Square(fromR))+1)
                    out.emplace_back(fromR, to, MF_EP);
            }
        }
    }

    // Knights
    for (Bitboard b = bb.pcs[ci(us)][KNIGHT]; b; ){
        Square from = Square(lsb(b)); pop_lsb(b);
        Bitboard moves = attacks_knight(from) & ~occUs;
        for (Bitboard m=moves; m; ){ Square to = Square(lsb(m)); pop_lsb(m);
            MoveFlag f = (bb.occ[ci(them)] & SQ(to)) ? MF_CAPTURE : MF_QUIET;
            out.emplace_back(from, to, f);
        }
    }

    // Bishops
    for (Bitboard b = bb.pcs[ci(us)][BISHOP]; b; ){
        Square from = Square(lsb(b)); pop_lsb(b);
        Bitboard moves = attacks_bishop(from, occAll) & ~occUs;
        for (Bitboard m=moves; m; ){ Square to = Square(lsb(m)); pop_lsb(m);
            MoveFlag f = (bb.occ[ci(them)] & SQ(to)) ? MF_CAPTURE : MF_QUIET;
            out.emplace_back(from, to, f);
        }
    }

    // Rooks
    for (Bitboard b = bb.pcs[ci(us)][ROOK]; b; ){
        Square from = Square(lsb(b)); pop_lsb(b);
        Bitboard moves = attacks_rook(from, occAll) & ~occUs;
        for (Bitboard m=moves; m; ){ Square to = Square(lsb(m)); pop_lsb(m);
            MoveFlag f = (bb.occ[ci(them)] & SQ(to)) ? MF_CAPTURE : MF_QUIET;
            out.emplace_back(from, to, f);
        }
    }

    // Queens
    for (Bitboard b = bb.pcs[ci(us)][QUEEN]; b; ){
        Square from = Square(lsb(b)); pop_lsb(b);
        Bitboard moves = (attacks_bishop(from, occAll)|attacks_rook(from, occAll)) & ~occUs;
        for (Bitboard m=moves; m; ){ Square to = Square(lsb(m)); pop_lsb(m);
            MoveFlag f = (bb.occ[ci(them)] & SQ(to)) ? MF_CAPTURE : MF_QUIET;
            out.emplace_back(from, to, f);
        }
    }

    // King + castling
    {
        Square from = king_square(us);
        Bitboard moves = attacks_king(from) & ~occUs;
        for (Bitboard m=moves; m; ){ Square to = Square(lsb(m)); pop_lsb(m);
            MoveFlag f = (bb.occ[ci(them)] & SQ(to)) ? MF_CAPTURE : MF_QUIET;
            out.emplace_back(from, to, f);
        }
        // Castling (basic: squares empty and not attacked)
        if (us==WHITE){
            if ((castling & CR_WK) && !(occAll & (SQ(F1)|SQ(G1))) &&
                !square_attacked(E1, them) && !square_attacked(F1, them) && !square_attacked(G1, them)){
                out.emplace_back(E1, G1, MF_CASTLE);
            }
            if ((castling & CR_WQ) && !(occAll & (SQ(D1)|SQ(C1)|SQ(B1))) &&
                !square_attacked(E1, them) && !square_attacked(D1, them) && !square_attacked(C1, them)){
                out.emplace_back(E1, C1, MF_CASTLE);
            }
        } else {
            if ((castling & CR_BK) && !(occAll & (SQ(F8)|SQ(G8))) &&
                !square_attacked(E8, them) && !square_attacked(F8, them) && !square_attacked(G8, them)){
                out.emplace_back(E8, G8, MF_CASTLE);
            }
            if ((castling & CR_BQ) && !(occAll & (SQ(D8)|SQ(C8)|SQ(B8))) &&
                !square_attacked(E8, them) && !square_attacked(D8, them) && !square_attacked(C8, them)){
                out.emplace_back(E8, C8, MF_CASTLE);
            }
        }
    }
}

// Filter by king safety
void BoardBB::generate_legal_moves(std::vector<Move>& out){
    std::vector<Move> tmp;
    generate_moves(tmp);
    out.clear();
    for (auto m : tmp){
        do_move(m);
        bool ok = !square_attacked(king_square(other(side)), side); // after do_move, side is opponent
        undo_move();
        if (ok) out.push_back(m);
    }
}

} // namespace chess
