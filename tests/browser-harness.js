// Browser test helpers for Pebblepack. Load in the page's console with:
//   await import('/tests/browser-harness.js')
// Then use window.T. It reads the board the way a player sees it (stone colours),
// and drives the game with real pointer, click and key events.
const E = window.Engine, COLS = 11;
const COLORS = { '#ffd21f':'A','#1fd3c4':'B','#4466ff':'C','#9a5cff':'D','#ff8a1f':'E','#a6f5c8':'F','#ec3fd3':'G','#3cbcff':'H','#45c652':'I','#ff8fc0':'J','#f3f4ff':'K','#ec2843':'L' };

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const cells = () => [...document.querySelectorAll('#pp-board .pp-cell')];
const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const ev = (type, target, x, y, pt = 'mouse') => target.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, clientX: x, clientY: y,
  pointerId: pt === 'touch' ? 7 : 1, pointerType: pt, button: 0, isPrimary: true,
}));
const key = k => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const status = () => $('#pp-status').textContent;
const count = () => $('#pp-count').textContent;
const trayLetters = () => [...document.querySelectorAll('.pp-piece')].map(b => b.dataset.letter);
const trayShape = l => [...document.querySelector(`.pp-piece[data-letter="${l}"]`).querySelectorAll('[data-r]')].map(b => [+b.dataset.r, +b.dataset.c]);
const board = () => cells().map(c => c.classList.contains('ghost') ? null : (COLORS[c.style.getPropertyValue('--c')] || null));
const solution = () => E.check(board()).solution;
const target = (sol, l) => sol.map((x, i) => x === l ? [(i / COLS) | 0, i % COLS] : null).filter(Boolean);
const pitch = () => { const a = cells()[0].getBoundingClientRect(), b = cells()[1].getBoundingClientRect(); return b.left - a.left; };
const centerCell = s => {
  const mr = s.reduce((a, c) => a + c[0], 0) / s.length, mc = s.reduce((a, c) => a + c[1], 0) / s.length;
  let b = s[0], d = Infinity;
  for (const c of s) { const dd = (c[0] - mr) ** 2 + (c[1] - mc) ** 2; if (dd < d - 1e-9) { d = dd; b = c; } }
  return b;
};

// Rotate/flip the selected tray piece until it matches `cellsRC`.
function orientTo(l, cellsRC) {
  const k = E.shapeKey(cellsRC);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) { if (E.shapeKey(trayShape(l)) === k) return true; key('r'); }
    key('f');
  }
  return false;
}

// Drag tray piece l to its place in `sol` (or onto `destCell`). Returns the preview state just before the drop.
async function dragFromTray(l, sol, pt = 'mouse', destCell) {
  document.querySelector(`.pp-piece[data-letter="${l}"]`).click();
  const tgt = target(sol, l);
  if (!orientTo(l, tgt)) return 'could not orient';
  const ball = document.querySelector(`.pp-piece[data-letter="${l}"] [data-r]`);
  const br = +ball.dataset.r, bc = +ball.dataset.c;
  const minR = Math.min(...tgt.map(c => c[0])), minC = Math.min(...tgt.map(c => c[1]));
  const dest = destCell ?? cells()[(minR + br) * COLS + (minC + bc)];
  const [x, y] = center(ball);
  let [tx, ty] = center(dest);
  if (pt === 'touch') ty += pitch() * 1.1;     // the finger sits below the lifted piece
  ev('pointerdown', ball, x, y, pt);
  for (let s = 1; s <= 8; s++) ev('pointermove', document, x + (tx - x) * s / 8, y + (ty - y) * s / 8, pt);
  await wait(20);
  const pre = {
    ghost: document.querySelectorAll('#pp-board .ghost').length,
    bad: document.querySelectorAll('#pp-board .ghost.bad').length,
    clash: document.querySelectorAll('#pp-board .clash').length,
  };
  ev('pointerup', document, tx, ty, pt);
  await wait(20);
  return pre;
}

window.T = { E, $, cells, center, ev, key, status, count, trayLetters, trayShape, board, solution,
  target, orientTo, dragFromTray, pitch, centerCell, wait, COLS };
