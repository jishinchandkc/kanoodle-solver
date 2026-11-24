// Shared puzzle engine for the Solve tab and the Pebblepack game.
// Works as a plain <script> in the browser (exposes window.Engine) and as a Node module (for tests).
(function (root) {
  "use strict";

  const ROWS = 5, COLS = 11, N = ROWS * COLS;

  const PIECES = {
    A: { color: '#f97316', name: 'Orange',     cells: [[0,0],[1,0],[2,0],[2,1]] },
    B: { color: '#dc2626', name: 'Red',        cells: [[0,0],[0,1],[1,0],[1,1],[2,0]] },
    C: { color: '#1d4ed8', name: 'Dark blue',  cells: [[0,0],[1,0],[2,0],[3,0],[3,1]] },
    D: { color: '#f9a8d4', name: 'Pink',       cells: [[0,0],[1,0],[1,1],[2,0],[3,0]] },
    E: { color: '#15803d', name: 'Green',      cells: [[0,0],[1,0],[1,1],[2,1],[3,1]] },
    F: { color: '#f4f4f5', name: 'White',      cells: [[0,0],[0,1],[1,0]] },
    G: { color: '#38bdf8', name: 'Light blue', cells: [[0,0],[1,0],[2,0],[2,1],[2,2]] },
    H: { color: '#db2777', name: 'Magenta',    cells: [[0,0],[1,0],[1,1],[2,1],[2,2]] },
    I: { color: '#facc15', name: 'Yellow',     cells: [[0,0],[0,1],[1,0],[2,0],[2,1]] },
    J: { color: '#7c3aed', name: 'Purple',     cells: [[0,0],[1,0],[2,0],[3,0]] },
    K: { color: '#a3e635', name: 'Lime',       cells: [[0,0],[0,1],[1,0],[1,1]] },
    L: { color: '#9ca3af', name: 'Gray',       cells: [[0,1],[1,0],[1,1],[1,2],[2,1]] },
  };
  const LETTERS = Object.keys(PIECES);
  const PIDX = Object.fromEntries(LETTERS.map((l, i) => [l, i]));

  /* ---------- geometry ---------- */
  function normalize(cells) {
    const mr = Math.min(...cells.map(c => c[0]));
    const mc = Math.min(...cells.map(c => c[1]));
    return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const shapeKey = cells => normalize(cells).map(c => c.join(',')).join(';');
  const rotate = cells => normalize(cells.map(([r, c]) => [c, -r]));   // 90° clockwise
  const flip   = cells => normalize(cells.map(([r, c]) => [r, -c]));   // mirror left-right

  function orientations(cells) {
    const seen = new Map();
    let cur = cells;
    for (let f = 0; f < 2; f++) {
      for (let r = 0; r < 4; r++) {
        seen.set(shapeKey(cur), normalize(cur));
        cur = cur.map(([a, b]) => [b, -a]);
      }
      cur = cur.map(([a, b]) => [a, -b]);
    }
    return [...seen.values()];
  }

  const ORIENT_KEYS = Object.fromEntries(
    LETTERS.map(l => [l, new Set(orientations(PIECES[l].cells).map(shapeKey))])
  );

  // Every legal placement on the board, bucketed by its first (lowest-index) cell.
  // Occupancy is two ints: lo = cells 0-26, hi = cells 27-54.
  const PLACEMENTS = (() => {
    const byAnchor = Array.from({ length: N }, () => []);
    for (const letter of LETTERS) {
      for (const orient of orientations(PIECES[letter].cells)) {
        const maxR = Math.max(...orient.map(c => c[0]));
        const maxC = Math.max(...orient.map(c => c[1]));
        for (let r = 0; r + maxR < ROWS; r++) {
          for (let c = 0; c + maxC < COLS; c++) {
            const idxs = orient.map(([dr, dc]) => (r + dr) * COLS + (c + dc)).sort((a, b) => a - b);
            let lo = 0, hi = 0;
            for (const i of idxs) { if (i < 27) lo |= 1 << i; else hi |= 1 << (i - 27); }
            byAnchor[idxs[0]].push({ pi: PIDX[letter], letter, lo, hi, idxs });
          }
        }
      }
    }
    return byAnchor;
  })();

  const NEI = Array.from({ length: N }, (_, i) => {
    const r = (i / COLS) | 0, c = i % COLS, n = [];
    if (r > 0) n.push(i - COLS);
    if (r < ROWS - 1) n.push(i + COLS);
    if (c > 0) n.push(i - 1);
    if (c < COLS - 1) n.push(i + 1);
    return n;
  });

  /* ---------- randomness (seedable, so puzzles can be reproduced) ---------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { // mulberry32
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- solver ---------- */
  // board: array of N entries, each a piece letter or null.
  // opts.rng: shuffle the search order to get varied solutions.
  // opts.nodeLimit: give up after this many placements (returns {ok:false, limit:true}).
  function solve(board, opts = {}) {
    const nodeLimit = opts.nodeLimit ?? 5_000_000;
    const lists = opts.rng ? PLACEMENTS.map(l => shuffled(l, opts.rng)) : PLACEMENTS;
    let lo0 = 0, hi0 = 0, used0 = 0;
    const out = board.slice();
    board.forEach((l, i) => {
      if (!l) return;
      if (i < 27) lo0 |= 1 << i; else hi0 |= 1 << (i - 27);
      used0 |= 1 << PIDX[l];
    });
    let nodes = 0;
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);

    // Prune: an empty region smaller than 3 cells can never be filled (smallest piece is 3).
    function hasDeadRegion(lo, hi) {
      seen.fill(0);
      for (let s = 0; s < N; s++) {
        const filled = s < 27 ? (lo >>> s) & 1 : (hi >>> (s - 27)) & 1;
        if (filled || seen[s]) continue;
        let sp = 0, size = 0;
        stack[sp++] = s; seen[s] = 1;
        while (sp) {
          const i = stack[--sp]; size++;
          for (const j of NEI[i]) {
            const f = j < 27 ? (lo >>> j) & 1 : (hi >>> (j - 27)) & 1;
            if (!f && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
          }
        }
        if (size < 3) return true;
      }
      return false;
    }

    function step(lo, hi, used, from) {
      let anchor = -1;
      for (let i = from; i < N; i++) {
        const f = i < 27 ? (lo >>> i) & 1 : (hi >>> (i - 27)) & 1;
        if (!f) { anchor = i; break; }
      }
      if (anchor === -1) return true;
      for (const p of lists[anchor]) {
        if (used & (1 << p.pi)) continue;
        if ((lo & p.lo) | (hi & p.hi)) continue;
        if (++nodes > nodeLimit) throw new Error('limit');
        const nlo = lo | p.lo, nhi = hi | p.hi;
        if (!hasDeadRegion(nlo, nhi) && step(nlo, nhi, used | (1 << p.pi), anchor + 1)) {
          for (const i of p.idxs) out[i] = p.letter;
          return true;
        }
      }
      return false;
    }

    try {
      return step(lo0, hi0, used0, 0) ? { ok: true, board: out, nodes } : { ok: false, nodes };
    } catch (e) {
      if (e.message !== 'limit') throw e;
      return { ok: false, limit: true, nodes };
    }
  }

  /* ---------- board checks ---------- */
  // Letters whose cells on the board don't form that piece's exact shape.
  function invalidPieces(board) {
    const groups = {};
    board.forEach((l, i) => { if (l) (groups[l] ||= []).push([(i / COLS) | 0, i % COLS]); });
    return Object.keys(groups).filter(l => !ORIENT_KEYS[l].has(shapeKey(groups[l])));
  }

  const isComplete = board => board.every(Boolean) && invalidPieces(board).length === 0;

  // Can this partial board still be finished? (The game's "Check" button.)
  function check(board) {
    if (invalidPieces(board).length) return { solvable: false };
    const r = solve(board);
    return { solvable: r.ok, solution: r.ok ? r.board : null };
  }

  /* ---------- game ---------- */
  // A random full solution. Restarts with a fresh shuffle if one search order is unlucky.
  function randomSolution(rng) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const r = solve(Array(N).fill(null), { rng, nodeLimit: 400_000 });
      if (r.ok) return r.board;
    }
    return solve(Array(N).fill(null)).board; // deterministic fallback, always succeeds
  }

  // A puzzle with `startCount` (0-11) pieces already on the board, guaranteed solvable
  // because it is cut from a full solution.
  function generatePuzzle(startCount, seed = (Math.random() * 2 ** 32) >>> 0) {
    const count = Math.max(0, Math.min(11, Math.round(startCount)));
    const rng = makeRng(seed);
    const solution = randomSolution(rng);
    const keep = new Set(shuffled(LETTERS, rng).slice(0, count));
    const start = solution.map(l => (keep.has(l) ? l : null));
    return { seed, startCount: count, start, solution };
  }

  // One correct next piece for the player, or null when the board can't be finished.
  // Prefers the puzzle's own solution while the player's pieces still match it,
  // so repeated hints stay consistent.
  function hint(board, preferredSolution) {
    if (board.every(Boolean)) return null;
    let full = null;
    if (preferredSolution && board.every((l, i) => !l || l === preferredSolution[i])) {
      full = preferredSolution;
    } else {
      const r = check(board);
      if (!r.solvable) return null;
      full = r.solution;
    }
    const firstEmpty = board.indexOf(null);
    const letter = full[firstEmpty];
    const idxs = [];
    full.forEach((l, i) => { if (l === letter) idxs.push(i); });
    return { letter, idxs };
  }

  const Engine = {
    ROWS, COLS, N, PIECES, LETTERS,
    normalize, shapeKey, rotate, flip, orientations,
    makeRng, solve, invalidPieces, isComplete, check,
    generatePuzzle, hint,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
