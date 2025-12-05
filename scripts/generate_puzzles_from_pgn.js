#!/usr/bin/env node
// scripts/generate_puzzles_from_pgn.js

// Generate engine-evaluated puzzles from a PGN file and insert into the
// `puzzles` table in DATA_DIR/app.db (same DB as server.js).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Database = require("better-sqlite3");

const chessjs = require("chess.js");
const Chess = typeof chessjs === "function" ? chessjs : chessjs.Chess;

// --- config ---
const ROOT_DIR   = path.join(__dirname, "..");
const DATA_DIR   = process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const DB_PATH    = path.join(DATA_DIR, "app.db");
const ENGINE_PATH = process.env.ENGINE_PATH || path.join(ROOT_DIR, "build", "chess_uci_bb");

// Per-position analysis time (tune later)
const SEARCH_TIME_MS = Number(process.env.PUZZLE_MOVETIME_MS || 400);

// How many puzzles max per game (safety)
const MAX_PUZZLES_PER_GAME = Number(process.env.MAX_PUZZLES_PER_GAME || 8);

// --- ensure data dir exists ---
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- DB setup ---
const DB = new Database(DB_PATH);
DB.pragma("journal_mode = WAL");
DB.exec(`
CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY,
  fen TEXT NOT NULL,
  side_to_move TEXT NOT NULL,
  solution_moves TEXT NOT NULL,
  pre_eval_cp INTEGER NOT NULL,
  best_eval_cp INTEGER NOT NULL,
  played_eval_cp INTEGER NOT NULL,
  eval_gap_cp INTEGER NOT NULL,
  heuristic_difficulty REAL NOT NULL,
  is_mate INTEGER NOT NULL DEFAULT 0,
  source_game TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const insertPuzzle = DB.prepare(`
  INSERT INTO puzzles (
    fen, side_to_move, solution_moves,
    pre_eval_cp, best_eval_cp, played_eval_cp, eval_gap_cp,
    heuristic_difficulty, is_mate, source_game
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
function startEngine() {
  console.log("[engine] spawning:", ENGINE_PATH);
  const proc = spawn(ENGINE_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });

  proc.on("error", (err) => console.error("[engine] spawn error:", err));
  proc.on("exit", (code, sig) => console.error(`[engine] exited (code=${code} sig=${sig})`));

  function uciExchange(lines, untilRegex) {
    return new Promise((resolve) => {
      let buf = "";
      const onData = (d) => {
        buf += d.toString();
        if (untilRegex.test(buf)) {
          proc.stdout.off("data", onData);
          resolve(buf);
        }
      };
      proc.stdout.on("data", onData);
      proc.stdin.write(lines.join("\n") + "\n");
    });
  }

  // init Stockfish with UCI
  const ready = (async () => {
    await uciExchange(["uci"], /uciok/);
    await uciExchange(["isready"], /readyok/);
    console.log("[engine] ready");
  })();

  async function analyzeFen(fen, { movetimeMs = SEARCH_TIME_MS } = {}) {
    await ready;

    const pos   = `position fen ${fen}`;
    const goCmd = `go movetime ${movetimeMs}`;

    let buf = "";
    const until = /bestmove\s+\S+/;

    await new Promise((resolve) => {
      const onData = (d) => {
        buf += d.toString();
        if (until.test(buf)) {
          proc.stdout.off("data", onData);
          resolve();
        }
      };
      proc.stdout.on("data", onData);
      proc.stdin.write([pos, "isready", goCmd].join("\n") + "\n");
    });

    // parse bestmove + eval from buf
    let bestmove = null;
    let scoreCp  = null;
    let mateIn   = null;

    const lines = buf.split(/\r?\n/);
    const infos = lines.filter((l) => l.startsWith("info "));

    if (infos.length) {
      const last = infos[infos.length - 1];
      const parts = last.trim().split(/\s+/);
      const idx = parts.indexOf("score");
      if (idx !== -1 && idx + 2 < parts.length) {
        const type = parts[idx + 1];
        const val  = parseInt(parts[idx + 2], 10);
        if (type === "cp") {
          scoreCp = val;
        } else if (type === "mate") {
          mateIn  = val;
          scoreCp = mateIn > 0 ? 100000 : -100000;
        }
      }
    }

    const m = buf.match(/bestmove\s+(\S+)/);
    if (m) bestmove = m[1];

    return { bestmove, scoreCp, mateIn };
  }

  function stop() {
    try { proc.stdin.write("quit\n"); } catch {}
  }

  return { analyzeFen, stop };
}


// --- FEN helpers (reuse chess.js) ---
function fenAfterUciMove(fen, uci) {
  const game = new Chess(fen);
  const from = uci.slice(0, 2);
  const to   = uci.slice(2, 4);
  const promotion = uci[4] || undefined;
  const ok = game.move({ from, to, promotion });
  if (!ok) throw new Error(`Illegal move ${uci} on fen ${fen}`);
  return game.fen();
}

// --- heuristics + difficulty ---
function isPuzzleCandidate(preEval, bestEval, playedEval, gapCp) {
  // all evals are normalized from the POV of side_to_move at the puzzle start
  if (preEval == null || bestEval == null || playedEval == null) return false;

  // position should be roughly equal at start
  if (Math.abs(preEval) > 70) return false;

  // best move should give clear improvement (winning material / etc)
  if (bestEval < 150) return false;

  // played move shouldn't also be great
  if (playedEval > 30) return false;

  // and we want a significant swing between best vs played
  if (gapCp < 120) return false;

  return true;
}

function computeDifficulty({ bestEval, gapCp, mateIn, solutionLength }) {
  let diff = 1000;

  if (mateIn != null && mateIn > 0) diff += 400;       // "mate in N" feels harder
  if (solutionLength >= 4)          diff += 200;       // longer line
  if (gapCp >= 300)                 diff += 150;       // big punishment if you miss
  if (bestEval >= 400 && bestEval <= 800) diff += 50;  // win piece / big edge
  if (bestEval > 800)               diff += 100;       // completely winning

  return diff;
}

// --- PGN splitting: naive but works for typical files ---
function splitPgnGames(text) {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  // We split on blank line followed by [Event
  const parts = trimmed.split(/\n\n(?=\[Event )/g);
  return parts.map(s => s.trim()).filter(Boolean);
}

// --- Process a single game (PGN string) ---
async function processGame(engine, pgnText, gameLabel) {
  const loader = new Chess();
  // compat: supports loadPgn or load_pgn
  let ok = false;
  if (typeof loader.loadPgn === "function") {
    try { loader.loadPgn(pgnText, { sloppy: true }); ok = true; } catch {}
  }
  if (!ok && typeof loader.load_pgn === "function") {
    try { ok = loader.load_pgn(pgnText, { sloppy: true }); } catch {}
  }
  if (!ok) {
    console.warn("[game] failed to load PGN");
    return 0;
  }

  const verboseMoves = loader.history({ verbose: true });
  const replay = new Chess();
  let puzzlesThisGame = 0;

  for (let i = 0; i < verboseMoves.length; i++) {
    if (puzzlesThisGame >= MAX_PUZZLES_PER_GAME) break;

    const moveObj = verboseMoves[i];
    const fenBefore = replay.fen();
    const sideToMove = replay.turn(); // 'w' or 'b'
    const sign = sideToMove === 'w' ? 1 : -1;

    const uciPlayed =
      moveObj.from +
      moveObj.to +
      (moveObj.promotion ? moveObj.promotion : "");

    // 1) Evaluate position before the move
    let preRaw = null, bestRaw = null, playedRaw = null;
    let bestMove = null;
    let mateIn = null;

    try {
      const before = await engine.analyzeFen(fenBefore);
      preRaw   = before.scoreCp;
      bestMove = before.bestmove;
    } catch (e) {
      console.warn("[analyze] failed pre:", e.message);
      replay.move(moveObj);
      continue;
    }

    if (!bestMove) {
      replay.move(moveObj);
      continue;
    }

    // 2) Eval after best engine move
    try {
      const fenAfterBest = fenAfterUciMove(fenBefore, bestMove);
      const best = await engine.analyzeFen(fenAfterBest);
      bestRaw = best.scoreCp;
      mateIn  = best.mateIn;
    } catch (e) {
      console.warn("[analyze] failed best:", e.message);
    }

    // 3) Eval after played game move
    try {
      const fenAfterPlayed = fenAfterUciMove(fenBefore, uciPlayed);
      const played = await engine.analyzeFen(fenAfterPlayed);
      playedRaw = played.scoreCp;
    } catch (e) {
      console.warn("[analyze] failed played:", e.message);
      replay.move(moveObj);
      continue;
    }

    // Normalize evals to POV of side_to_move at fenBefore:
    const preEval    = preRaw    != null ? preRaw    * sign : null;
    const bestEval   = bestRaw   != null ? bestRaw   * sign : null;
    const playedEval = playedRaw != null ? playedRaw * sign : null;
    const gapCp      = (bestEval ?? 0) - (playedEval ?? 0);


// TEMP: very permissive – treat any move where the engine disagrees
// with the played move by at least 50 centipawns as a puzzle.
    const engineDiffers = bestMove && bestMove.toLowerCase() !== uciPlayed.toLowerCase();
    const bigEnoughGap  = gapCp >= 50;  // you can tweak this number

    if (engineDiffers && bigEnoughGap) {
      const solutionMoves = [bestMove.toLowerCase()];

      const difficulty = computeDifficulty({
        bestEval,
        gapCp,
        mateIn,
        solutionLength: solutionMoves.length,
      });

      const src = `${gameLabel}#ply${i+1}`;

      console.log(
        `[puzzle] ${src} | side=${sideToMove} pre=${preEval} best=${bestEval} played=${playedEval} gap=${gapCp}`
      );

      try {
        insertPuzzle.run(
          fenBefore,
          sideToMove,
          JSON.stringify(solutionMoves),
          Math.round(preEval),
          Math.round(bestEval),
          Math.round(playedEval),
          Math.round(gapCp),
          difficulty,
          mateIn != null ? 1 : 0,
          src
        );
        puzzlesThisGame++;
      } catch (e) {
        console.error("[DB] insert puzzle failed:", e.message);
      }
    }

    /*
    if (isPuzzleCandidate(preEval, bestEval, playedEval, gapCp)) {
      // For now, keep solution as just the engine best move: "find the tactic"
      const solutionMoves = [bestMove.toLowerCase()];

      const difficulty = computeDifficulty({
        bestEval,
        gapCp,
        mateIn,
        solutionLength: solutionMoves.length,
      });

      const src = `${gameLabel}#ply${i+1}`;

      console.log(
        `[puzzle] ${src} | side=${sideToMove} pre=${preEval} best=${bestEval} played=${playedEval} gap=${gapCp}`
      );

      try {
        insertPuzzle.run(
          fenBefore,
          sideToMove,
          JSON.stringify(solutionMoves),
          Math.round(preEval),
          Math.round(bestEval),
          Math.round(playedEval),
          Math.round(gapCp),
          difficulty,
          mateIn != null ? 1 : 0,
          src
        );
        puzzlesThisGame++;
      } catch (e) {
        console.error("[DB] insert puzzle failed:", e.message);
      }
    }*/



    // finally, advance the replay
    replay.move(moveObj);
  }

  return puzzlesThisGame;
}

// --- main ---
async function main() {
  const pgnPath = process.argv[2];
  if (!pgnPath) {
    console.error("Usage: node scripts/generate_puzzles_from_pgn.js /path/to/games.pgn");
    process.exit(1);
  }

  if (!fs.existsSync(pgnPath)) {
    console.error("PGN file not found:", pgnPath);
    process.exit(1);
  }

  const text = fs.readFileSync(pgnPath, "utf8");
  const games = splitPgnGames(text);
  if (!games.length) {
    console.error("No games found in PGN file");
    process.exit(1);
  }

  console.log(`[init] DB at ${DB_PATH}`);
  console.log(`[init] PGN file: ${pgnPath} (${games.length} games)`);

  const engine = startEngine();

  let totalPuzzles = 0;
  for (let i = 0; i < games.length; i++) {
    const label = `${path.basename(pgnPath)}#${i}`;
    console.log(`\n[game] ${i+1}/${games.length} (${label})`);
    try {
      const n = await processGame(engine, games[i], label);
      totalPuzzles += n;
      console.log(`[game] -> ${n} puzzles`);
    } catch (e) {
      console.error("[game] error:", e);
    }
  }

  engine.stop();
  console.log(`\n[done] total puzzles inserted: ${totalPuzzles}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
