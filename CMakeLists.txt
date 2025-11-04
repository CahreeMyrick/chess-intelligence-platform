cmake_minimum_required(VERSION 3.20)
project(chesscpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(chess
    src/piece.cpp
    src/board.cpp
    src/game.cpp
    src/strategy_minimax.cpp
    src/eval.cpp
    src/attacks.cpp
    src/board_bb.cpp
    src/search_bb.cpp  
)
target_include_directories(chess PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
# Speed flags (adjust for your toolchain)
if (CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(chess PRIVATE -O3 -DNDEBUG -march=native)
endif()

add_executable(chess_app src/main.cpp)
target_link_libraries(chess_app PRIVATE chess)

# --- perft tool
add_executable(chess_perft tools/perft.cpp)
add_executable(chess_perft_bb tools/perft_bb.cpp)

target_link_libraries(chess_perft PRIVATE chess)
target_link_libraries(chess_perft_bb PRIVATE chess)

# --- UCI engine
add_executable(chess_uci tools/uci_main.cpp)
target_link_libraries(chess_uci PRIVATE chess)
# --- Bitboard UCI engine
add_executable(chess_uci_bb tools/uci_bb_main.cpp)
target_link_libraries(chess_uci_bb PRIVATE chess)
# --- Unit tests (simple)
add_executable(chess_tests tests/test_chess.cpp)
target_link_libraries(chess_tests PRIVATE chess)

# (Optional) If using CTest:
# enable_testing()
# add_test(NAME chess_unit_tests COMMAND chess_tests)
