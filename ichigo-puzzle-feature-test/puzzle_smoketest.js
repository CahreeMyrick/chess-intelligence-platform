// puzzle_smoketest.js
// Usage: node puzzle_smoketest.js <chess.com-username>

const chessjs = require("chess.js");
// Works for both classic and new builds of chess.js
const Chess = typeof chessjs === "function" ? chessjs : chessjs.Chess;
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

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

// === 1) same logic as getRecentMonthGames ===
async function getRecentMonthGames(usernameRaw) {
  const username = String(usernameRaw || "").trim().toLowerCase();
  if (!username) throw new Error("missing username");

  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username)}`;

  // archives list
  const archivesJson = await fetchJsonWithTimeout(`${base}/games/archives`);
  const archives = Array.isArray(archivesJson.archives) ? archivesJson.archives : [];
  if (!archives.length) {
    return { username, archive: null, games: [] };
  }

  const latestUrl = archives[archives.length - 1];

  // month data
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

function buildPuzzlesFromPGN({ pgn, username, maxPuzzles = 12 }) {
  const game = new Chess();

  const ok = loadPgnCompat(game, pgn);
  if (!ok) throw new Error("bad PGN");

  // Try to read headers if this version exposes them; otherwise fall back.
  let tags = {};
  if (typeof game.header === "function") {
    try { tags = game.header() || {}; } catch { tags = {}; }
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
function loadPgnCompat(game, pgn) {
  const text = String(pgn || "");

  // Newer chess.js / chess.ts: loadPgn throws on error, returns void on success
  if (typeof game.loadPgn === "function") {
    try {
      game.loadPgn(text, { sloppy: true });
      return true; // if we got here, it worked
    } catch (e) {
      console.error("loadPgn error:", e);
      return false;
    }
  }

  // Older chess.js: load_pgn returns a boolean
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


// === 3) Smoke test: username -> games -> puzzles ===
(async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: node puzzle_smoketest.js <chess.com-username>");
    process.exit(1);
  }

  console.log(`Fetching recent month games for: ${username} ...`);
  const data = await getRecentMonthGames(username);

  console.log("username:", data.username);
  console.log("archive:", data.archive);
  console.log("games found:", data.games.length);

  if (!data.games.length) {
    console.log("No games found in the most recent month. Try another user.");
    return;
  }

  const g = data.games[0]; // first game
  console.log("\nFirst game:");
  console.log(
    `  ${g.white.username} (${g.white.rating}) vs ${g.black.username} (${g.black.rating})`
  );
  console.log(`  tc=${g.time_control} class=${g.time_class} rated=${g.rated}`);
  console.log(`  result: ${g.white.result} / ${g.black.result}`);

  if (!g.pgn) {
    console.log("This game has no PGN, cannot build puzzles.");
    return;
  }

  console.log("\nBuilding puzzles from that game...");
  const puzzles = buildPuzzlesFromPGN({ pgn: g.pgn, username, maxPuzzles: 12 });

  console.log(`Puzzles generated: ${puzzles.length}`);
  if (!puzzles.length) {
    console.log("No puzzles produced (maybe super short game).");
    return;
  }

  console.log("\nSample puzzle:");
  console.log(JSON.stringify(puzzles[0], null, 2));
})();
