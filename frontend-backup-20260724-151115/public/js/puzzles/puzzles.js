import {
  boardArrayToPosition,
  coordinatesToSquare,
  createStartingBoard,
  parseFen,
  parseSquare,
} from "../common/chess-utils.js";

/* ═══════════════════════════════════════
     State
  ═══════════════════════════════════════ */
  let board        = null;   // chessboard.js instance
  let boardArray   = Array.from({length:8}, () => Array(8).fill(null));
  let selectedSq   = null;   // unused, kept for compat
  let solution     = [];
  let idx          = 0;
  let startFen     = null;
  let turn         = 'w';
  let initSide     = 'w';
  let viewMode     = 'side';
  let whiteAtBottom = true;
  let autoTimer    = null;
  let lastFromSq   = null;   // 'e2' etc for highlight
  let lastToSq     = null;

  let fromGamePuzzles  = [];
  let fromGameIndex    = -1;
  let fromGameGame     = null;
  let fromGameUsername = null;
  let activeSource     = 'daily';
  let mlRunning        = false;
    return pos;
  }

  /* ═══════════════════════════════════════
     Render — push position into chessboard.js
     and repaint square highlights
  ═══════════════════════════════════════ */
  function renderBoard() {
    if (!board) return;
    board.position(boardArrayToPosition(boardArray), false);
    updateHighlights();
    updateProgress();
  }

  function clearHighlights() {
    $('#board .square-55d63').removeClass('last-move hint-square');
  }

  function addSqClass(sq, cls) {
    if (sq) $('#board .square-' + sq).addClass(cls);
  }

  function updateHighlights() {
    clearHighlights();
    addSqClass(lastFromSq, 'last-move');
    addSqClass(lastToSq,   'last-move');
  }

  /* ═══════════════════════════════════════
     UI helpers
  ═══════════════════════════════════════ */
  function setTurnPill() {
    const label = turn === 'w' ? 'White to move' : 'Black to move';
    labTurnEl.textContent = label;
    sideTurn.textContent  = label;
  }

  function recomputeOrientation() {
    whiteAtBottom = (viewMode === 'white') ? true : (initSide === 'w');
  }

  function setThemes(arr) {
    themesWrap.innerHTML = '';
    arr = Array.isArray(arr) ? arr : [];
    arr.forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'theme-pill';
      pill.style.marginLeft = '6px';
      pill.textContent = t;
      themesWrap.appendChild(pill);
    });
    sideThemes.textContent = arr.length ? arr.join(', ') : '—';
  }

  function updateProgress() {
    const total = solution.length, done = idx;
    progressCount.textContent = `${done} / ${total}`;
    progressFill.style.width  = (total > 0 ? done/total*100 : 0) + '%';
  }

  function showFeedback(type, msg) {
    feedbackBar.className    = 'feedback-bar ' + type;
    feedbackIcon.textContent = type === 'correct' ? '✓' : '✗';
    feedbackText.textContent = msg;
  }

  function hideFeedback() { feedbackBar.className = 'feedback-bar'; }

  function showSolved()           { showFeedback('correct', 'Solved! Well done.'); }
  function showWrong(msg='Incorrect — try again.') {
    showFeedback('wrong', msg);
    selectedSq = null;
    updateHighlights();
  }

  function showFromGamesPanel(v) { fromGamesCard.style.display = v ? '' : 'none'; }

  /* ═══════════════════════════════════════
     FEN parser (original logic)
  ═══════════════════════════════════════ */
  function parseFEN(fen) {
    const parsed = parseFen(fen);
    initSide = parsed.activeColor;
    boardArray = parsed.boardArray.map(rank =>
      rank.map(piece => piece ? ({ c: piece.color, t: piece.type }) : null)
    );
    turn = initSide;
    lastFromSq = null;
    lastToSq = null;
    selectedSq = null;
    setTurnPill();
    recomputeOrientation();
    if (board) board.orientation(whiteAtBottom ? 'white' : 'black');
  }

  /* ═══════════════════════════════════════
     Move logic (original, untouched)
  ═══════════════════════════════════════ */
  function illegal(reason) { return { ok:false, reason }; }

  function applyMoveUci(uci, { silent=false } = {}) {
    const from  = parseSquare(uci.slice(0,2));
    const to    = parseSquare(uci.slice(2,4));
    const promo = uci[4] || null;
    const moving = boardArray[from.row]?.[from.col];

    if (!moving)                        return illegal('no piece on from-square');
    if (moving.col !== turn)              return illegal(`wrong side: expected ${turn}`);
    const dest = boardArray[to.row]?.[to.col] || null;
    if (dest && dest.col === moving.col)    return illegal('destination has own piece');

    const isPawn = moving.t === 'p';
    const diagonal = from.col !== to.col;
    const targetEmpty = !dest;

    boardArray[to.row][to.col]   = { ...moving };
    boardArray[from.row][from.col] = null;
    if (promo) boardArray[to.row][to.col].t = promo;

    // Castling
    if (moving.t === 'k' && Math.abs(to.col - from.col) === 2) {
      const row = from.row;
      if (to.col === 6) {
        const rf={r:row,c:7}, rt={r:row,c:5};
        if (boardArray[rf.row][rf.col]?.t==='r') { boardArray[rt.row][rt.col]={...boardArray[rf.row][rf.col]}; boardArray[rf.row][rf.col]=null; }
      } else if (to.col === 2) {
        const rf={r:row,c:0}, rt={r:row,c:3};
        if (boardArray[rf.row][rf.col]?.t==='r') { boardArray[rt.row][rt.col]={...boardArray[rf.row][rf.col]}; boardArray[rf.row][rf.col]=null; }
      }
    }

    // En passant
    if (isPawn && diagonal && targetEmpty) {
      const dir = moving.col==='w' ? 1 : -1;
      const cap = { r: to.row+dir, c: to.col };
      if (boardArray[cap.row]?.[cap.col]?.t==='p' && boardArray[cap.row][cap.col]?.col !== moving.col)
        boardArray[cap.row][cap.col] = null;
    }

    lastFromSq = coordinatesToSquare(from);
    lastToSq   = coordinatesToSquare(to);
    turn = (turn==='w' ? 'b' : 'w');
    if (!silent) setTurnPill();
    return { ok:true };
  }

  /* ═══════════════════════════════════════
     Click-to-move (chessboard.js onSquareClick)
  ═══════════════════════════════════════ */
  function onSquareClick(square, piece) {
    if (!solution.length) return;

    // If nothing selected yet — select this square if it has the right piece
    if (!selectedSq) {
      const {r,c} = parseSquare(square);
      const p = boardArray[r][c];
      if (!p || p.col !== turn) return; // must click own piece
      selectedSq = square;
      updateHighlights();
      return;
    }

    // Clicking the same square — deselect
    if (selectedSq === square) {
      selectedSq = null;
      updateHighlights();
      return;
    }

    // Attempt move
    const from     = selectedSq;
    const to       = square;
    const expected = solution[idx] || '';

    if (from === expected.slice(0,2) && to === expected.slice(2,4)) {
      const res = applyMoveUci(expected);
      if (!res.ok) { showWrong(`Illegal: ${res.reason}`); return; }
      idx++;
      selectedSq = null;
      hideFeedback();
      renderBoard();
      if (idx === solution.length) {
        showSolved();
      } else {
        autoReplyIfAny();
      }
    } else {
      // Maybe they're re-selecting a different own piece
      const {r,c} = parseSquare(square);
      const p = boardArray[r][c];
      if (p && p.col === turn) {
        selectedSq = square;
        updateHighlights();
      } else {
        showWrong();
      }
    }
  }

  /* ═══════════════════════════════════════
     Auto-reply (engine's move in puzzle)
  ═══════════════════════════════════════ */
  function autoReplyIfAny() {
    if (idx >= solution.length) return;
    setTimeout(() => {
      if (idx >= solution.length) return;
      const res = applyMoveUci(solution[idx]);
      if (res.ok) {
        idx++;
        renderBoard();
        if (idx === solution.length) showSolved();
      } else {
        showWrong(`Puzzle data mismatch: ${res.reason}`);
      }
    }, 300);
  }

  /* ═══════════════════════════════════════
     Solution verifier (original)
  ═══════════════════════════════════════ */
  function verifySolutionOnce(fen, moves) {
    const parts = fen.trim().split(/\s+/);
    let tempBoard = Array.from({length:8}, () => Array(8).fill(null));
    let t = (parts[1] || 'w');
    parts[0].split('/').forEach((row,r) => {
      let c=0;
      for (const ch of row) {
        if (/\d/.test(ch)) { c+=Number(ch); continue; }
        tempBoard[r][c++] = { c:ch===ch.toLowerCase()?'b':'w', t:ch.toLowerCase() };
      }
    });

    function tempApply(uci) {
      const from=parseSquare(uci.slice(0,2)), to=parseSquare(uci.slice(2,4)), promo=uci[4]||null;
      const moving=tempBoard[from.row]?.[from.col];
      if (!moving) return 'no piece on from-square';
      if (moving.col!==t) return `wrong side: expected ${t}, got ${moving.col}`;
      const dest=tempBoard[to.row]?.[to.col]||null;
      if (dest&&dest.col===moving.col) return 'destination has own piece';
      const isPawn=moving.t==='p', diagonal=from.col!==to.col, targetEmpty=!dest;
      tempBoard[to.row][to.col]={...moving}; tempBoard[from.row][from.col]=null;
      if (promo) tempBoard[to.row][to.col].t=promo;
      if (moving.t==='k'&&Math.abs(to.col-from.col)===2){
        const row=from.row;
        if(to.col===6){const rf={r:row,c:7},rt={r:row,c:5};if(tempBoard[rf.row][rf.col]?.t==='r'){tempBoard[rt.row][rt.col]={...tempBoard[rf.row][rf.col]};tempBoard[rf.row][rf.col]=null;}}
        else if(to.col===2){const rf={r:row,c:0},rt={r:row,c:3};if(tempBoard[rf.row][rf.col]?.t==='r'){tempBoard[rt.row][rt.col]={...tempBoard[rf.row][rf.col]};tempBoard[rf.row][rf.col]=null;}}
      }
      if(isPawn&&diagonal&&targetEmpty){const dir=moving.col==='w'?1:-1,cap={r:to.row+dir,c:to.col};if(tempBoard[cap.row]?.[cap.col]?.t==='p'&&tempBoard[cap.row][cap.col]?.col!==moving.col)tempBoard[cap.row][cap.col]=null;}
      t=(t==='w'?'b':'w'); return null;
    }

    for (let i=0; i<moves.length; i++) {
      const err = tempApply(moves[i]);
      if (err) return `mismatch at move ${i+1} ("${moves[i]}"): ${err}`;
    }
    return null;
  }

  /* ═══════════════════════════════════════
     chessboard.js init
     — draggable disabled (click-to-move for puzzles)
     — same pieceTheme & square colours as Play page
  ═══════════════════════════════════════ */
  function onDragStart(source, piece) {
    if (!solution.length) return false;
    const color = piece[0];
    if ((turn === 'w' && color !== 'w') || (turn === 'b' && color !== 'b')) return false;
    return true;
  }

  function onDrop(source, target) {
    if (source === target || target === 'offboard') return 'snapback';
    if (!solution.length) return 'snapback';

    const expected = solution[idx] || '';
    if (source === expected.slice(0,2) && target === expected.slice(2,4)) {
      const res = applyMoveUci(expected);
      if (!res.ok) { showWrong(`Illegal: ${res.reason}`); return 'snapback'; }
      idx++;
      hideFeedback();
      renderBoard();
      if (idx === solution.length) {
        showSolved();
      } else {
        autoReplyIfAny();
      }
    } else {
      showWrong();
      return 'snapback';
    }
  }

  function initBoard() {
    board = Chessboard('board', {
      draggable:     true,
      dropOffBoard:  'snapback',
      position:      'start',
      orientation:   'white',
      pieceTheme:    './chessboardjs-1.0.0/img/chesspieces/wikipedia/{piece}.png',
      snapbackSpeed: 180,
      snapSpeed:     80,
      onDragStart:   onDragStart,
      onDrop:        onDrop,
    });
    window.addEventListener('resize', () => board.resize());
  }

  /* ═══════════════════════════════════════
     Apply puzzle helpers
  ═══════════════════════════════════════ */
  function applyPuzzle(p, label) {
    startFen = p.fen;
    solution = p.moves.map(m => m.toLowerCase());
    idx = 0; selectedSq = null;
    fromGamePuzzles = []; fromGameIndex = -1; fromGameGame = null;

    const id     = p.title || p._title || p.id || label;
    const rating = p.rating ? `~${p.rating} ELO` : 'unrated';
    const themes = p.themes || [];

    labId.textContent     = id;
    labRating.textContent = rating;
    sideId.textContent    = id;
    sideRating.textContent= rating;
    sideMoves.textContent = solution.length + ' moves';
    solRawEl.textContent  = solution.join(' ');
    setThemes(themes);

    parseFEN(p.fen);
    hideFeedback();
    clearInterval(autoTimer); autoTimer = null;
    renderBoard();

    const err = verifySolutionOnce(p.fen, solution);
    if (err) showWrong('Puzzle data inconsistent: ' + err);
  }

  async function loadDaily() {
    try {
      const r = await fetch('/puzzles/daily');
      const p = await r.json();
      if (!p?.fen || !Array.isArray(p.moves) || !p.moves.length) throw new Error();
      applyPuzzle(p, 'Daily puzzle');
    } catch { showFeedback('wrong', 'Failed to load daily puzzle.'); }
  }

  async function loadRandom() {
    try {
      const r = await fetch('/puzzles/random');
      const p = await r.json();
      if (!p?.fen || !Array.isArray(p.moves) || !p.moves.length) throw new Error();
      applyPuzzle(p, 'Random puzzle');
    } catch { showFeedback('wrong', 'Failed to load random puzzle.'); }
  }

  /* ═══════════════════════════════════════
     Games loading (original logic, untouched)
  ═══════════════════════════════════════ */
  function setGamesStatus(text) { gamesStatusEl.textContent = text; }

  function renderGamesList(data) {
    const username = (data.username||'').toLowerCase();
    const games = (Array.isArray(data.games)?data.games:[]).slice(-15).reverse();
    gamesListEl.innerHTML = '';
    // if (!games.length) { gamesListEl.innerHTML='<div style="padding:10px 4px;font-size:12px;color:var(--text-3)">No recent games found.</div>'; return; }
    games.forEach(g => {
      const youAreWhite=(g.white?.username||'').toLowerCase()===username;
      const youAreBlack=(g.black?.username||'').toLowerCase()===username;
      const youColor=youAreWhite?'White':youAreBlack?'Black':'?';
      const opp=youAreWhite?g.black?.username:youAreBlack?g.white?.username:(g.white?.username||'?');
      const yourResult=youAreWhite?g.white?.result:g.black?.result;
      const tc=g.time_class||g.time_control||'';
      const btn=document.createElement('button');
      btn.className='game-item';
      btn.innerHTML=`<span class="game-item-left">${youColor} vs ${opp||'—'}</span><span class="game-item-right">${yourResult||''} · ${tc}</span>`;
      btn.addEventListener('click',()=>startPuzzlesFromGame(username,g));
      gamesListEl.appendChild(btn);
    });
  }

  async function loadGamesForUser() {
    const username=usernameInput.value.trim();
    if (!username) { setGamesStatus('Enter a username'); return; }
    loadSpin.style.display='block';
    btnLoadGames.disabled=true;
    btnAnalyzeAll.style.display='none';
    setGamesStatus('Loading games…');
    gamesListEl.innerHTML='';
    fromGamePuzzles=[]; fromGameIndex=-1; fromGameGame=null;
    try {
      const res=await fetch(`/chesscom/${encodeURIComponent(username)}/games/recent`);
      if (!res.ok) { setGamesStatus('Error loading games'); loadSpin.style.display='none'; btnLoadGames.disabled=false; return; }
      const data=await res.json();
      fromGameUsername=username;
      renderGamesList(data);
      setGamesStatus('Games loaded — click a game or Analyze All');
      btnAnalyzeAll.style.display='block';
    } catch { setGamesStatus('Failed to load games'); gamesListEl.innerHTML='<div style="padding:10px 4px;font-size:12px;color:var(--text-3)">Network error.</div>'; }
    loadSpin.style.display='none';
    btnLoadGames.disabled=false;
  }

  async function analyzeAllGames() {
    const username=fromGameUsername||usernameInput.value.trim();
    if (!username) { setGamesStatus('Load games first'); return; }
    mlRunning=true;
    loadSpin.style.display='block';
    btnAnalyzeAll.disabled=true;
    btnLoadGames.disabled=true;
    renderGamesList({ username, games: [] }); // re-render to disable buttons
    // re-render the existing list with buttons disabled
    const existingItems=gamesListEl.querySelectorAll('.game-item');
    existingItems.forEach(b=>{ b.disabled=true; b.style.opacity='0.4'; b.style.cursor='not-allowed'; });
    setGamesStatus('Analyzing all games for puzzles…');
    try {
      const mlRes=await fetch('/puzzles/from-user-ml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,maxGames:15,maxPuzzles:200,movetimeMs:60})});
      if (!mlRes.ok) { setGamesStatus(`Error ${mlRes.status}`); }
      else {
        const mlData=await mlRes.json();
        const puzzles=Array.isArray(mlData.puzzles)?mlData.puzzles:[];
        if (!puzzles.length) { setGamesStatus('No puzzles found'); showFeedback('wrong','No suitable puzzles found in your recent games.'); }
        else {
          fromGamePuzzles=puzzles; fromGameIndex=0;
          applyGamePuzzleAt(0);
          setGamesStatus(`${puzzles.length} puzzles loaded`);
        }
      }
    } catch { setGamesStatus('ML analysis error'); }
    mlRunning=false;
    loadSpin.style.display='none';
    btnAnalyzeAll.disabled=false;
    btnLoadGames.disabled=false;
    // re-enable individual game buttons
    gamesListEl.querySelectorAll('.game-item').forEach(b=>{ b.disabled=false; b.style.opacity=''; b.style.cursor=''; });
  }

  async function startPuzzlesFromGame(username,game) {
    if (mlRunning) return;
    if (!game?.pgn) { showFeedback('wrong','That game has no PGN.'); return; }
    setGamesStatus('Building puzzles…'); hideFeedback();
    try {
      const res=await fetch('/puzzles/from-game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pgn:game.pgn,username,maxPuzzles:12})});
      const data=await res.json();
      if (!res.ok||!data.ok) throw new Error(data.error||'generation failed');
      const puzzles=Array.isArray(data.puzzles)?data.puzzles:[];
      if (!puzzles.length) { setGamesStatus('No puzzles in this game'); showFeedback('wrong','No suitable positions found in that game.'); return; }
      fromGamePuzzles=puzzles; fromGameGame=game; fromGameUsername=username; fromGameIndex=0;
      applyGamePuzzleAt(0);
      setGamesStatus(`${puzzles.length} puzzles in game`);
    } catch { setGamesStatus('Error building puzzles'); showFeedback('wrong','Failed to build puzzles from that game.'); }
  }

  function applyGamePuzzleAt(i) {
    if (!fromGamePuzzles.length||i<0||i>=fromGamePuzzles.length) return;
    fromGameIndex=i;
    const pz=fromGamePuzzles[i];
    const moves=(Array.isArray(pz.solutionMoves)&&pz.solutionMoves.length)?pz.solutionMoves:(Array.isArray(pz.moves)&&pz.moves.length)?pz.moves:pz.uci?[pz.uci]:[];
    startFen=pz.fen; solution=moves.map(m=>String(m).toLowerCase()); idx=0; selectedSq=null;
    const total=fromGamePuzzles.length;
    const id=pz.ml_score!=null?`Puzzle ${i+1} of ${total}`:`Move ${pz.moveNumber||pz.ply||(i+1)}`;
    const rating=pz.ml_score!=null?'From your games':(fromGameGame?.time_class||'');
    labId.textContent=id; labRating.textContent=rating;
    sideId.textContent=id; sideRating.textContent=rating; sideMoves.textContent=solution.length+' moves';
    setThemes(['from your games']);
    solRawEl.textContent=solution.length?solution.join(' '):'—';
    parseFEN(startFen); hideFeedback(); clearInterval(autoTimer); autoTimer=null; renderBoard();
    if (solution.length) { const err=verifySolutionOnce(startFen,solution); if (err) showWrong('Puzzle data inconsistent: '+err); }
  }

  /* ═══════════════════════════════════════
     Source switching
  ═══════════════════════════════════════ */
  function setSource(src) {
    activeSource=src;
    document.getElementById('btnDaily').classList.toggle('active', src==='daily');
    document.getElementById('btnRandom').classList.toggle('active', src==='random');
    document.getElementById('btnFromGames').classList.toggle('active', src==='fromgames');
    showFromGamesPanel(src==='fromgames');
  }

  document.getElementById('btnDaily').onclick    = () => { setSource('daily');     loadDaily(); };
  document.getElementById('btnRandom').onclick   = () => { setSource('random');    loadRandom(); };
  document.getElementById('btnFromGames').onclick= () => { setSource('fromgames'); };
  btnAnalyzeAll.onclick = analyzeAllGames;

  /* ═══════════════════════════════════════
     Controls
  ═══════════════════════════════════════ */
  document.getElementById('btnReset').onclick = () => {
    if (!startFen) return;
    parseFEN(startFen); idx=0; selectedSq=null;
    hideFeedback(); clearInterval(autoTimer); autoTimer=null; renderBoard();
  };

  document.getElementById('btnFlip').onclick = () => {
    whiteAtBottom=!whiteAtBottom;
    board.orientation(whiteAtBottom?'white':'black');
    renderBoard();
  };

  viewModeEl.addEventListener('change', () => {
    viewMode=viewModeEl.value; recomputeOrientation();
    board.orientation(whiteAtBottom?'white':'black');
    renderBoard();
  });

  document.getElementById('btnStep').onclick = () => {
    if (idx>=solution.length) return;
    const res=applyMoveUci(solution[idx]);
    if (res.ok) { idx++; renderBoard(); if (idx===solution.length) showSolved(); }
    else showWrong(`Illegal step: ${res.reason}`);
  };

  document.getElementById('btnAuto').onclick = () => {
    if (!solution.length||idx>=solution.length) return;
    clearInterval(autoTimer);
    autoTimer=setInterval(()=>{
      if (idx>=solution.length) { clearInterval(autoTimer); autoTimer=null; return; }
      const res=applyMoveUci(solution[idx]);
      if (res.ok) { idx++; renderBoard(); if (idx>=solution.length) { clearInterval(autoTimer); autoTimer=null; showSolved(); } }
      else { clearInterval(autoTimer); autoTimer=null; showWrong(`Illegal step: ${res.reason}`); }
    }, 300);
  };

  btnNextPuzzle.onclick = () => { if (!fromGamePuzzles.length) return; applyGamePuzzleAt((fromGameIndex+1)%fromGamePuzzles.length); };
  btnPrevPuzzle.onclick = () => { if (!fromGamePuzzles.length) return; applyGamePuzzleAt((fromGameIndex-1+fromGamePuzzles.length)%fromGamePuzzles.length); };

  btnLoadGames.onclick = loadGamesForUser;
  usernameInput.addEventListener('keydown', e => { if (e.key==='Enter') loadGamesForUser(); });

  /* ═══════════════════════════════════════
     Init
  ═══════════════════════════════════════ */
  initBoard();
  setSource('daily');
  loadDaily();
