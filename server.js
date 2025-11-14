// ---- imports ----
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");


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
// const ENGINE_PATH = path.join(__dirname, "engine", "chess_engine");
const ENGINE_PATH = process.env.ENGINE_PATH || path.join(__dirname, "build", "chess_uci_bb");

//const ENGINE_PATH = process.env.ENGINE_PATH || ""
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");


// ensure data dir exists
fs.mkdirSync(DATA_DIR, { recursive: true });

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

// ---- engine process (single-process MVP) ----
const engine = spawn(ENGINE_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });
engine.on("error", (err) => console.error("[engine] spawn error:", err));
engine.on("exit", (code, sig) => console.error(`[engine] exited (code=${code} sig=${sig})`));

// helper: run a small UCI exchange and wait for a pattern
function uciExchange(lines, untilRegex) {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      if (untilRegex.test(buf)) {
        engine.stdout.off("data", onData);
        resolve(buf);
      }
    };
    engine.stdout.on("data", onData);
    engine.stdin.write(lines.join("\n") + "\n");
  });
}

// init engine once at startup
(async () => {
  try {
    await uciExchange(["uci"], /uciok/);
    await uciExchange(["isready"], /readyok/);
    console.log("Engine ready.");
  } catch (e) {
    console.error("Engine failed to initialize:", e);
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
          engine.stdout.off("data", onData);
          resolve();
        }
      };
      engine.stdout.on("data", onData);
      engine.stdin.write([pos, "isready", goCmd].join("\n") + "\n");
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



// Root fallback (serves index if no static file matched)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---- graceful shutdown ----
function shutdown() {
  try { engine.kill("SIGTERM"); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- start server ----
app.listen(PORT, HOST, () => console.log(`HTTP on ${HOST}:${PORT}`));
