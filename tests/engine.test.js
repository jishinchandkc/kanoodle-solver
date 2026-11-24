// Run with: node tests/engine.test.js
const E = require('../engine.js');
const { N, PIECES, LETTERS } = E;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// A full, valid board: all 55 cells filled, all 12 pieces, each in its true shape.
function assertValidSolution(board, label = 'board') {
  assert(board.length === N && board.every(Boolean), `${label}: not every cell is filled`);
  const counts = {};
  board.forEach(l => counts[l] = (counts[l] || 0) + 1);
  assert(Object.keys(counts).length === 12, `${label}: uses ${Object.keys(counts).length} pieces, not 12`);
  for (const l of LETTERS) assert(counts[l] === PIECES[l].cells.length, `${label}: piece ${l} has ${counts[l]} cells`);
  assert(E.invalidPieces(board).length === 0, `${label}: bad shapes ${E.invalidPieces(board)}`);
}

console.log('\nGeometry');
test('pieces cover exactly 55 cells', () => {
  assert(LETTERS.reduce((s, l) => s + PIECES[l].cells.length, 0) === N);
});
test('orientation counts are right for each piece shape', () => {
  const got = LETTERS.map(l => E.orientations(PIECES[l].cells).length).join(',');
  assert(got === '8,8,8,8,8,4,4,4,4,2,1,1', got);
});
test('rotate x4 and flip x2 return to the start', () => {
  for (const l of LETTERS) {
    const s = E.shapeKey(PIECES[l].cells);
    let c = PIECES[l].cells;
    for (let i = 0; i < 4; i++) c = E.rotate(c);
    assert(E.shapeKey(c) === s, `${l} rotate`);
    assert(E.shapeKey(E.flip(E.flip(PIECES[l].cells))) === s, `${l} flip`);
  }
});

console.log('\nSolver');
test('empty board solves to a valid full board', () => {
  const r = E.solve(Array(N).fill(null));
  assert(r.ok); assertValidSolution(r.board);
});
test('pre-placed pieces are kept exactly where they are', () => {
  const b = Array(N).fill(null);
  [0, 11, 22, 23].forEach(i => b[i] = 'A');
  const r = E.solve(b);
  assert(r.ok); assertValidSolution(r.board);
  [0, 11, 22, 23].forEach(i => assert(r.board[i] === 'A', 'orange moved'));
});
test('isolated hole is reported unsolvable', () => {
  const b = Array(N).fill(null);
  [1, 11, 12, 13, 23].forEach(i => b[i] = 'L');
  assert(!E.solve(b).ok);
});
test('wrongly shaped piece is detected', () => {
  const b = Array(N).fill(null);
  [0, 1, 2, 3].forEach(i => b[i] = 'A');
  assert(E.invalidPieces(b).join() === 'A');
});

console.log('\nPuzzle generation');
test('every start count 0-11 gives a solvable puzzle with the right number of pieces', () => {
  for (let k = 0; k <= 11; k++) {
    for (let s = 1; s <= 10; s++) {
      const p = E.generatePuzzle(k, k * 1000 + s);
      assertValidSolution(p.solution, `k=${k} seed=${s}`);
      const placed = new Set(p.start.filter(Boolean));
      assert(placed.size === k, `k=${k}: ${placed.size} pieces placed`);
      p.start.forEach((l, i) => assert(!l || l === p.solution[i], 'start differs from solution'));
      assert(E.check(p.start).solvable, `k=${k} seed=${s} not solvable`);
    }
  }
});
test('same seed gives the same puzzle', () => {
  const a = E.generatePuzzle(5, 42), b = E.generatePuzzle(5, 42);
  assert(a.start.join() === b.start.join() && a.solution.join() === b.solution.join());
});
test('different seeds give varied solutions', () => {
  const sols = new Set();
  for (let s = 1; s <= 30; s++) sols.add(E.generatePuzzle(0, s).solution.join());
  assert(sols.size >= 25, `only ${sols.size} distinct solutions out of 30`);
});
test('generation is fast enough for a phone (worst of 100 < 600ms on desktop node)', () => {
  let worst = 0;
  for (let s = 1; s <= 100; s++) {
    const t = Date.now(); E.generatePuzzle(s % 12, s * 7919); worst = Math.max(worst, Date.now() - t);
  }
  console.log(`       worst generation: ${worst}ms`);
  assert(worst < 600, `worst ${worst}ms`);
});

console.log('\nCheck and Hint');
test('Check says solvable for a correct partial fill and stuck for a wrong one', () => {
  const p = E.generatePuzzle(4, 7);
  assert(E.check(p.start).solvable);
  const stuck = Array(N).fill(null);
  [1, 11, 12, 13, 23].forEach(i => stuck[i] = 'L');
  assert(!E.check(stuck).solvable);
});
test('repeatedly taking hints always finishes the puzzle (all start counts)', () => {
  for (let k = 0; k <= 11; k++) {
    const p = E.generatePuzzle(k, 500 + k);
    let b = p.start.slice(), steps = 0;
    while (!b.every(Boolean)) {
      const h = E.hint(b, p.solution);
      assert(h, `k=${k}: no hint on a solvable board`);
      assert(h.idxs.length === PIECES[h.letter].cells.length, 'hint has wrong size');
      assert(h.idxs.every(i => b[i] === null), 'hint overlaps a placed piece');
      assert(!b.includes(h.letter), 'hint reuses a placed piece');
      h.idxs.forEach(i => b[i] = h.letter);
      assert(E.check(b).solvable, `k=${k}: board stuck after hint`);
      if (++steps > 12) throw new Error('too many hints');
    }
    assert(E.isComplete(b), `k=${k}: not complete`);
  }
});
test('hint works when the player found a different valid route', () => {
  // Player starts from a puzzle but builds toward a different full solution.
  const p = E.generatePuzzle(0, 99);
  const other = E.solve(Array(N).fill(null)).board;   // a different full solution
  assert(other.join() !== p.solution.join(), 'test setup: solutions should differ');
  const b = other.map(l => ('ABC'.includes(l) ? l : null));
  const h = E.hint(b, p.solution);
  assert(h, 'no hint');
  h.idxs.forEach(i => b[i] = h.letter);
  assert(E.check(b).solvable, 'hint broke a valid alternate route');
});
test('hint returns null on a stuck board and on a full board', () => {
  const stuck = Array(N).fill(null);
  [1, 11, 12, 13, 23].forEach(i => stuck[i] = 'L');
  assert(E.hint(stuck) === null);
  const full = E.solve(Array(N).fill(null)).board;
  assert(E.hint(full) === null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
