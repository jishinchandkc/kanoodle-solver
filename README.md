# Pebblepack

A packing puzzle for the browser. Fit twelve stone pieces onto a 5x11 wooden
board with no gaps and no overlaps.

> Work in progress. This README will be expanded when the game is finished.

## How it works

- Each puzzle starts with some stones already on the board (you choose how many,
  0 to 11) and you place the rest
- Puzzles are cut from a full solution, so every one is solvable
- Check tells you whether your board can still be finished; Hint places one
  correct piece

## The problem

Fitting a fixed set of irregular pieces into a 5x11 grid with no gaps and no
overlaps is a constraint satisfaction problem: a search over placements where
pieces already on the board fix part of the solution. The engine uses a
backtracking search with bitmask boards and dead-region pruning, and solves
any position in well under a second.

## How it was built

Built with AI coding assistance (Claude Code). My work was the product side:
defining the problem, the game design and interaction (drag or tap to place,
Check and Hint), the visual direction, and testing on phone and desktop.

## Stack

Static HTML, CSS and JavaScript. No build step, no dependencies.

Run the engine tests with:

    node tests/engine.test.js
