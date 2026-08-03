# Kanoodle Extreme Solver

A solver for the Kanoodle Extreme puzzle. The physical puzzle asks you to fill a
5x11 board with a fixed set of coloured pieces. This tool takes a partially
filled board and completes it.

**Use it:** https://kanoodlesolver.netlify.app/

## What it does

- Paint the pieces already placed on your board by picking a colour and clicking
  or dragging across the holes it fills
- Solve fills in every remaining piece
- Remove a solution and try a different starting position
- Clear the board and start again

## The problem

Fitting a fixed set of irregular pieces into a 5x11 grid with no gaps and no
overlaps is a constraint satisfaction problem — a search over placements where
pieces already on the board fix part of the solution.

## How it was built

Built with AI coding assistance (Claude Code). My work was the product side:
defining the problem, specifying the input method (paint what is already placed
rather than typing coordinates), testing against real boards, and iterating on
the interface. Deployed on Netlify.

## Stack

Static HTML, CSS and JavaScript. No build step, no dependencies.
