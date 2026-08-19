#pragma once
#include <string>

namespace chess {

enum class Color { White, Black, None };

inline const char* to_cstr(Color c) {
    switch (c) { case Color::White: return "white"; case Color::Black: return "black"; default: return "none"; }
}
inline Color other(Color c) {
    return c==Color::White ? Color::Black : (c==Color::Black ? Color::White : Color::None);
}

constexpr int ROWS = 8, COLS = 8;

} // namespace chess
