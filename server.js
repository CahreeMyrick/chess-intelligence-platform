// ---- imports ----
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const { Chess } = require("chess.js");
let BOOK = {};
try { BOOK = require("./book"); } catch { BOOK = {}; } // optional book
const Database = require("better-sqlite3");

// ---- config ----
const PORT = process.env.PORT || 8080;
const DEFAULT_SITE = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
// Adjust this to your built engine path
const ENGINE_PATH = path.join(__dirname, "engine", "chess_engine"); // e.g. "./build/chess_uci"
const DATA_DIR = path.join(__dirname, "data");

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
  moves TEXT DEFAULT '',     -- space-separated UCI
  pgn   TEXT,
  time_control TEXT DEFAULT '5+0'
);
`);
function gameById(id){
  return DB.prepare(`SELECT id, created_at, result, moves, pgn, time_control
                     FROM games WHERE id=?`).get(id);
}

// ---- app bootstrap ----
const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "100kb" }));

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

// ---- rate limit for engine endpoint ----
app.use("/bestmove", rateLimit({ windowMs: 60_000, max: 30 }));

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

// Create a new game row
app.post("/game/new", (req, res) => {
  const { time_control = "5+0" } = req.body || {};
  const info = DB.prepare("INSERT INTO games (time_control) VALUES (?)").run(time_control);
  res.json({ gameId: info.lastInsertRowid });
});

// Helper to normalize chess.js API across versions
function api(g, nameNew, nameOld) {
  return typeof g[nameNew] === "function" ? g[nameNew].bind(g)
       : typeof g[nameOld] === "function" ? g[nameOld].bind(g)
       : () => false;
}

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

  // apply the new move
  const from = uci.slice(0,2), to = uci.slice(2,4);
  const promotion = uci[4] || undefined;
  const ok = g.move({ from, to, promotion });
  if (!ok) return res.status(422).json({ error: "illegal move" });

  // Build the new list
  const next = prev.concat(uci);
  const nextStr = next.join(" ");

  // Detect game end (support both old/new chess.js method names)
  const isCheckmate   = api(g, "isCheckmate", "in_checkmate")();
  const isStalemate   = api(g, "isStalemate", "in_stalemate")();
  const isDraw        = api(g, "isDraw", "in_draw")();
  const isThreefold   = api(g, "isThreefoldRepetition", "in_threefold_repetition")();
  const isInsuff      = api(g, "isInsufficientMaterial", "insufficient_material")();

  let over = false, reason = null, result = "*";

  if (isCheckmate) {
    over = true;
    // After the move, g.turn() is the side TO MOVE (the loser in checkmate)
    const loser = g.turn();               // 'w' or 'b'
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
    // Generic draw condition (50-move rule, etc.)
    over = true; result = "1/2-1/2"; reason = "draw";
  }

  // Persist moves
  DB.prepare("UPDATE games SET moves=? WHERE id=?").run(nextStr, id);

  // If over, also snapshot PGN + result
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
    reason,   // e.g. "checkmate"
    result,   // "1-0", "0-1", "1/2-1/2" or "*"
    pgn       // null unless over==true
  });
});

// Finish a game (sets result; also stores PGN snapshot)
app.post("/game/:id/finish", (req, res) => {
  try {
    const id = Number(req.params.id);
    const { result="*" } = req.body || {}; // "1-0","0-1","1/2-1/2","*"
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

// Read one game
app.get("/game/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = gameById(id); if (!row) return res.status(404).json({error:"not found"});
  res.json(row);
});

// List recent games
app.get("/games", (_req, res) => {
  const rows = DB.prepare("SELECT id, created_at, result, time_control FROM games ORDER BY id DESC LIMIT 50").all();
  res.json(rows);
});

// Direct PGN view
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

// ---- graceful shutdown ----
function shutdown() {
  try { engine.kill("SIGTERM"); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- start server ----
app.listen(PORT, () => console.log(`HTTP on :${PORT}`));
