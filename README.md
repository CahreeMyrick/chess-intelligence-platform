 Chess Engine (UCI)

A small C++ chess engine with:

- a playable game model (`Game`, `Board`, `Piece`, …)  
- a simple minimax search (`MinimaxStrategy`)  
- a UCI front-end (`chess_uci`)  
- a perft tool for correctness/benchmarks (`chess_perft`)  
- optional tests (`chess_tests`)  

Built with **CMake** and **C++20**.

---

## Project Layout

chess/
├─ CMakeLists.txt
├─ include/
│ └─ chess/… # headers (types, piece, board, game, strategy, eval)
├─ src/
│ ├─ piece.cpp
│ ├─ board.cpp
│ ├─ game.cpp
│ ├─ strategy_minimax.cpp
│ ├─ eval.cpp
│ └─ main.cpp # CLI (menu) -> target: chess_app
└─ tools/
├─ perft.cpp # perft driver -> target: chess_perft
├─ uci_main.cpp # UCI main -> target: chess_uci
└─ test_chess.cpp # basic tests -> target: chess_tests (optional)

yaml
Copy code

> `uci_main.cpp` and `test_chess.cpp` share the core engine. Where needed, they `#define CHESS_NO_MAIN` before including the engine TU to avoid duplicate `main()`.

---

## Build (CMake)

**Configure (Release for fair perf)**
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
Build all targets

cmake --build build -j
(Optional) Enable LTO/IPO — add to your top-level CMakeLists.txt:

cmake
Copy code
include(CheckIPOSupported)
check_ipo_supported(RESULT HAVE_IPO OUTPUT IPO_ERR)
if(HAVE_IPO)
  message(STATUS "IPO/LTO enabled")
  set(CMAKE_INTERPROCEDURAL_OPTIMIZATION ON)
endif()
Tip (switching compilers):

bash
Copy code
rm -rf build && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
Common flags: -O3 -DNDEBUG -march=native -fno-omit-frame-pointer

Run
Executables appear under build/ (or your generator’s bin dir).

CLI game

bash
Copy code
./build/chess_app
Perft (prints nodes/time/NPS; exits non-zero on mismatch)

bash
Copy code
./build/chess_perft
UCI engine (terminal or GUI)

./build/chess_uci
Example UCI session:

uci
id name MyEngine
id author You
uciok
isready
readyok
ucinewgame
position startpos moves e2e4 e7e5 g1f3
go depth 3
bestmove g1f3
Move Formats
External (UCI): e2e4, e7e8q, …

Internal (engine): two digit pairs "rc rc" where r,c ∈ {0..7}.
Example: "14 34" means (r=1,c=4) → (r=3,c=4) i.e., e2 → e4.

The UCI layer converts between formats.

Correctness (Perft Baselines)
Standard reference counts used to validate move generation:

startpos: d1 = 20, d2 = 400, d3 = 8,902, d4 = 197,281

kiwipete: d1 = 48, d2 = 2,039, d3 = 97,862, d4 = 4,085,603

chess_perft compares against these (raise depths locally if desired).

Benchmarks (example)
Performance varies with CPU/OS/compiler/flags. Run:

bash
Copy code
./build/chess_perft
Example output:

pgsql
Copy code
startpos d=1   nodes=20        time=0.290 ms    ( 68,916 nps)
startpos d=2   nodes=400       time=6.751 ms    ( 59,252 nps)
startpos d=3   nodes=8,902     time=73.518 ms   (121,085 nps)
startpos d=4   nodes=197,281   time=1,292.92 ms (152,586 nps)

kiwipete d=1   nodes=48        time=0.285 ms    (168,667 nps)
kiwipete d=2   nodes=2,039     time=12.590 ms   (161,955 nps)
kiwipete d=3   nodes=97,862    time=526.267 ms  (185,954 nps)
kiwipete d=4   nodes=4,085,603 time=24,281.2 ms (168,262 nps)
When sharing numbers, include:

Compiler: e.g., Clang/GCC version

Build type: Release (+ LTO on/off)

Flags: -O3 -DNDEBUG -march=native

CPU/RAM/OS: e.g., Apple M3 / 16 GB / macOS 15.x

Threads: 1 (single-threaded baseline)
