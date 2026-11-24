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

  function place(letter, idxs) {
    snapshot();
    placed.set(letter, idxs.slice().sort((a, b) => a - b));
    if (selected === letter) selected = null;
    ghost = null;
    const left = inTray().length;
    say(left ? `${name(letter)} placed. ${left} to go.` : 'Every stone is on the board. Nicely done!');
  }

  function liftToTray(letter, msg) {
    snapshot();
    const idxs = placed.get(letter);
    placed.delete(letter);
    orient[letter] = normalize(idxs.map(rcOf));      // keep the orientation it had on the board
    selected = letter;
    ghost = null;
    say(msg || `${name(letter)} is back in your tray.`);
  }

  function undo() {
    if (!history.length) return;
    placed = history.pop();
    ghost = null;
    if (selected && !inTray().includes(selected)) selected = null;
    say('Undone.');
    render();
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
    $('pp-selname').textContent = selected ? name(selected) : '';
  }

  function render() {
    renderBoard();
    renderTray();
    const onBoard = new Set(puzzle.start.filter(Boolean)).size + placed.size;
    $('pp-count').textContent = `${onBoard}/12`;
    $('pp-undo').disabled = history.length === 0;
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
  for (const id of ['pp-hint', 'pp-check']) {
    $(id).addEventListener('click', () => say('Hint and Check arrive in the next step.'));
  }
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

  newPuzzle();
})();
