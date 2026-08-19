#pragma once
#include <cstdint>

namespace chess {

enum MoveFlag : uint8_t {
    MF_QUIET=0, MF_CAPTURE=1, MF_EP=2, MF_CASTLE=3,
    MF_PROMO_N=4, MF_PROMO_B=5, MF_PROMO_R=6, MF_PROMO_Q=7
};

// 32-bit packed move: [ .. | promo(3) | flag(3) | to(6) | from(6) ]
struct Move {
    uint32_t v{0};
    Move() = default;
    Move(uint8_t from, uint8_t to, uint8_t flag, uint8_t promo=0)
      : v( (from) | (uint32_t(to)<<6) | (uint32_t(flag)<<12) | (uint32_t(promo)<<15) ) {}

    uint8_t from()  const { return  v        & 63; }
    uint8_t to()    const { return (v >> 6)  & 63; }
    uint8_t flag()  const { return (v >> 12) &  7; }
    uint8_t promo() const { return (v >> 15) &  7; }
    bool is_capture() const { return flag()==MF_CAPTURE || flag()==MF_EP; }
};

} // namespace chess
