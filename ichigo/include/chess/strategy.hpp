#pragma once
#include <string>

namespace chess {

class Game;

struct Strategy {
    virtual ~Strategy() = default;
    virtual std::string select_move(const Game& g) = 0;
};

struct MinimaxStrategy : Strategy {
    int max_depth = 3;
    int search(Game& pos, int depth, int alpha, int beta);
    std::string select_move(const Game& g0) override;
};

} // namespace chess
