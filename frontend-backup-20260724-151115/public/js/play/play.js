import {
  boardArrayToPosition,
  coordinatesToSquare,
  createStartingBoard,
  parseFen,
  parseSquare,
} from "../common/chess-utils.js";

let board, boardArray, whiteAtBottom = true, turn = 'w';
  let moveList = [], started = false, currentGameId = null;
  let epTarget = null, hintMove = null;

  const boardDiv  = document.getElementById('board');
  const playAsSel = document.getElementById('playAs');
  const diffRange = document.getElementById('difficulty');
  const diffLabel = document.getElementById('diffLabel');
  const msEl      = document.getElementById('ms');
  const depthEl   = document.getElementById('depth');
  const spinner   = document.getElementById('spinner');
  const thinkText = document.getElementById('thinkingText');
  const wClock    = document.getElementById('wClock');
  const bClock    = document.getElementById('bClock');

  let clocks = { w: 5*60*1000, b: 5*60*1000 };
  let clockTimer = null;

  function log(s) {
    const el = document.getElementById('log');
    if (el.textContent === '—') el.textContent = '';
    el.textContent = s + '\n' + el.textContent;
  }

  function setThinking(on) {
    spinner.style.display = on ? 'inline-block' : 'none';
    thinkText.textContent = on ? 'Thinking…' : '';
  }

  function resetClocks() {
    clocks = { w:5*60*1000, b:5*60*1000 };
    updateClocks();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  }

  function tick() {
    clocks[turn] -= 1000;
    updateClocks();
    if (clocks[turn] <= 0) endGame({ result:(turn==='w'?'0-1':'1-0'), reason:'timeout' });
  }

  function updateClocks() {
    wClock.textContent = fmt(clocks.w);
    bClock.textContent = fmt(clocks.b);
    wClock.classList.toggle('active', turn === 'w');
    bClock.classList.toggle('active', turn === 'b');
    wClock.classList.toggle('low', clocks.w < 30000);
    bClock.classList.toggle('low', clocks.b < 30000);
  }

  function fmt(ms) {
    ms = Math.max(ms, 0);
    const s = Math.floor(ms/1000), m = Math.floor(s/60), r = s%60;
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  }
    return pos;
  }

  function syncBoardPosition() {
    if (!board) return;
    board.position(boardArrayToPosition(boardArray), false);
    updateMoveList();
    clearSquareHighlights();
    highlightLastMove();
    highlightHint();
    updateClocks();
  }

  function updateMoveList() {
    const grid = document.getElementById('movesGrid');
    if (!moveList.length) {
      grid.innerHTML = '<span style="grid-column:1/-1;color:var(--text-3);font-size:11px;padding:3px 0;">No moves yet</span>';
      return;
    }
    let html = '';
    for (let i=0; i<moveList.length; i+=2) {
      const num = Math.floor(i/2)+1;
      const wm = moveList[i]||'', bm = moveList[i+1]||'';
      const wl = (i===moveList.length-1), bl = (i+1===moveList.length-1);
      html += `<span class="move-num">${num}.</span>`;
      html += `<span class="move-cell${wl?' latest':''}">${wm}</span>`;
      html += `<span class="move-cell${bl?' latest':''}">${bm}</span>`;
    }
    grid.innerHTML = html;
    grid.scrollTop = grid.scrollHeight;
  }

  function clearSquareHighlights() { $('#board .square-55d63').removeClass('last-move hint-square'); }
  function addSquareClass(sq,cls)   { $('#board .square-'+sq).addClass(cls); }

  function highlightLastMove() {
    if (!moveList.length) return;
    const last = moveList[moveList.length-1];
    if (last.length<4) return;
    addSquareClass(last.slice(0,2),'last-move');
    addSquareClass(last.slice(2,4),'last-move');
  }

  function highlightHint() {
    if (!hintMove||hintMove.length<4) return;
    addSquareClass(hintMove.slice(0,2),'hint-square');
    addSquareClass(hintMove.slice(2,4),'hint-square');
  }

  function promoSuffix(moving,to) {
    if (moving.t!=='p') return '';
    if (moving.col==='w'&&to.row===0) return 'q';
    if (moving.col==='b'&&to.row===7) return 'q';
    return '';
  }

  function updateEpTarget(moving,from,to) {
    epTarget = null;
    if (moving.t==='p'&&from.col===to.col&&Math.abs(to.row-from.row)===2)
      epTarget = {r:(from.row+to.row)>>1,c:from.col};
  }

  function handleSpecialMoves(moving,from,to) {
    if (moving.t==='k'&&Math.abs(to.col-from.col)===2) {
      const row=from.row;
      if (to.col===6) {
        const rf={r:row,c:7},rt={r:row,c:5};
        if (boardArray[rf.row][rf.col]?.t==='r') { boardArray[rt.row][rt.col]={...boardArray[rf.row][rf.col]}; boardArray[rf.row][rf.col]=null; }
      } else if (to.col===2) {
        const rf={r:row,c:0},rt={r:row,c:3};
        if (boardArray[rf.row][rf.col]?.t==='r') { boardArray[rt.row][rt.col]={...boardArray[rf.row][rf.col]}; boardArray[rf.row][rf.col]=null; }
      }
    }
    if (moving.t==='p') {
      const isDiag=from.col!==to.col, targEmpty=boardArray[to.row][to.col]==null;
      if (isDiag&&targEmpty&&epTarget&&epTarget.row===to.row&&epTarget.col===to.col) {
        const cap={r:moving.col==='w'?to.row+1:to.row-1,c:to.col};
        if (boardArray[cap.row]?.[cap.col]?.t==='p'&&boardArray[cap.row][cap.col]?.col!==moving.col)
          boardArray[cap.row][cap.col]=null;
      }
    }
  }

  function endGame({result='*',reason=null,pgn=null}={}) {
    if (clockTimer) { clearInterval(clockTimer); clockTimer=null; }
    started=false;
    boardDiv.classList.add('board-disabled');
    setThinking(false);
    thinkText.textContent='Game over';
    const labels={checkmate:'Checkmate',stalemate:'Stalemate','threefold repetition':'Draw · Threefold','insufficient material':'Draw · Material',draw:'Draw',timeout:'Timeout'};
    const title=labels[reason]||'Game Over';
    const banner=document.getElementById('gameBanner');
    banner.innerHTML=`<strong>${title}</strong> <span style="opacity:.5">·</span> ${result}`;
    banner.style.display='block';
    if (pgn) log('PGN:\n'+pgn);
    log(`[over] ${result}${reason?' · '+reason:''}`);
  }

  function startPosition() {
    boardArray = createStartingBoard().map(rank => rank.map(piece => piece ? ({ c: piece.color, t: piece.type }) : null));
    turn='w'; moveList=[]; started=true;
    setThinking(false); epTarget=null; hintMove=null;
    boardDiv.classList.remove('board-disabled');
    document.getElementById('gameBanner').style.display='none';
    thinkText.textContent='';
    resetClocks();
    if (board) board.orientation(whiteAtBottom?'white':'black');
    syncBoardPosition();
  }

  function initBoard() {
    board = Chessboard('board', {
      draggable:     true,
      dropOffBoard:  'snapback',
      sparePieces:   false,
      orientation:   whiteAtBottom?'white':'black',
      pieceTheme:    './chessboardjs-1.0.0/img/chesspieces/wikipedia/{piece}.png',
      snapbackSpeed: 180,
      snapSpeed:     80,

      onDragStart(source,piece) {
        if (!started) return false;
        if (playAsSel.value!==turn) return false;
        const color=piece[0];
        if ((turn==='w'&&color!=='w')||(turn==='b'&&color!=='b')) return false;
        return true;
      },

      onDrop(source,target) {
        if (source===target) return 'snapback';
        return handlePlayerDrop(source,target);
      }
    });

    syncBoardPosition();
    window.addEventListener('resize',()=>board.resize());
  }

  async function handlePlayerDrop(source,target) {
    if (target==='offboard') return 'snapback';
    if (!started) return 'snapback';
    if (playAsSel.value!==turn) return 'snapback';
    if (source===target) return 'snapback';

    const from=parseSquare(source), to=parseSquare(target);
    const moving=boardArray[from.row]?.[from.col];
    const targetPiece=boardArray[to.row]?.[to.col];
    if (!moving) return 'snapback';
    if (moving.col!==turn) return 'snapback';
    if (targetPiece&&targetPiece.col===moving.col) return 'snapback';

    const uci=source+target+promoSuffix(moving,to);
    const prevBoard=boardArray.map(row=>row.map(c=>c?{...col}:null));
    const prevTurn=turn, prevMoves=moveList.slice();
    const prevEp=epTarget?{...epTarget}:null, prevHint=hintMove;

    boardArray[to.row][to.col]={...moving};
    boardArray[from.row][from.col]=null;
    if (uci[4]) boardArray[to.row][to.col].t=uci[4];
    handleSpecialMoves(moving,from,to);
    moveList.push(uci);
    turn=(turn==='w'?'b':'w');
    updateEpTarget(moving,from,to);
    hintMove=null;
    syncBoardPosition();

    if (currentGameId) {
      try {
        const r=await fetch(`/game/${currentGameId}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uci})});
        if (!r.ok) {
          const err=await r.json().catch(()=>({}));
          boardArray=prevBoard; turn=prevTurn; moveList=prevMoves; epTarget=prevEp; hintMove=prevHint;
          syncBoardPosition(); log(`[illegal] ${uci} (${err.error||r.status})`); return 'snapback';
        }
        const jr=await r.json();
        if (jr.over) { endGame({result:jr.result,reason:jr.reason,pgn:jr.pgn}); return; }
      } catch(e) {
        boardArray=prevBoard; turn=prevTurn; moveList=prevMoves; epTarget=prevEp; hintMove=prevHint;
        syncBoardPosition(); log(`[error] ${e?.message||e}`); return 'snapback';
      }
    }

    if (playAsSel.value!==turn) engineMove();
  }

  async function applyEngineBestmove(uci) {
    if (!uci||uci.length<4) return;
    const from=parseSquare(uci.slice(0,2)), to=parseSquare(uci.slice(2,4));
    const moving=boardArray[from.row]?.[from.col];
    if (!moving) { log(`[engine] no piece at ${uci.slice(0,2)}`); return; }
    const moved={...moving};
    if (uci[4]) moved.t=uci[4];
    boardArray[to.row][to.col]=moved;
    boardArray[from.row][from.col]=null;
    handleSpecialMoves(moving,from,to);
    moveList.push(uci);
    turn=(turn==='w'?'b':'w');
    updateEpTarget(moving,from,to);
    hintMove=null;
    syncBoardPosition();
    log(`[engine] ${uci}`);

    if (currentGameId) {
      try {
        const r=await fetch(`/game/${currentGameId}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uci})});
        if (!r.ok) { const e=await r.json().catch(()=>({})); log(`[engine persist] ${e.error||r.status}`); return; }
        const jr=await r.json();
        if (jr.over) endGame({result:jr.result,reason:jr.reason,pgn:jr.pgn});
      } catch(e) { log(`[engine persist] ${e?.message||e}`); }
    }
  }

  async function engineMove() {
    if (!started) return;
    setThinking(true);
    try {
      try {
        const br=await fetch('/bookmove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moves:moveList})});
        const b=await br.json();
        if (b.bookmove) { setThinking(false); await applyEngineBestmove(b.bookmove); log(`[book] ${b.bookmove}`); return; }
      } catch(_) {}

      const depth=depthEl.value?Number(depthEl.value):null;
      const diff=Number(diffRange.value||2);
      const diffMs=[250,500,1000,2000,4000][diff-1];
      const mtMs=depth?Number(msEl.value||500):diffMs;

      const r=await fetch('/bestmove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moves:moveList,movetimeMs:mtMs,depth:depth||null,wtime:clocks.w,btime:clocks.b,winc:0,binc:0})});
      const data=await r.json();
      setThinking(false);
      if (data.bestmove) await applyEngineBestmove(data.bestmove);
      else log(`[engine error]\n${data.raw||''}`);
    } catch(e) { setThinking(false); log('fetch /bestmove failed: '+(e?.message||e)); }
  }

  async function requestHint() {
    if (!started) return;
    setThinking(true);
    try {
      const depth=depthEl.value?Number(depthEl.value):null;
      const diff=Number(diffRange.value||2);
      const diffMs=[250,500,1000,2000,4000][diff-1];
      const mtMs=depth?Number(msEl.value||500):Math.min(diffMs,1000);

      const r=await fetch('/bestmove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moves:moveList,movetimeMs:mtMs,depth:depth||null,wtime:clocks.w,btime:clocks.b,winc:0,binc:0})});
      const data=await r.json();
      setThinking(false);
      if (data.bestmove) { hintMove=data.bestmove; syncBoardPosition(); log(`[hint] ${data.bestmove}`); }
      else log(`[hint error]\n${data.raw||''}`);
    } catch(e) { setThinking(false); log('hint failed: '+(e?.message||e)); }
  }

  document.getElementById('new').onclick = async () => {
    try {
      const r=await fetch('/game/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time_control:'300+0'})});
      const g=await r.json(); currentGameId=g.gameId||null;
    } catch(_) { currentGameId=null; }
    whiteAtBottom=(playAsSel.value==='w');
    startPosition();
    if (playAsSel.value==='b') engineMove();
  };

  document.getElementById('flip').onclick = () => {
    whiteAtBottom=!whiteAtBottom;
    if (board) board.orientation(whiteAtBottom?'white':'black');
    syncBoardPosition();
  };

  document.getElementById('engineMove').onclick = () => {
    if (started&&playAsSel.value!==turn) engineMove();
  };

  document.getElementById('finish').onclick = async () => {
    if (!started) { log('No active game.'); return; }
    if (!currentGameId) { endGame({result:'*',reason:'draw'}); log('Ended locally.'); return; }
    try {
      const r=await fetch(`/game/${currentGameId}/finish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:'*'})});
      const data=await r.json();
      endGame({result:data.result||'*',reason:data.reason||'draw',pgn:data.pgn||null});
    } catch(e) { log('finish failed: '+(e?.message||e)); }
  };

  document.getElementById('hintBtn').onclick = () => {
    if (!started) { log('Start a game first.'); return; }
    requestHint();
  };

  diffRange.addEventListener('input', () => { diffLabel.textContent=`${diffRange.value}/5`; });

  window.addEventListener('keydown', e => {
    if (e.key==='n'||e.key==='N') document.getElementById('new').click();
    if (e.key==='f'||e.key==='F') document.getElementById('flip').click();
    if (e.key==='e'||e.key==='E') document.getElementById('engineMove').click();
  });

  boardArray = createStartingBoard().map(rank => rank.map(piece => piece ? ({ c: piece.color, t: piece.type }) : null));
  initBoard();
  syncBoardPosition();
