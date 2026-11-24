// Pebblepack game: board rendering, the stone tray, and placing stones by drag or tap.
(function () {
  "use strict";
  const { ROWS, COLS, N, PIECES, LETTERS, normalize, rotate, flip, generatePuzzle } = Engine;

  /* =====================================================================
     Stones: colours, names and their slightly irregular shapes
     ===================================================================== */
  const STONES = {
    A: { c: '#ffd21f', name: 'Lemon' },
    B: { c: '#1fd3c4', name: 'Aqua' },
    C: { c: '#4466ff', name: 'Cobalt' },
    D: { c: '#9a5cff', name: 'Violet' },
    E: { c: '#ff8a1f', name: 'Tangerine' },
    F: { c: '#a6f5c8', name: 'Mint' },
    G: { c: '#ec3fd3', name: 'Fuchsia' },
    H: { c: '#3cbcff', name: 'Sky' },
    I: { c: '#45c652', name: 'Leaf' },
    J: { c: '#ff8fc0', name: 'Rose' },
    K: { c: '#f3f4ff', name: 'Pearl' },
    L: { c: '#ec2843', name: 'Cherry' },
  };

  // Deterministic "random" so each stone keeps its shape between renders.
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
  }
  function stoneStyle(key) {
    let h = hash(key);
    const r = () => { h = hash(h + 1); return 32 + (h % 36); };        // 32-67%: lopsided, pebble-like
    const shape = `${r()}% ${r()}% ${r()}% ${r()}% / ${r()}% ${r()}% ${r()}% ${r()}%`;
    h = hash(h + 7);
    const tilt = ((h % 31) - 15) + 'deg';                                 // -15..15deg
    h = hash(h + 3);
    const sx = (0.9 + (h % 13) / 100).toFixed(2);                         // 0.90-1.02 wide
    const sy = (0.86 + ((h >>> 8) % 11) / 100).toFixed(2);                // 0.86-0.96 tall
    return { shape, tilt, sx, sy };
  }

  // Paint one cell (board, tray or floater) as a stone of `letter`, joined right/down as needed.
  function paintCell(el, letter, key, joinRight, joinDown) {
    el.classList.toggle('jr', !!(letter && joinRight));
    el.classList.toggle('jd', !!(letter && joinDown));
    let stone = el.firstElementChild;
    if (!letter) { if (stone) stone.remove(); el.style.removeProperty('--c'); return; }
    if (!stone) { stone = document.createElement('span'); stone.className = 'pp-stone'; el.appendChild(stone); }
    const { shape, tilt, sx, sy } = stoneStyle(key);
    el.style.setProperty('--c', STONES[letter].c);
    stone.style.setProperty('--shape', shape);
    stone.style.setProperty('--tilt', tilt);
    stone.style.setProperty('--sx', sx);
    stone.style.setProperty('--sy', sy);
  }

  /* =====================================================================
     DOM
     ===================================================================== */
  const $ = id => document.getElementById(id);
  const boardEl = $('pp-board'), trayEl = $('pp-tray'), statusEl = $('pp-status');
  const startInput = $('pp-start');
  const cells = [];
  for (let i = 0; i < N; i++) {
    const b = document.createElement('button');
    b.className = 'pp-cell';
    b.setAttribute('role', 'gridcell');
    b.dataset.i = i;
    boardEl.appendChild(b);
    cells.push(b);
  }
  const say = msg => { statusEl.textContent = msg; };

  /* =====================================================================
     State
     ===================================================================== */
  let puzzle = null;        // { start, solution } from the engine
  let placed = new Map();   // letter -> board indexes, for stones the player has placed
  let orient = {};          // letter -> current orientation (normalized cells) in the tray
  let history = [];         // snapshots of `placed`, for Undo
  let selected = null;      // letter picked in the tray
  let ghost = null;         // preview: { letter, grab, tr, tc, idxs, ok }
  let press = null;         // pointer that is down on a stone (may become a drag)
  let drag = null;          // active drag: { letter, grab, fromBoard, floater }
  let suppressClick = false;
  let hintsUsed = 0;
  let boardVersion = 0;     // bumps on every change, so a slow Check/Hint answer for an older board is ignored
  let busy = false;         // a Check or Hint is running
  let winShown = false;     // the "Solved!" card is showing

  /* =====================================================================
     Check and Hint run in a background worker so a hard board never freezes
     the page. If workers aren't available, they run here instead.
     ===================================================================== */
  const runHere = (op, board, preferred) =>
    op === 'check' ? { solvable: Engine.check(board).solvable } : Engine.hint(board, preferred);
  let worker = null, nextId = 1;
  const pending = new Map();   // id -> { resolve, op, board, preferred }
  try {
    worker = new Worker('engine-worker.js');
    worker.onmessage = e => {
      const p = pending.get(e.data.id);
      if (p) { pending.delete(e.data.id); p.resolve(e.data.result); }
    };
    worker.onerror = () => {   // fall back for anything in flight, and for everything after
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); p.resolve(runHere(p.op, p.board, p.preferred)); }
    };
  } catch (err) { worker = null; }

  /* =====================================================================
     Clock: starts on the first move, pauses while the page is hidden,
     stops for good when the puzzle is solved.
     ===================================================================== */
  const clock = { elapsed: 0, since: null, done: false };
  const elapsed = () => clock.elapsed + (clock.since ? Date.now() - clock.since : 0);
  function startClock() { if (!clock.done && !clock.since) { clock.since = Date.now(); showTime(); } }
  function pauseClock() { if (clock.since) { clock.elapsed = elapsed(); clock.since = null; } }
  function stopClock() { pauseClock(); clock.done = true; }
  function fmt(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  function showTime() { $('pp-time').textContent = fmt(elapsed()); }
  let ticks = 0;
  setInterval(() => {
    if (!clock.since) return;
    showTime();
    if (++ticks % 20 === 0) save();    // every ~5s, in case a phone closes the tab without warning
  }, 250);

  let pausedByHiding = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pausedByHiding = !!clock.since; pauseClock(); save(); }
    else if (pausedByHiding) { pausedByHiding = false; startClock(); }
  });
  window.addEventListener('pagehide', () => save());

  /* =====================================================================
     Saved on this device: best times, and the puzzle in progress.
     Storage can be blocked (private mode, strict settings); the game then
     just plays without remembering.
     ===================================================================== */
  const BEST_KEY = 'pebblepack.best.v1', GAME_KEY = 'pebblepack.game.v1';
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; } }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* not saved */ } }
  const bestFor = count => (load(BEST_KEY) || {})[count] ?? null;
  function recordBest(count, ms) {
    const all = load(BEST_KEY) || {};
    const prev = all[count] ?? null;
    if (prev === null || ms < prev) { all[count] = ms; store(BEST_KEY, all); }
    return prev;
  }

  function save() {
    if (!puzzle) return;
    store(GAME_KEY, {
      v: 1,
      start: puzzle.start, solution: puzzle.solution, startCount: puzzle.startCount,
      placed: [...placed], orient, history: history.map(m => [...m]),
      hintsUsed, elapsed: elapsed(), done: clock.done,
    });
  }

  // Put back a saved, unfinished puzzle. Returns false if there's nothing usable to restore.
  function restore() {
    const s = load(GAME_KEY);
    if (!s || s.v !== 1 || s.done) return false;
    const okBoard = b => Array.isArray(b) && b.length === N && b.every(x => x === null || LETTERS.includes(x));
    if (!okBoard(s.start) || !okBoard(s.solution) || !Array.isArray(s.placed)) return false;
    const taken = s.start.slice();
    for (const [l, idxs] of s.placed) {
      if (!LETTERS.includes(l) || taken.includes(l) || !Array.isArray(idxs)) return false;
      for (const i of idxs) { if (!(i >= 0 && i < N) || taken[i]) return false; taken[i] = l; }
    }
    if (Engine.invalidPieces(taken).length) return false;
    puzzle = { start: s.start, solution: s.solution, startCount: s.startCount };
    placed = new Map(s.placed);
    history = (s.history || []).map(m => new Map(m));
    orient = Object.fromEntries(LETTERS.map(l => [l, Array.isArray(s.orient?.[l]) ? s.orient[l] : normalize(PIECES[l].cells)]));
    hintsUsed = s.hintsUsed | 0;
    clock.elapsed = +s.elapsed || 0; clock.since = null; clock.done = false;
    selected = null; ghost = null; winShown = false; boardVersion++;
    startInput.value = puzzle.startCount; $('pp-startval').textContent = puzzle.startCount;
    return true;
  }

  function ask(op, board, preferred) {
    if (!worker) return Promise.resolve(runHere(op, board, preferred));
    return new Promise(resolve => {
      const id = nextId++;
      pending.set(id, { resolve, op, board, preferred });
      worker.postMessage({ id, op, board, preferred });
    });
  }

  const rcOf = i => [(i / COLS) | 0, i % COLS];
  const name = l => STONES[l].name;

  // Board contents: given stones plus the player's, optionally leaving one letter out.
  function occupancy(skip) {
    const b = puzzle.start.slice();
    for (const [l, idxs] of placed) if (l !== skip) for (const i of idxs) b[i] = l;
    return b;
  }
  const isGiven = i => !!puzzle.start[i];
  function ownerAt(i) { for (const [l, idxs] of placed) if (idxs.includes(i)) return l; return null; }
  const inTray = () => LETTERS.filter(l => !puzzle.start.includes(l) && !placed.has(l));

  // The ball nearest the middle of a shape: used as the grab point for taps and rotations.
  function centerCell(shape) {
    const mr = shape.reduce((s, c) => s + c[0], 0) / shape.length;
    const mc = shape.reduce((s, c) => s + c[1], 0) / shape.length;
    let best = shape[0], d = Infinity;
    for (const c of shape) {
      const dd = (c[0] - mr) ** 2 + (c[1] - mc) ** 2;
      if (dd < d - 1e-9) { d = dd; best = c; }
    }
    return best.slice();
  }

  // Where `letter` lands if the ball `grab` is held over board cell (tr, tc).
  function makeGhost(letter, grab, tr, tc) {
    const occ = occupancy(letter);
    const idxs = [];
    let inside = true;
    for (const [r, c] of orient[letter]) {
      const R = tr + r - grab[0], C = tc + c - grab[1];
      if (R < 0 || R >= ROWS || C < 0 || C >= COLS) { inside = false; continue; }
      idxs.push(R * COLS + C);
    }
    const ok = inside && idxs.every(i => !occ[i]);
    return { letter, grab, tr, tc, idxs, ok };
  }

  /* =====================================================================
     Actions (each one that changes the board can be undone)
     ===================================================================== */
  function snapshot() { history.push(new Map([...placed].map(([l, v]) => [l, v.slice()]))); }

  const isFull = () => occupancy().every(Boolean);

  function place(letter, idxs, how) {
    startClock();
    snapshot();
    placed.set(letter, idxs.slice().sort((a, b) => a - b));
    orient[letter] = normalize(idxs.map(rcOf));
    if (selected === letter) selected = null;
    ghost = null;
    boardVersion++;
    if (isFull()) { win(); return; }
    const left = inTray().length;
    say(how === 'hint' ? `Hint: ${name(letter)} goes here. ${left} to go.` : `${name(letter)} placed. ${left} to go.`);
  }

  function liftToTray(letter, msg) {
    startClock();
    snapshot();
    const idxs = placed.get(letter);
    placed.delete(letter);
    orient[letter] = normalize(idxs.map(rcOf));      // keep the orientation it had on the board
    selected = letter;
    ghost = null;
    boardVersion++;
    winShown = false;
    say(msg || `${name(letter)} is back in your tray.`);
  }

  function undo() {
    if (!history.length) return;
    placed = history.pop();
    ghost = null;
    boardVersion++;
    winShown = false;
    if (selected && !inTray().includes(selected)) selected = null;
    say('Undone.');
    render();
  }

  /* ---------- Hint, Check and winning ---------- */
  function setBusy(on, msg) {
    busy = on;
    if (msg) say(msg);
    render();
  }

  async function runHint() {
    if (busy) return;
    if (isFull()) { say('The board is already full.'); return; }
    startClock();
    const v = boardVersion;
    setBusy(true, 'Finding a hint…');
    const h = await ask('hint', occupancy(), puzzle.solution);
    setBusy(false);
    if (v !== boardVersion) { say('The board changed while I was looking. Tap Hint again.'); return; }
    if (!h) {
      say("No hint: this board can't be finished as it is. Undo or move one of your stones first.");
      flashBoard('bad');
      return;
    }
    hintsUsed++;
    place(h.letter, h.idxs, 'hint');
    render();
    flashCells(h.idxs);
  }

  async function runCheck() {
    if (busy) return;
    if (isFull()) { say('Solved already. Every stone is in.'); return; }
    startClock();
    const v = boardVersion;
    setBusy(true, 'Checking…');
    const r = await ask('check', occupancy());
    setBusy(false);
    if (v !== boardVersion) { say('The board changed while I was checking. Tap Check again.'); return; }
    if (r.solvable) { say('Still solvable. Keep going!'); flashBoard('good'); }
    else { say("Stuck: this board can't be finished. One of your stones needs to move."); flashBoard('bad'); }
  }

  function win() {
    if (clock.done) {                 // solved before, then undone and finished again: no second record
      winShown = true;
      say('');
      cheer();
      return;
    }
    stopClock();
    showTime();
    winShown = true;
    const ms = elapsed(), h = hintsUsed, k = puzzle.startCount;
    $('pp-winline').textContent = `Time ${fmt(ms)} · ` + (h === 0 ? 'no hints.' : `${h} hint${h === 1 ? '' : 's'}.`);
    let bestLine;
    if (h > 0) {
      const b = bestFor(k);
      bestLine = `Solves with hints don't count toward your best${b !== null ? ` (${fmt(b)} with ${k} starting stones)` : ''}.`;
    } else {
      const prev = recordBest(k, ms);
      bestLine = prev === null ? `First solve with ${k} starting stones. That's your best to beat.`
        : ms < prev ? `New best with ${k} starting stones! (was ${fmt(prev)})`
        : `Your best with ${k} starting stones: ${fmt(prev)}.`;
    }
    $('pp-winbest').textContent = bestLine;
    say('');
    cheer();
  }

  // Short-lived classes for the animations (they do nothing when the device asks for reduced motion).
  function pulseClass(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;               // restart the animation if it's already running
    el.classList.add(cls);
    clearTimeout(el['_t' + cls]);
    el['_t' + cls] = setTimeout(() => el.classList.remove(cls), ms);
  }
  const woodEl = document.querySelector('.pp-wood');
  const flashBoard = kind => pulseClass(woodEl, kind === 'good' ? 'flash-good' : 'flash-bad', 950);
  const flashCells = idxs => idxs.forEach(i => pulseClass(cells[i], 'hinted', 1500));
  function cheer() {
    cells.forEach((el, i) => el.style.setProperty('--delay', ((i % COLS) * 40 + ((i / COLS) | 0) * 25) + 'ms'));
    pulseClass(boardEl, 'cheering', 1300);
  }

  function turn(how) {
    const l = drag ? drag.letter : selected;
    if (!l) { say('Pick a stone from the tray first.'); return; }
    orient[l] = how === 'flip' ? flip(orient[l]) : rotate(orient[l]);
    const grab = centerCell(orient[l]);
    if (drag) {
      drag.grab = grab;
      drag.floater.remove();
      drag.floater = buildFloater(l);
      moveDrag(drag.lastX, drag.lastY, drag.lastTouch);
    } else if (ghost && ghost.letter === l) {
      ghost = makeGhost(l, grab, ghost.tr, ghost.tc);
    }
    render();
  }

  function newPuzzle() {
    puzzle = generatePuzzle(+startInput.value);
    placed = new Map();
    history = [];
    orient = Object.fromEntries(LETTERS.map(l => [l, normalize(PIECES[l].cells)]));
    selected = null;
    ghost = null;
    hintsUsed = 0;
    winShown = false;
    boardVersion++;
    clock.elapsed = 0; clock.since = null; clock.done = false;
    showTime();
    say('Drag a stone onto the board, or tap one and then tap where it goes.');
    render();
    popIn();
  }

  /* =====================================================================
     Rendering
     ===================================================================== */
  function renderBoard() {
    const view = occupancy(drag && drag.fromBoard ? drag.letter : null);
    const ghostAt = new Set(), clash = new Set();
    if (ghost) for (const i of ghost.idxs) {
      if (!view[i]) { view[i] = ghost.letter; ghostAt.add(i); }
      else clash.add(i);                               // already taken: ring it so the player sees why it doesn't fit
    }
    for (let i = 0; i < N; i++) {
      const l = view[i], [r, c] = rcOf(i), el = cells[i];
      const g = ghostAt.has(i);
      // Join only stones of the same kind: a preview never joins the real stones around it.
      const same = j => view[j] === l && ghostAt.has(j) === g;
      paintCell(el, l, i * 131 + (l ? l.charCodeAt(0) : 0), c < COLS - 1 && same(i + 1), i + COLS < N && same(i + COLS));
      el.classList.toggle('ghost', g);
      el.classList.toggle('bad', g && !ghost.ok);
      el.classList.toggle('clash', clash.has(i));
      el.classList.toggle('mine', !!l && !g && !isGiven(i));
      const what = !l ? 'empty' : g ? `${name(l)} preview${ghost.ok ? '' : ", doesn't fit"}` : `${name(l)} stone${isGiven(i) ? ', fixed' : ''}`;
      el.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ${what}`);
    }
  }

  // A piece drawn as a small grid of stones. `unit`/`gap` in px; balls carry data-r/data-c for grabbing.
  function cluster(letter, unit, gap) {
    const shape = orient[letter];
    const rows = Math.max(...shape.map(c => c[0])) + 1, cols = Math.max(...shape.map(c => c[1])) + 1;
    const on = new Set(shape.map(([r, c]) => r * cols + c));
    const wrap = document.createElement('span');
    wrap.className = 'pp-mini';
    wrap.style.setProperty('--cols', cols);
    if (unit) { wrap.style.setProperty('--u', unit + 'px'); wrap.style.setProperty('--gap', gap + 'px'); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const s = document.createElement('span');
      s.className = 'pp-cell' + (on.has(idx) ? '' : ' pp-empty');
      if (on.has(idx)) {
        s.dataset.r = r; s.dataset.c = c;
        paintCell(s, letter, idx * 977 + letter.charCodeAt(0), c < cols - 1 && on.has(idx + 1), on.has(idx + cols));
      }
      wrap.appendChild(s);
    }
    return wrap;
  }

  function renderTray() {
    trayEl.textContent = '';
    for (const l of inTray()) {
      const b = document.createElement('button');
      b.className = 'pp-piece' + (drag && !drag.fromBoard && drag.letter === l ? ' lifting' : '');
      b.dataset.letter = l;
      b.setAttribute('aria-pressed', String(l === selected));
      b.setAttribute('aria-label', `${name(l)}, ${PIECES[l].cells.length} stones${l === selected ? ', selected: tap again to rotate' : ''}`);
      b.appendChild(cluster(l));
      trayEl.appendChild(b);
    }
    if (!trayEl.children.length) {
      const note = document.createElement('p');
      note.className = 'pp-traynote';
      note.textContent = 'All your stones are on the board.';
      trayEl.appendChild(note);
    }
    $('pp-selname').textContent = selected ? name(selected) : '';
  }

  function render() {
    renderBoard();
    renderTray();
    const onBoard = new Set(puzzle.start.filter(Boolean)).size + placed.size;
    $('pp-count').textContent = `${onBoard}/12`;
    $('pp-undo').disabled = history.length === 0;
    const full = onBoard === 12;
    $('pp-rotate').disabled = $('pp-flip').disabled = !selected && !drag;
    $('pp-hint').disabled = busy || full;
    $('pp-check').disabled = busy || full;
    $('pp-win').hidden = !(full && winShown);
    statusEl.hidden = full && winShown;              // the card takes the message line's place
    const best = bestFor(puzzle.startCount);
    $('pp-best').textContent = best === null ? '–' : fmt(best);
    $('pp-best').parentElement.title = `Your best time with ${puzzle.startCount} starting stones, without hints`;
    save();
  }

  // Stones bounce in, sweeping left to right, whenever a new puzzle appears.
  function popIn() {
    cells.forEach((el, i) => el.style.setProperty('--delay', ((i % COLS) * 28 + ((i / COLS) | 0) * 14) + 'ms'));
    boardEl.classList.remove('popping');
    void boardEl.offsetWidth;
    boardEl.classList.add('popping');
    clearTimeout(popIn.t);
    popIn.t = setTimeout(() => boardEl.classList.remove('popping'), 900);
  }

  /* =====================================================================
     Dragging (mouse, pen and touch share one path)
     ===================================================================== */
  const DRAG_START_PX = 7;

  function boardMetrics() {
    const a = cells[0].getBoundingClientRect(), b = cells[1].getBoundingClientRect();
    return { left: a.left, top: a.top, size: a.width, pitch: b.left - a.left };
  }
  // Board cell under a screen point, or null when the point is off the board.
  function boardHit(x, y) {
    const m = boardMetrics(), half = (m.pitch - m.size) / 2;
    const c = Math.floor((x - m.left + half) / m.pitch);
    const r = Math.floor((y - m.top + half) / m.pitch);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? [r, c] : null;
  }

  function buildFloater(letter) {
    const m = boardMetrics();
    const el = cluster(letter, m.size, m.pitch - m.size);
    el.classList.add('pp-floater');
    document.body.appendChild(el);
    return el;
  }

  function beginDrag() {
    const { letter, grab, fromBoard } = press;
    drag = { letter, grab, fromBoard, floater: null, lastX: press.x0, lastY: press.y0, lastTouch: press.touch };
    selected = letter;
    ghost = null;
    drag.floater = buildFloater(letter);
    document.body.classList.add('pp-dragging');
    render();
  }

  function moveDrag(x, y, touch) {
    drag.lastX = x; drag.lastY = y; drag.lastTouch = touch;
    const m = boardMetrics();
    // On touch, hold the piece a little above the fingertip so the finger doesn't hide it.
    const lift = touch ? m.pitch * 1.1 : 0;
    const gx = x, gy = y - lift;
    const hit = boardHit(gx, gy);
    ghost = hit ? makeGhost(drag.letter, drag.grab, hit[0], hit[1]) : null;
    // Over the board the snapped preview shows where it lands; elsewhere the piece follows the pointer.
    drag.floater.style.visibility = hit ? 'hidden' : 'visible';
    const ox = drag.grab[1] * m.pitch + m.size / 2, oy = drag.grab[0] * m.pitch + m.size / 2;
    drag.floater.style.transform = `translate(${gx - ox}px, ${gy - oy}px)`;
    renderBoard();
  }

  function endDrag(dropped) {
    const { letter, fromBoard } = drag;
    const g = ghost;
    drag.floater.remove();
    drag = null;
    document.body.classList.remove('pp-dragging');
    if (dropped && g && g.ok) {
      place(letter, g.idxs);
    } else if (dropped && !g && fromBoard) {
      liftToTray(letter);
    } else if (dropped && g) {
      ghost = null;
      say(`${name(letter)} doesn't fit there.${fromBoard ? ' It went back to where it was.' : ''}`);
    } else {
      ghost = null;
    }
    render();
  }

  function startPress(e, info) {
    if (e.button !== undefined && e.button !== 0) return;
    press = { ...info, id: e.pointerId, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch' };
  }

  trayEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('.pp-piece');
    if (!b) return;
    const l = b.dataset.letter;
    const ball = e.target.closest('[data-r]');
    const grab = ball ? [+ball.dataset.r, +ball.dataset.c] : centerCell(orient[l]);
    startPress(e, { letter: l, grab, fromBoard: false });
  });

  boardEl.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.pp-cell');
    if (!cell) return;
    const i = +cell.dataset.i, l = ownerAt(i);
    if (!l) return;                                    // only the player's own stones can be dragged
    const idxs = placed.get(l);
    orient[l] = normalize(idxs.map(rcOf));
    const minR = Math.min(...idxs.map(j => rcOf(j)[0])), minC = Math.min(...idxs.map(j => rcOf(j)[1]));
    const [r, c] = rcOf(i);
    startPress(e, { letter: l, grab: [r - minR, c - minC], fromBoard: true });
  });

  document.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < DRAG_START_PX) return;
      beginDrag();
    }
    e.preventDefault();
    moveDrag(e.clientX, e.clientY, press.touch);
  });

  document.addEventListener('pointerup', e => {
    if (!press || e.pointerId !== press.id) return;
    if (drag) {
      endDrag(true);
      suppressClick = true;                            // the click that follows a drag is not a tap
      setTimeout(() => { suppressClick = false; }, 0);
    }
    press = null;
  });

  document.addEventListener('pointercancel', e => {
    if (!press || e.pointerId !== press.id) return;
    if (drag) endDrag(false);
    press = null;
  });

  /* =====================================================================
     Tapping (and keyboard: board cells and tray pieces are buttons)
     ===================================================================== */
  trayEl.addEventListener('click', e => {
    if (suppressClick) return;
    const b = e.target.closest('.pp-piece');
    if (!b) return;
    const l = b.dataset.letter;
    if (selected === l) { turn('rotate'); return; }
    selected = l;
    ghost = null;
    say(`${name(l)} picked. Tap the board to preview it, or drag it there. Tap it again to rotate.`);
    render();
  });

  boardEl.addEventListener('click', e => {
    if (suppressClick) return;
    const cell = e.target.closest('.pp-cell');
    if (!cell) return;
    const i = +cell.dataset.i, [r, c] = rcOf(i);

    // Tapping a valid preview places it.
    if (ghost && ghost.idxs.includes(i)) {
      if (ghost.ok) { place(ghost.letter, ghost.idxs); render(); }
      else say(`${name(ghost.letter)} doesn't fit there. Try another spot, or rotate it.`);
      return;
    }
    const owner = ownerAt(i);
    if (owner) { liftToTray(owner, `Picked up ${name(owner)}. Tap where it should go, or leave it in the tray.`); render(); return; }
    if (isGiven(i)) { say('That stone came with the puzzle, so it stays put.'); return; }
    if (!selected) { say('Pick a stone from the tray first.'); return; }

    ghost = makeGhost(selected, centerCell(orient[selected]), r, c);
    say(ghost.ok ? `Tap the preview again to place ${name(selected)}.` : `${name(selected)} doesn't fit there. Try another spot, or rotate it.`);
    renderBoard();
  });

  /* =====================================================================
     Buttons and keys
     ===================================================================== */
  $('pp-rotate').addEventListener('click', () => turn('rotate'));
  $('pp-flip').addEventListener('click', () => turn('flip'));
  $('pp-undo').addEventListener('click', undo);
  $('pp-hint').addEventListener('click', runHint);
  $('pp-check').addEventListener('click', runCheck);
  $('pp-win-new').addEventListener('click', newPuzzle);
  $('pp-win-close').addEventListener('click', () => {
    winShown = false;
    say('Solved! Start a new puzzle whenever you like.');
    render();
  });
  startInput.addEventListener('input', () => { $('pp-startval').textContent = startInput.value; });
  $('pp-new').addEventListener('click', newPuzzle);

  document.addEventListener('keydown', e => {
    if (e.target instanceof Element && e.target.matches('input, textarea')) return;   // don't steal keys from the slider
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'r') turn('rotate');
    else if (k === 'f') turn('flip');
    else if (k === 'escape') {
      if (drag) { endDrag(false); press = null; }
      else if (ghost) { ghost = null; renderBoard(); }
    }
  });

  if (restore()) {
    render();
    showTime();
    say(placed.size ? 'Welcome back. Your puzzle is where you left it; the clock restarts on your next move.'
                    : 'Welcome back. Your puzzle is ready when you are.');
    popIn();
  } else {
    newPuzzle();
  }
})();
