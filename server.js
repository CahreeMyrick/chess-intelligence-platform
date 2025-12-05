// ---- imports ----
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");



const chessjs = require("chess.js");
// Works with both old and new chess.js builds
const Chess = typeof chessjs === "function" ? chessjs : chessjs.Chess;

let BOOK = {};
try { BOOK = require("./book"); } catch { BOOK = {}; } // optional book
const Database = require("better-sqlite3");

// ---- config ----
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const DEFAULT_SITE = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Separate engines:
// - PLAY_ENGINE_PATH : Ichigo (for playing games)
// - ANALYSIS_ENGINE_PATH : Stockfish (for evals / puzzles)
const PLAY_ENGINE_PATH =
  process.env.PLAY_ENGINE_PATH ||
  path.join(__dirname, "build", "chess_uci_bb");  // your Ichigo binary

// Default ANALYSIS_ENGINE_PATH to PLAY_ENGINE_PATH if not set
const ANALYSIS_ENGINE_PATH =
  process.env.ANALYSIS_ENGINE_PATH ||
  process.env.STOCKFISH_PATH ||    // optional alias
  PLAY_ENGINE_PATH;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");


/*
// ---- DB init ----
const DB = new Database(path.join(DATA_DIR, "app.db"));
DB.pragma("journal_mode = WAL");
DB.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  result TEXT DEFAULT '*',
  moves TEXT DEFAULT '',
  pgn   TEXT,
  time_control TEXT DEFAULT '5+0'
);
`);
*/

// ---- DB init ----
const DB = new Database(path.join(DATA_DIR, "app.db"));
DB.pragma("journal_mode = WAL");
DB.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  result TEXT DEFAULT '*',
  moves TEXT DEFAULT '',
  pgn   TEXT,
  time_control TEXT DEFAULT '5+0'
);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY,
  fen TEXT NOT NULL,
  side_to_move TEXT NOT NULL,           -- 'w' or 'b'
  solution_moves TEXT NOT NULL,         -- JSON array of UCI moves
  pre_eval_cp INTEGER NOT NULL,         -- eval before best move (centipawns)
  best_eval_cp INTEGER NOT NULL,        -- eval after best move
  played_eval_cp INTEGER NOT NULL,      -- eval after played move in original game
  eval_gap_cp INTEGER NOT NULL,         -- best_eval_cp - played_eval_cp
  heuristic_difficulty REAL NOT NULL,   -- your handcrafted difficulty score
  is_mate INTEGER NOT NULL DEFAULT 0,   -- 1 if engine reports mate line
  source_game TEXT,                     -- e.g. "selfplay-001#23" or PGN tag
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function gameById(id){
  return DB.prepare(`SELECT id, created_at, result, moves, pgn, time_control
                     FROM games WHERE id=?`).get(id);
}


const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// ---- app bootstrap ----
const app = express();

// IMPORTANT: behind a proxy (Fly/Render) so trust it for correct req.ip
app.set("trust proxy", 1);

// Basic hardening + parsers
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Optional: force-HTTPS behind proxy (uncomment if you want redirects)
// app.use((req, res, next) => {
//   if (req.get("x-forwarded-proto") === "http") {
//     return res.redirect(301, "https://" + req.hostname + req.originalUrl);
//   }
//   next();
// });

// ---- engine processes ----
// Play engine: Ichigo
const playEngine = spawn(PLAY_ENGINE_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });
playEngine.on("error", (err) => console.error("[play-engine] spawn error:", err));
playEngine.on("exit", (code, sig) => console.error(`[play-engine] exited (code=${code} sig=${sig})`));

// Analysis engine: Stockfish (or fallback to Ichigo)
const analysisEngine = spawn(ANALYSIS_ENGINE_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });
analysisEngine.on("error", (err) => console.error("[analysis-engine] spawn error:", err));
analysisEngine.on("exit", (code, sig) => console.error(`[analysis-engine] exited (code=${code} sig=${sig})`));

// helper: run a small UCI exchange and wait for a pattern on a given engine
function uciExchange(engineProc, lines, untilRegex) {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      if (untilRegex.test(buf)) {
        engineProc.stdout.off("data", onData);
        resolve(buf);
      }
    };
    engineProc.stdout.on("data", onData);
    engineProc.stdin.write(lines.join("\n") + "\n");
  });
}

// ---- Engine eval helper: get cp & bestmove for a FEN ----
async function evalPositionCp(fen, movetimeMs = 80) {
  const lines = [
    `position fen ${fen}`,
    "isready",
    `go movetime ${movetimeMs}`,
  ];
  const until = /bestmove\s+\S+/;

  const buf = await uciExchange(analysisEngine, lines, until);

  const infos = buf.split(/\r?\n/).filter((l) => l.startsWith("info "));
  let evalCp = null;
  let evalMate = null;
  let bestmove = null;

  if (infos.length) {
    const last = infos[infos.length - 1];
    const takeNum = (re) => {
      const m = last.match(re);
      return m ? Number(m[1]) : null;
    };

    evalMate = takeNum(/\bscore\s+mate\s+(-?\d+)/);
    evalCp   = takeNum(/\bscore\s+cp\s+(-?\d+)/);
  }

  const m = buf.match(/bestmove\s+(\S+)/);
  if (m) bestmove = m[1];

  return { evalCp, evalMate, bestmove };
}


// ---- Python RF scorer helper ----
async function scorePuzzlesWithPython(puzzles) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "scripts", "score_puzzles_ad_hoc.py");

    const proc = spawn("python", [scriptPath], {
      stdio: ["pipe", "pipe", "inherit"], // stdin, stdout, stderr->server stderr
    });

    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });

    proc.on("error", (err) => reject(err));

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`score_puzzles_ad_hoc.py exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(out);
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });

    proc.stdin.write(JSON.stringify(puzzles));
    proc.stdin.end();
  });
}


// init engines once at startup
(async () => {
  try {
    await uciExchange(playEngine, ["uci"], /uciok/);
    await uciExchange(playEngine, ["isready"], /readyok/);
    console.log("Play engine ready.");
  } catch (e) {
    console.error("Play engine failed to initialize:", e);
  }

  try {
    await uciExchange(analysisEngine, ["uci"], /uciok/);
    await uciExchange(analysisEngine, ["isready"], /readyok/);
    console.log("Analysis engine ready.");
  } catch (e) {
    console.error("Analysis engine failed to initialize:", e);
  }
})();

 

// ---- health ----
app.get("/ping", (_req, res) => res.type("text").send("pong"));

app.get("/healthz", async (_req, res) => {
  try {
    let gotReady = false;
    const onData = (d) => { if (d.toString().includes("readyok")) gotReady = true; };
    engine.stdout.on("data", onData);
    engine.stdin.write("isready\n");
    setTimeout(() => {
      engine.stdout.off("data", onData);
      res.status(gotReady ? 200 : 500).json({ ok: !!gotReady });
    }, 800);
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

// ---- rate limit for engine endpoint ----
// Configure AFTER trust proxy so req.ip is correct
const bestmoveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});
app.use("/bestmove", bestmoveLimiter);

// ---- opening book ----
app.post("/bookmove", (req, res) => {
  try {
    const { moves = [] } = req.body || {};
    if (!Array.isArray(moves)) return res.json({ bookmove: null });
    const key = moves.join(" ").trim();
    const mv = BOOK[key] || null;
    res.json({ bookmove: mv });
  } catch {
    res.json({ bookmove: null });
  }
});

// ---- /bestmove (validated input formatting) ----
app.post("/bestmove", async (req, res) => {
  try {
    let { fen = null, moves = [], movetimeMs = 500, depth = null, wtime, btime, winc, binc } = req.body;

    // validation
    if (fen != null && typeof fen !== "string") fen = null;
    if (!Array.isArray(moves)) moves = [];
    moves = moves
      .filter((m) => typeof m === "string")
      .map((m) => m.trim().toLowerCase())
      .filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))
      .slice(0, 512);

    if (depth != null) {
      depth = Number(depth);
      if (!Number.isFinite(depth) || depth < 1) depth = null;
      if (depth != null) depth = Math.min(depth, 24);
    }

    movetimeMs = Number(movetimeMs);
    if (!Number.isFinite(movetimeMs) || movetimeMs < 50) movetimeMs = 50;
    movetimeMs = Math.min(movetimeMs, 5000);

    const clockArgs = [];
    const asInt = (x) => Number.isFinite(Number(x)) ? Math.max(0, Math.floor(Number(x))) : null;
    wtime = asInt(wtime); btime = asInt(btime); winc = asInt(winc); binc = asInt(binc);
    if (wtime != null) clockArgs.push(`wtime ${wtime}`);
    if (btime != null) clockArgs.push(`btime ${btime}`);
    if (winc  != null) clockArgs.push(`winc ${winc}`);
    if (binc  != null) clockArgs.push(`binc ${binc}`);

    const pos = fen
      ? `position fen ${fen}${moves.length ? " moves " + moves.join(" ") : ""}`
      : `position startpos${moves.length ? " moves " + moves.join(" ") : ""}`;

    const goParts = ["go"];
    if (depth != null) goParts.push("depth", String(depth));
    else goParts.push("movetime", String(movetimeMs));
    if (clockArgs.length) goParts.push(...clockArgs);
    const goCmd = goParts.join(" ");

    let buf = "";
    const until = /bestmove\s+\S+/;
    const t0 = Date.now();

    const parseStats = () => {
      const infos = buf.split(/\r?\n/).filter((l) => l.startsWith("info "));
      let depthV=null, npsV=null, evalCp=null, evalMate=null, pv=null, nodes=null, tbhits=null;
      if (infos.length) {
        const last = infos[infos.length - 1];
        const take = (re) => (last.match(re) || [])[1];
        if (take(/\bdepth\s+(\d+)/)) depthV = +take(/\bdepth\s+(\d+)/);
        if (take(/\bnps\s+(\d+)/))   npsV   = +take(/\bnps\s+(\d+)/);
        if (take(/\bnodes\s+(\d+)/)) nodes  = +take(/\bnodes\s+(\d+)/);
        if (take(/\btbhits\s+(\d+)/)) tbhits= +take(/\btbhits\s+(\d+)/);
        if (take(/\bscore\s+mate\s+(-?\d+)/)) evalMate = +take(/\bscore\s+mate\s+(-?\d+)/);
        if (take(/\bscore\s+cp\s+(-?\d+)/))   evalCp   = +take(/\bscore\s+cp\s+(-?\d+)/);
        const pvM = last.match(/\bpv\s+(.+)/); if (pvM) pv = pvM[1];
      }
      return { depth:depthV, nps:npsV, nodes, tbhits, evalCp, evalMate, pv, elapsedMs: Date.now() - t0 };
    };

    await new Promise((resolve) => {
    const onData = (d) => {
      buf += d.toString();
      if (until.test(buf)) {
        playEngine.stdout.off("data", onData);
        resolve();
      }
    };
    playEngine.stdout.on("data", onData);
    playEngine.stdin.write([pos, "isready", goCmd].join("\n") + "\n");
  });


    const m = buf.match(/bestmove\s+(\S+)/);
    const stats = parseStats();
    res.json({ bestmove: m ? m[1] : null, stats, raw: buf });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "engine error" });
  }
});

// ---- PGN helpers & routes ----
function uciListToPgn({ movesUci = [], headers = {}, result = "*" }) {
  const game = new Chess(); // startpos
  for (const uci of movesUci) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promotion = uci[4] || undefined;
    const ok = game.move({ from, to, promotion });
    if (!ok) break;
  }
  const defaults = {
    Event: headers.Event || "Casual Game",
    Site:  headers.Site  || DEFAULT_SITE,
    Date:  headers.Date  || new Date().toISOString().slice(0, 10),
    Round: headers.Round || "1",
    White: headers.White || "White",
    Black: headers.Black || "Black",
    Result: result || "*",
    TimeControl: headers.TimeControl || "300+0",
  };
  for (const [k, v] of Object.entries(defaults)) game.header(k, String(v));
  return game.pgn({ maxWidth: 80, newline: "\n" });
}

function puzzleRowToJson(row) {
  let moves;
  try {
    moves = JSON.parse(row.solution_moves || "[]");
  } catch {
    moves = [];
  }

  const themes = [
    "engine-generated",
    row.is_mate ? "mate" : "tactic",
  ];
  if (row.source_game) themes.push("from-self-play");

  return {
    id: row.id,
    fen: row.fen,
    moves,                                  // UCI array – what puzzles.html expects
    rating: row.heuristic_difficulty ? Math.round(row.heuristic_difficulty) : null,
    themes,
  };
}



app.post("/pgn", (req, res) => {
  try {
    const { moves = [], headers = {}, result = "*" } = req.body || {};
    const movesUci = Array.isArray(moves)
      ? moves
          .filter((m) => typeof m === "string")
          .map((m) => m.trim().toLowerCase())
          .filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))
      : [];
    const pgn = uciListToPgn({ movesUci, headers, result });
    res.json({ pgn });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "PGN generation failed" });
  }
});

app.get("/pgn/download", (req, res) => {
  try {
    const movesUci = (req.query.moves || "").split(",").filter(Boolean);
    const headers = {
      White: req.query.white,
      Black: req.query.black,
      Event: req.query.event,
      TimeControl: req.query.tc,
    };
    const pgn = uciListToPgn({ movesUci, headers, result: req.query.result || "*" });
    res.setHeader("Content-Disposition", 'attachment; filename="game.pgn"');
    res.type("text/plain").send(pgn);
  } catch (e) {
    console.error(e);
    res.status(500).send("PGN generation failed");
  }
});

// ---- legality: rebuild helper ----
function gameFromMoves(movesUci) {
  const g = new Chess(); // startpos
  for (const u of movesUci) {
    const from = u.slice(0,2), to = u.slice(2,4);
    const promotion = u[4] || undefined;
    if (!g.move({ from, to, promotion })) return null; // illegal history
  }
  return g;
}


// ---- SQLite-backed game routes ----
app.post("/game/new", (req, res) => {
  const { time_control = "5+0" } = req.body || {};
  const info = DB.prepare("INSERT INTO games (time_control) VALUES (?)").run(time_control);
  res.json({ gameId: info.lastInsertRowid });
});

function api(g, nameNew, nameOld) {
  return typeof g[nameNew] === "function" ? g[nameNew].bind(g)
       : typeof g[nameOld] === "function" ? g[nameOld].bind(g)
       : () => false;
}


// --- helpers for Chess.com daily PGN ---
function extractSANFromPGN(pgnRaw = "") {
  // Remove PGN tag pairs like [FEN "..."], keep only the move text
  const text = String(pgnRaw).replace(/\r\n/g, "\n");
  const body = text
    .split("\n")
    .filter(line => !/^\s*\[.*\]\s*$/.test(line)) // drop [Tag "..."]
    .join(" ");

  // Remove move numbers ("1." or "1..."), results, and extra spaces
  return body
    .replace(/\d+\.(\.\.)?/g, " ")                    // 1. 1...
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ")      // results / *
    .replace(/\s*\{[^}]*\}\s*/g, " ")                 // comments {...}
    .replace(/\s+/g, " ")                             // collapse spaces
    .trim();
}

function sanToUciArray(fen, sanString) {
  const game = new Chess(fen);            // start from puzzle FEN
  const tokens = String(sanString || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const uci = [];
  for (const san of tokens) {
    const m = game.move(san, { sloppy: true }); // accepts Kd7, Bxb6+, e8=Q, O-O, etc.
    if (!m) throw new Error(`SAN could not be applied: "${san}"`);
    uci.push(m.from + m.to + (m.promotion ? m.promotion : ""));
  }
  return uci;
}


// --- Chess.com daily puzzle (PGN-aware, with fallback) ---
app.get("/puzzles/daily", async (_req, res) => {
  const fallback = {
    id: "fallback-queen-mate",
    source: "fallback",
    fen: "7k/5Q2/7K/8/8/8/8/8 w - - 0 1",
    moves: ["f7g7"], // Qg7#
    rating: 1200,
    themes: ["mateIn1","basic"],
  };

  const fetchJson = async (url, { timeoutMs = 5000 } = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Ichigo/1.0",
          "Accept": "application/json"
        },
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const j = await fetchJson("https://api.chess.com/pub/puzzle").catch(err => {
      console.error("[/puzzles/daily] chess.com fetch failed:", err);
      return null;
    });
    if (!j) return res.json(fallback);

    // Your sample:
    // { title,url,publish_time,fen,pgn:"[...]\n\n1. Kd7 Nb6+ 2. Bxb6 *", image }
    const fen = j.fen || j.FEN;
    if (!fen) {
      console.warn("[/puzzles/daily] missing FEN; using fallback");
      return res.json(fallback);
    }

    // Prefer explicit 'moves' if Chess.com ever supplies it; else extract from PGN
    let san = null;
    if (typeof j.moves === "string" && j.moves.trim()) {
      san = j.moves.trim();
    } else if (typeof j.pgn === "string" && j.pgn.trim()) {
      san = extractSANFromPGN(j.pgn);
    }

    if (!san) {
      console.warn("[/puzzles/daily] no SAN found; using fallback");
      return res.json(fallback);
    }

    let moves;
    try {
      moves = sanToUciArray(fen, san);  // SAN → UCI using puzzle FEN
    } catch (e) {
      console.error("[/puzzles/daily] SAN→UCI failed; using fallback:", e);
      return res.json(fallback);
    }

    if (!Array.isArray(moves) || !moves.length) {
      console.warn("[/puzzles/daily] empty UCI after convert; using fallback");
      return res.json(fallback);
    }

    const id = j.id || j.title || j.url || `chesscom-${j.publish_time || Date.now()}`;
    const themes = Array.isArray(j.themes)
      ? j.themes
      : (typeof j.themes === "string" ? j.themes.split(",").map(s => s.trim()).filter(Boolean) : []);

    return res.json({
      id,
      source: "chess.com",
      fen,
      moves,
      rating: j.rating || null,
      themes,
      // debug fields (keep while iterating; remove if you want):
      _title: j.title || null,
      _san: san,
      _pgnSeen: !!j.pgn,
      _url: j.url || null,
    });
  } catch (e) {
    console.error("[/puzzles/daily] unexpected error:", e);
    return res.json(fallback);
  }
});

// --- Chess.com random puzzle (SAN -> UCI) ---
app.get("/puzzles/random", async (_req, res) => {
  try {
    const r = await fetch("https://api.chess.com/pub/puzzle/random", {
      headers: { "User-Agent": "Ichigo/1.0 (+your-email-or-site)" }
    });
    if (!r.ok) return res.status(502).json({ error: `chess.com ${r.status}` });

    const j = await r.json();
    // Expect: { fen, pgn, title, moves (SAN string), rating, themes, url, ... }
    if (!j.fen || (!j.moves && !j.pgn)) {
      return res.status(502).json({ error: "chess.com random: missing fen/moves" });
    }

    // Prefer explicit SAN list if present; else extract SAN from PGN
    let san = "";
    if (typeof j.moves === "string" && j.moves.trim()) {
      san = j.moves;
    } else if (typeof j.pgn === "string") {
      // Cheap PGN → SAN list: split the last line with moves (after headers)
      const body = j.pgn.split(/\r?\n/).filter(l => l && !l.startsWith("[")).join(" ");
      // remove result tokens and move numbers
      san = body
        .replace(/\d+\.(\.\.)?/g, " ")
        .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/,"")
        .trim();
    }

    let moves = [];
    try {
      moves = sanToUciArray(j.fen, san);
    } catch (e) {
      return res.status(502).json({ error: "random SAN→UCI failed", detail: String(e) });
    }

    let themes = [];
    if (Array.isArray(j.themes)) themes = j.themes;
    else if (typeof j.themes === "string") themes = j.themes.split(",").map(s => s.trim());

    const id = j.id || j.title || j.url || "random";

    res.json({
      id,
      fen: j.fen,
      moves,                 // UCI array for frontend
      rating: j.rating || null,
      themes,
      source: "chess.com",
      _san: san,
      _title: j.title || null,
      _puzzleUrl: j.url || null
    });
  } catch (e) {
    res.status(502).json({ error: "random puzzle fetch failed", detail: String(e) });
  }
});

/*
// ---- Engine-generated puzzles: daily + random from SQLite ----

// Fallback in case DB is empty (so UI always has *something* to show)
const FALLBACK_PUZZLE = {
  id: "fallback-queen-mate",
  source: "fallback",
  fen: "7k/5Q2/7K/8/8/8/8/8 w - - 0 1",
  moves: ["f7g7"], // Qg7#
  rating: 1200,
  themes: ["mateIn1","basic"],
};

app.get("/puzzles/random", (req, res) => {
  try {
    const row = DB.prepare(`
      SELECT *
      FROM puzzles
      ORDER BY RANDOM()
      LIMIT 1
    `).get();

    if (!row) {
      // No engine puzzles yet → use fallback so UI doesn't break
      return res.json(FALLBACK_PUZZLE);
    }

    return res.json(puzzleRowToJson(row));
  } catch (e) {
    console.error("[/puzzles/random] error:", e);
    return res.status(500).json({ error: "random puzzle failed" });
  }
});

app.get("/puzzles/daily", (req, res) => {
  try {
    const countRow = DB.prepare("SELECT COUNT(*) AS n FROM puzzles").get();
    const n = countRow?.n || 0;

    if (!n) {
      // still no local puzzles – same fallback
      return res.json(FALLBACK_PUZZLE);
    }

    // Deterministic "daily" selection based on date
    const today = new Date();
    const key = `${today.getUTCFullYear()}-${today.getUTCMonth()+1}-${today.getUTCDate()}`;

    const hash = crypto.createHash("md5").update(key).digest();
    const index = hash.readUInt32BE(0) % n;

    const row = DB.prepare(`
      SELECT *
      FROM puzzles
      ORDER BY id
      LIMIT 1 OFFSET ?
    `).get(index);

    if (!row) {
      return res.json(FALLBACK_PUZZLE);
    }

    return res.json(puzzleRowToJson(row));
  } catch (e) {
    console.error("[/puzzles/daily] error:", e);
    return res.status(500).json({ error: "daily puzzle failed" });
  }
});
*/

// ---- ML-ranked random puzzle (sample from top band) ----
app.get("/puzzles/random-ml", (req, res) => {
  try {
    // 1) Grab a band of "good enough" puzzles
    const rows = DB.prepare(`
      SELECT
        id,
        fen,
        side_to_move,
        solution_moves,
        heuristic_difficulty,
        ml_score,
        source_game
      FROM puzzles
      WHERE ml_score IS NOT NULL
        AND ml_score >= 0.7         -- adjust this threshold if you like
      ORDER BY ml_score DESC
      LIMIT 100                     -- cap how many we consider
    `).all();

    if (!rows.length) {
      return res.status(404).json({ error: "no ML-scored puzzles available in band" });
    }

    // 2) Pick one uniformly at random from this band
    const picked = rows[Math.floor(Math.random() * rows.length)];

    // 3) Robustly parse solution_moves (JSON or whitespace)
    let movesRaw = picked.solution_moves || "";
    let moves = [];

    try {
      const trimmed = String(movesRaw).trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        moves = JSON.parse(trimmed);
      } else {
        moves = trimmed.split(/\s+/).filter(Boolean);
      }
    } catch (e) {
      console.error("[/puzzles/random-ml] parse solution_moves failed:", e);
      moves = String(movesRaw).trim().split(/\s+/).filter(Boolean);
    }

    if (!Array.isArray(moves)) moves = [];
    moves = moves.map(m => String(m).trim().toLowerCase()).filter(Boolean);

    if (!moves.length) {
      return res.status(500).json({ error: "ml puzzle has no moves" });
    }

    res.json({
      id: picked.id,
      fen: picked.fen,
      moves,
      rating: picked.heuristic_difficulty || null,
      themes: ["ml-ranked"],
      source: picked.source_game || "ml",
      ml_score: picked.ml_score,
    });
  } catch (e) {
    console.error("[/puzzles/random-ml] error:", e);
    res.status(500).json({ error: "ml-random failed" });
  }
});


app.post("/game/:id/move", (req, res) => {
  const id = Number(req.params.id);
  const { uci } = req.body || {};
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(uci||"")))
    return res.status(400).json({ error: "bad uci format" });

  const row = gameById(id);
  if (!row) return res.status(404).json({ error: "not found" });

  const prev = (row.moves || "").split(" ").filter(Boolean);
  const g = gameFromMoves(prev);
  if (!g) return res.status(409).json({ error: "corrupt game history" });

  const from = uci.slice(0,2), to = uci.slice(2,4);
  const promotion = uci[4] || undefined;
  const ok = g.move({ from, to, promotion });
  if (!ok) return res.status(422).json({ error: "illegal move" });

  const next = prev.concat(uci);
  const nextStr = next.join(" ");

  const isCheckmate   = api(g, "isCheckmate", "in_checkmate")();
  const isStalemate   = api(g, "isStalemate", "in_stalemate")();
  const isDraw        = api(g, "isDraw", "in_draw")();
  const isThreefold   = api(g, "isThreefoldRepetition", "in_threefold_repetition")();
  const isInsuff      = api(g, "isInsufficientMaterial", "insufficient_material")();

  let over = false, reason = null, result = "*";

  if (isCheckmate) {
    over = true;
    const loser = g.turn();
    const winner = loser === 'w' ? 'b' : 'w';
    result = winner === 'w' ? "1-0" : "0-1";
    reason = "checkmate";
  } else if (isStalemate) {
    over = true; result = "1/2-1/2"; reason = "stalemate";
  } else if (isThreefold) {
    over = true; result = "1/2-1/2"; reason = "threefold repetition";
  } else if (isInsuff) {
    over = true; result = "1/2-1/2"; reason = "insufficient material";
  } else if (isDraw) {
    over = true; result = "1/2-1/2"; reason = "draw";
  }

  DB.prepare("UPDATE games SET moves=? WHERE id=?").run(nextStr, id);

  let pgn = null;
  if (over) {
    const movesUci = next;
    pgn = uciListToPgn({
      movesUci,
      headers: { Event: "Web Game", TimeControl: row.time_control || "300+0" },
      result
    });
    DB.prepare("UPDATE games SET result=?, pgn=? WHERE id=?").run(result, pgn, id);
  }

  res.json({
    ok: true,
    moves: nextStr,
    fen: g.fen(),
    over,
    reason,
    result,
    pgn
  });
});

app.post("/game/:id/finish", (req, res) => {
  try {
    const id = Number(req.params.id);
    const { result="*" } = req.body || {};
    const row = gameById(id); if (!row) return res.status(404).json({error:"not found"});
    const movesUci = row.moves ? row.moves.split(" ").filter(Boolean) : [];
    const pgn = uciListToPgn({ movesUci, headers: { Event:"Web Game", TimeControl: row.time_control }, result });
    DB.prepare("UPDATE games SET result=?, pgn=? WHERE id=?").run(result, pgn, id);
    res.json({ ok:true, result, pgn });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"finish failed" });
  }
});

app.get("/game/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = gameById(id); if (!row) return res.status(404).json({error:"not found"});
  res.json(row);
});

app.get("/games", (_req, res) => {
  const rows = DB.prepare("SELECT id, created_at, result, time_control FROM games ORDER BY id DESC LIMIT 50").all();
  res.json(rows);
});

app.get("/game/:id.pgn", (req, res) => {
  const id = Number(req.params.id);
  const row = DB.prepare("SELECT moves, pgn, time_control, result FROM games WHERE id=?").get(id);
  if (!row) return res.status(404).type("text/plain").send("not found");
  const movesUci = (row.moves || "").split(" ").filter(Boolean);
  const pgn = row.pgn || uciListToPgn({
    movesUci,
    headers: { Event: "Web Game", TimeControl: row.time_control || "300+0" },
    result: row.result || "*"
  });
  res.type("text/plain").send(pgn);
});


// HTTP endpoint: recent games (last N games, default 15)
app.get("/chesscom/:username/games/recent", async (req, res) => {
  try {
    const limitRaw = req.query.limit;
    const limit = Number.isFinite(Number(limitRaw))
      ? Math.min(Math.max(Number(limitRaw), 1), 100)
      : 15; // default 15

    const data = await getRecentGames(req.params.username, limit);
    res.json(data);
  } catch (e) {
    console.error("[/chesscom/:username/games/recent]", e);
    if (e.status === 404) {
      return res.status(404).json({ error: "user not found on chess.com" });
    }
    res.status(502).json({ error: "failed to load games from chess.com" });
  }
});


function loadPgnCompat(game, pgn) {
  const text = String(pgn || "");

  // Newer chess.js / chess.ts
  if (typeof game.loadPgn === "function") {
    try {
      game.loadPgn(text, { sloppy: true });
      return true; // success
    } catch (e) {
      console.error("loadPgn error:", e);
      return false;
    }
  }

  // Older chess.js
  if (typeof game.load_pgn === "function") {
    try {
      return game.load_pgn(text, { sloppy: true });
    } catch (e) {
      console.error("load_pgn error:", e);
      return false;
    }
  }

  throw new Error("Chess.js instance has no loadPgn/load_pgn method");
}

async function fetchJsonWithTimeout(url, { timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Ichigo/1.0 (+your-email-or-site)",
        "Accept": "application/json",
      },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} for ${url}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/*

// === Chess.com recent month games ===
async function getRecentMonthGames(usernameRaw) {
  const username = String(usernameRaw || "").trim().toLowerCase();
  if (!username) throw new Error("missing username");

  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username)}`;

  // 1) archives list
  const archivesJson = await fetchJsonWithTimeout(`${base}/games/archives`);
  const archives = Array.isArray(archivesJson.archives) ? archivesJson.archives : [];
  if (!archives.length) {
    return { username, archive: null, games: [] };
  }

  // 2) most recent month
  const latestUrl = archives[archives.length - 1];

  // 3) that month’s games
  const monthJson = await fetchJsonWithTimeout(latestUrl);
  const rawGames = Array.isArray(monthJson.games) ? monthJson.games : [];

  const games = rawGames.map((g, idx) => ({
    id: idx,
    url: g.url || null,
    end_time: g.end_time || null,
    time_control: g.time_control || null,
    time_class: g.time_class || null,
    rated: !!g.rated,
    white: {
      username: g.white?.username || null,
      rating: g.white?.rating || null,
      result: g.white?.result || null,
    },
    black: {
      username: g.black?.username || null,
      rating: g.black?.rating || null,
      result: g.black?.result || null,
    },
    pgn: g.pgn || null,
  }));

  return { username, archive: latestUrl, games };
}

// HTTP endpoint: recent games
app.get("/chesscom/:username/games/recent", async (req, res) => {
  try {
    const data = await getRecentMonthGames(req.params.username);
    res.json(data);
  } catch (e) {
    console.error("[/chesscom/:username/games/recent]", e);
    if (e.status === 404) {
      return res.status(404).json({ error: "user not found on chess.com" });
    }
    res.status(502).json({ error: "failed to load games from chess.com" });
  }
});
*/

// === Chess.com recent games (last N games across months) ===
async function getRecentGames(usernameRaw, maxGames = 15) {
  const username = String(usernameRaw || "").trim().toLowerCase();
  if (!username) throw new Error("missing username");

  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username)}`;

  // 1) Get list of archive URLs (monthly)
  const archivesJson = await fetchJsonWithTimeout(`${base}/games/archives`);
  const archives = Array.isArray(archivesJson.archives) ? archivesJson.archives : [];
  if (!archives.length) {
    return { username, archives: [], games: [] };
  }

  const games = [];

  // 2) Walk archives from newest to oldest until we have maxGames
  for (let i = archives.length - 1; i >= 0 && games.length < maxGames; i--) {
    const monthUrl = archives[i];
    const monthJson = await fetchJsonWithTimeout(monthUrl);
    const rawGames = Array.isArray(monthJson.games) ? monthJson.games : [];
    if (!rawGames.length) continue;

    // 3) Walk this month's games from newest to oldest
    for (let j = rawGames.length - 1; j >= 0 && games.length < maxGames; j--) {
      const g = rawGames[j];

      games.push({
        id: games.length, // global index across months
        url: g.url || null,
        end_time: g.end_time || null,
        time_control: g.time_control || null,
        time_class: g.time_class || null,
        rated: !!g.rated,
        white: {
          username: g.white?.username || null,
          rating: g.white?.rating || null,
          result: g.white?.result || null,
        },
        black: {
          username: g.black?.username || null,
          rating: g.black?.rating || null,
          result: g.black?.result || null,
        },
        pgn: g.pgn || null,
      });
    }
  }

  return { username, archives, games };
}

/*
function buildPuzzlesFromPGN({ pgn, username, maxPuzzles = 12 }) {
  const game = new Chess();

  const ok = loadPgnCompat(game, pgn);
  if (!ok) throw new Error("bad PGN");

  let tags = {};
  if (typeof game.header === "function") {
    try { tags = game.header() || {}; } catch { tags = {}; }
  } else if (typeof game.getHeaders === "function") {
    try { tags = game.getHeaders() || {}; } catch { tags = {}; }
  }

  const uname = username ? String(username).toLowerCase() : null;

  let focusColor = "w";
  if (uname) {
    if ((tags.White || "").toLowerCase() === uname) focusColor = "w";
    else if ((tags.Black || "").toLowerCase() === uname) focusColor = "b";
  }

  const verboseMoves = game.history({ verbose: true });
  const replay = new Chess();

  const puzzles = [];

  for (let i = 0; i < verboseMoves.length; i++) {
    const moveObj = verboseMoves[i];
    const sideToMove = replay.turn();
    const fenBefore = replay.fen();

    if (sideToMove === focusColor) {
      const uci =
        moveObj.from +
        moveObj.to +
        (moveObj.promotion ? moveObj.promotion : "");

      const fullMoveNumber = Math.floor(i / 2) + 1;

      puzzles.push({
        id: i,
        fen: fenBefore,
        sideToMove,
        uci,
        san: moveObj.san,
        ply: i + 1,
        moveNumber: fullMoveNumber,
      });
    }

    replay.move(moveObj);
  }

  if (puzzles.length > maxPuzzles) {
    const step = Math.max(1, Math.floor(puzzles.length / maxPuzzles));
    const sampled = [];
    for (let i = 0; i < puzzles.length && sampled.length < maxPuzzles; i += step) {
      sampled.push(puzzles[i]);
    }
    return sampled;
  }

  return puzzles;
}
*/

async function buildEvalPuzzlesFromPGN({
  pgn,
  username,
  movetimeMs = 60,
  maxPuzzlesPerGame = 50,
}) {
  const game = new Chess();

  const ok = loadPgnCompat(game, pgn);
  if (!ok) throw new Error("bad PGN");

  let tags = {};
  if (typeof game.header === "function") {
    try {
      tags = game.header() || {};
    } catch {
      tags = {};
    }
  } else if (typeof game.getHeaders === "function") {
    try {
      tags = game.getHeaders() || {};
    } catch {
      tags = {};
    }
  }

  const uname = username ? String(username).toLowerCase() : null;
  let focusColor = "w";
  if (uname) {
    if ((tags.White || "").toLowerCase() === uname) focusColor = "w";
    else if ((tags.Black || "").toLowerCase() === uname) focusColor = "b";
  }

  const verboseMoves = game.history({ verbose: true });
  const replay = new Chess();

  const candidates = [];

  // First: collect candidate moves (sideToMove == focusColor)
  for (let i = 0; i < verboseMoves.length; i++) {
    const moveObj = verboseMoves[i];
    const sideToMove = replay.turn();
    const fenBefore = replay.fen();

    const playedUci =
      moveObj.from +
      moveObj.to +
      (moveObj.promotion ? moveObj.promotion : "");

    const ply = i + 1;
    const fullMoveNumber = Math.floor(i / 2) + 1;

    if (sideToMove === focusColor) {
      const tmp = new Chess(fenBefore);
      tmp.move(moveObj);
      const fenAfterPlayed = tmp.fen();

      candidates.push({
        gameTag: tags.Event || null,
        fen: fenBefore,
        fenAfterPlayed,
        sideToMove,
        uci: playedUci,
        san: moveObj.san,
        ply,
        moveNumber: fullMoveNumber,
      });
    }

    replay.move(moveObj);
  }

  const evaluated = [];

  // Second: run engine evals and compute features
  for (const c of candidates) {
    try {
      const pre = await evalPositionCp(c.fen, movetimeMs);
      if (pre.evalCp == null && pre.evalMate == null) continue;

      const aft = await evalPositionCp(c.fenAfterPlayed, movetimeMs);
      if (aft.evalCp == null && aft.evalMate == null) continue;

      const mateToCp = (m) => (m == null ? null : (m > 0 ? 100000 : -100000));

      const preCpRaw =
        pre.evalCp != null ? pre.evalCp : mateToCp(pre.evalMate);
      const afterCpRaw =
        aft.evalCp != null ? aft.evalCp : mateToCp(aft.evalMate);

      if (preCpRaw == null || afterCpRaw == null) continue;

      const pre_eval_cp = preCpRaw;
      const best_eval_cp = pre_eval_cp;

      // after position: opponent to move; flip sign to keep hero POV
      const played_eval_cp = -afterCpRaw;

      const eval_gap_cp = best_eval_cp - played_eval_cp;

      const heuristic_difficulty = Math.max(
        0,
        Math.min(4000, Math.abs(eval_gap_cp) + Math.max(0, best_eval_cp))
      );

      const is_mate = pre.evalMate != null ? 1 : 0;

      evaluated.push({
        fen: c.fen,
        sideToMove: c.sideToMove,
        uci: c.uci,
        san: c.san,
        ply: c.ply,
        moveNumber: c.moveNumber,
        source_event: c.gameTag,
        pre_eval_cp,
        best_eval_cp,
        played_eval_cp,
        eval_gap_cp,
        heuristic_difficulty,
        is_mate,
      });
    } catch (e) {
      console.error("[from-user eval] failed for ply", c.ply, e);
    }
  }

  console.log(
    `[from-user] game ${tags.Event || ""}: candidates=${candidates.length}, evaluated=${evaluated.length}`
  );

  if (!evaluated.length) return [];

  const BIG_GAP_CP = 120; // ~1.2 pawns

  // Only keep genuinely "big blunder" positions
  let filtered = evaluated.filter(
    (p) => p.eval_gap_cp != null && p.eval_gap_cp >= BIG_GAP_CP
  );

  console.log(
    `[from-user] game ${tags.Event || ""}: filtered=${filtered.length} (gap >= ${BIG_GAP_CP})`
  );

  // If no positions pass the threshold, this game simply contributes 0 puzzles
  if (!filtered.length) return [];

  if (filtered.length > maxPuzzlesPerGame) {
    filtered = filtered.slice(0, maxPuzzlesPerGame);
  }

  return filtered;
}


async function buildUserRecentPuzzlesML({
  username,
  maxGames = 15,
  maxPuzzles = 200,
  movetimeMs = 60,
}) {
  const data = await getRecentGames(username, maxGames);
  const games = Array.isArray(data.games) ? data.games : [];
  if (!games.length) return [];

  // Newest first, only games with PGN
  const sorted = games
    .filter((g) => g && g.pgn)
    .sort((a, b) => (b.end_time || 0) - (a.end_time || 0));

  const selected = sorted.slice(0, maxGames);

  const allPuzzles = [];

  for (const g of selected) {
    try {
      const puzzles = await buildEvalPuzzlesFromPGN({
        pgn: g.pgn,
        username,
        movetimeMs,
        maxPuzzlesPerGame: 50,
      });

      console.log(
        `[from-user] game id=${g.id}, got ${puzzles.length} puzzles`
      );

      for (const p of puzzles) {
        p.source_game_id = g.id;
        p.time_control   = g.time_control || null;
        p.time_class     = g.time_class || null;
        p.rated          = !!g.rated;
      }

      allPuzzles.push(...puzzles);
    } catch (e) {
      console.error("[from-user] failed on game", g.id, e);
    }
  }

  console.log(`[from-user] total puzzles before ML: ${allPuzzles.length}`);

  if (!allPuzzles.length) return [];

  // === ML scoring via Python script ===
  let scored;
  try {
    scored = await scorePuzzlesWithPython(allPuzzles);
  } catch (e) {
    console.error("[from-user ML] scoring failed, falling back to eval_gap_cp:", e);
    scored = allPuzzles.map((p) => ({ ...p, ml_score: p.eval_gap_cp }));
  }

  const THRESH = 0.5; // tune this if needed
  let mlPuzzles = scored.filter(
    (p) => p.ml_score != null && p.ml_score >= THRESH
  );

  console.log(
    `[from-user] ML accepted ${mlPuzzles.length} / ${scored.length} candidates (threshold=${THRESH})`
  );

  // Sort best to worst and cap
  mlPuzzles.sort((a, b) => (b.ml_score || 0) - (a.ml_score || 0));
  if (mlPuzzles.length > maxPuzzles) {
    mlPuzzles = mlPuzzles.slice(0, maxPuzzles);
  }

  return mlPuzzles;
}


// Build puzzles from PGN using engine eval + ML-ish features
async function buildPuzzlesFromPGNWithEval({ pgn, username, maxPuzzles = 12, movetimeMs = 80 }) {
  const game = new Chess();

  const ok = loadPgnCompat(game, pgn);
  if (!ok) throw new Error("bad PGN");

  let tags = {};
  if (typeof game.header === "function") {
    try { tags = game.header() || {}; } catch { tags = {}; }
  } else if (typeof game.getHeaders === "function") {
    try { tags = game.getHeaders() || {}; } catch { tags = {}; }
  }

  const uname = username ? String(username).toLowerCase() : null;
  let focusColor = "w";
  if (uname) {
    if ((tags.White || "").toLowerCase() === uname) focusColor = "w";
    else if ((tags.Black || "").toLowerCase() === uname) focusColor = "b";
  }

  const verboseMoves = game.history({ verbose: true });
  const replay = new Chess();

  // First pass: collect candidate positions (just structure)
  const candidates = [];

  for (let i = 0; i < verboseMoves.length; i++) {
    const moveObj = verboseMoves[i];
    const sideToMove = replay.turn(); // side about to play this move
    const fenBefore = replay.fen();

    const playedUci =
      moveObj.from +
      moveObj.to +
      (moveObj.promotion ? moveObj.promotion : "");

    const ply = i + 1;
    const fullMoveNumber = Math.floor(i / 2) + 1;

    if (sideToMove === focusColor) {
      // Compute FEN after the actually played move
      const tmp = new Chess(fenBefore);
      tmp.move(moveObj);
      const fenAfterPlayed = tmp.fen();

      candidates.push({
        id: i,
        fen: fenBefore,
        sideToMove,
        uci: playedUci,
        san: moveObj.san,
        ply,
        moveNumber: fullMoveNumber,
        fenAfterPlayed,
      });
    }

    replay.move(moveObj);
  }

  // Second pass: engine eval for each candidate
  const evaluated = [];
  for (const c of candidates) {
    try {
      // Eval of position before move (sideToMove POV)
      const pre = await evalPositionCp(c.fen, movetimeMs);
      if (pre.evalCp == null && pre.evalMate == null) continue;

      // Eval of position after the played move (opponent to move POV)
      const aft = await evalPositionCp(c.fenAfterPlayed, movetimeMs);
      if (aft.evalCp == null && aft.evalMate == null) continue;

      // Convert "mate" to large cp value if needed
      const mateToCp = (m) => (m == null ? null : (m > 0 ? 100000 : -100000));

      const preCpRaw   = pre.evalCp != null ? pre.evalCp : mateToCp(pre.evalMate);
      const afterCpRaw = aft.evalCp != null ? aft.evalCp : mateToCp(aft.evalMate);

      if (preCpRaw == null || afterCpRaw == null) continue;

      // pre_eval_cp: eval before move from side-to-move's POV (UCI cp already does this)
      const pre_eval_cp = preCpRaw;

      // best_eval_cp: "what if I play best" — we approximate using pre_eval_cp
      const best_eval_cp = pre_eval_cp;

      // played_eval_cp: eval after played move, from the same player's POV
      // After the move, it's opponent's turn; UCI cp is from opponent's POV,
      // so flip the sign to keep it "hero's" perspective.
      const played_eval_cp = -afterCpRaw;

      const eval_gap_cp = best_eval_cp - played_eval_cp;
      const absGap = Math.abs(eval_gap_cp);

      // Simple difficulty heuristic (similar scale to offline):
      const heuristic_difficulty = Math.max(
        0,
        Math.min(4000, absGap + Math.max(0, best_eval_cp))
      );

      const is_mate = pre.evalMate != null ? 1 : 0;

      evaluated.push({
        id: c.id,
        fen: c.fen,
        sideToMove: c.sideToMove,
        uci: c.uci,
        san: c.san,
        ply: c.ply,
        moveNumber: c.moveNumber,
        pre_eval_cp,
        best_eval_cp,
        played_eval_cp,
        eval_gap_cp,
        heuristic_difficulty,
        is_mate,
      });
    } catch (e) {
      console.error("[from-game eval] failed for ply", c.ply, e);
    }
  }

  // Filter for "interesting" tactics before ML (big gap)
  const filtered = evaluated.filter((p) => p.eval_gap_cp != null && p.eval_gap_cp >= 150);

  if (!filtered.length) return [];

  // Third pass: send to Python RF model for ml_score
  let scored;
  try {
    scored = await scorePuzzlesWithPython(filtered);
  } catch (e) {
    console.error("[from-game ML] scoring failed:", e);
    // Fall back to just using eval_gap_cp as score
    scored = filtered.map((p) => ({ ...p, ml_score: p.eval_gap_cp }));
  }

  // Sort by ml_score desc and keep up to maxPuzzles
  scored.sort((a, b) => (b.ml_score || 0) - (a.ml_score || 0));

  return scored.slice(0, maxPuzzles);
}

/*
// HTTP endpoint: build puzzles from a single game PGN
app.post("/puzzles/from-game", (req, res) => {
  try {
    const { pgn, username, maxPuzzles } = req.body || {};
    if (!pgn) return res.status(400).json({ error: "missing pgn" });

    const max = Number.isFinite(Number(maxPuzzles))
      ? Math.min(Math.max(Number(maxPuzzles), 1), 50)
      : 12;

    const puzzles = buildPuzzlesFromPGN({ pgn, username, maxPuzzles: max });

    res.json({
      ok: true,
      count: puzzles.length,
      puzzles,
    });
  } catch (e) {
    console.error("[/puzzles/from-game] error:", e);
    res.status(500).json({ ok: false, error: "puzzle generation failed" });
  }
});
*/
// HTTP endpoint: build ML-ranked puzzles from a single game PGN
app.post("/puzzles/from-game", async (req, res) => {
  try {
    const { pgn, username, maxPuzzles } = req.body || {};
    if (!pgn) return res.status(400).json({ error: "missing pgn" });

    const max = Number.isFinite(Number(maxPuzzles))
      ? Math.min(Math.max(Number(maxPuzzles), 1), 50)
      : 12;

    const puzzles = await buildPuzzlesFromPGNWithEval({
      pgn,
      username,
      maxPuzzles: max,
      movetimeMs: 80, // tweak if too slow/fast
    });

    res.json({
      ok: true,
      count: puzzles.length,
      puzzles,
    });
  } catch (e) {
    console.error("[/puzzles/from-game] error:", e);
    res.status(500).json({ ok: false, error: "puzzle generation failed" });
  }
});

// === HTTP endpoint: ML-ranked puzzles from recent games for a Chess.com user ===
app.post("/puzzles/from-user-ml", async (req, res) => {
  try {
    const { username, maxGames, maxPuzzles, movetimeMs } = req.body || {};
    const uname = String(username || "").trim();
    if (!uname) return res.status(400).json({ ok: false, error: "missing username" });

    const maxG = Number.isFinite(Number(maxGames)) ? Math.min(Math.max(Number(maxGames), 1), 50) : 15;
    const maxP = Number.isFinite(Number(maxPuzzles)) ? Math.min(Math.max(Number(maxPuzzles), 1), 500) : 200;
    const mt   = Number.isFinite(Number(movetimeMs)) ? Math.max(20, Math.min(Number(movetimeMs), 200)) : 60;

    const puzzles = await buildUserRecentPuzzlesML({
      username: uname,
      maxGames: maxG,
      maxPuzzles: maxP,
      movetimeMs: mt,
    });

    res.json({
      ok: true,
      username: uname,
      count: puzzles.length,
      puzzles,
    });
  } catch (e) {
    console.error("[/puzzles/from-user-ml] error:", e);
    res.status(500).json({ ok: false, error: "puzzle generation failed" });
  }
});

// Root fallback (serves index if no static file matched)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function shutdown() {
  try { playEngine.kill("SIGTERM"); } catch {}
  try { analysisEngine.kill("SIGTERM"); } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- start server ----
app.listen(PORT, HOST, () => console.log(`HTTP on ${HOST}:${PORT}`));
