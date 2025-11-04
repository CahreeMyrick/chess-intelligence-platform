cmake_minimum_required(VERSION 3.20)
project(chesscpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---- Library ----
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

# Speed flags (tweak to taste)
if (CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(chess PRIVATE -O3 -DNDEBUG -march=native)
endif()

# ---- Tools / Apps ----
add_executable(chess_app src/main.cpp)
target_link_libraries(chess_app PRIVATE chess)

add_executable(chess_perft tools/perft.cpp)
target_link_libraries(chess_perft PRIVATE chess)

add_executable(chess_perft_bb tools/perft_bb.cpp)
target_link_libraries(chess_perft_bb PRIVATE chess)

# UCI (classical)
add_executable(chess_uci tools/uci_main.cpp)
target_link_libraries(chess_uci PRIVATE chess)

# UCI (bitboards)  <-- this is the one you’ll run in prod
add_executable(chess_uci_bb tools/uci_bb_main.cpp)
target_link_libraries(chess_uci_bb PRIVATE chess)

# ---- Tests (optional) ----
option(BUILD_TESTS "Build unit tests" OFF)
if (BUILD_TESTS AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_chess.cpp")
  add_executable(chess_tests tests/test_chess.cpp)
  target_link_libraries(chess_tests PRIVATE chess)
  # enable_testing()
  # add_test(NAME chess_unit_tests COMMAND chess_tests)
endif()
