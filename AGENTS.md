# Codex Status – Agent Guide

Welcome! This document captures the context an automation or AI agent needs when
working on `codex-status`.

## Overview
- Purpose: lightweight CLI that reads Codex rollout logs from `~/.codex/sessions`
  and prints a single status line (one-off or watch mode).
- Tech stack: Node.js ≥ 18, CommonJS modules, standard library only
  (no runtime dependencies).
- Distribution targets:
  - npm package `codex-status` exposing the `codex-status` binary.
  - Optional Homebrew Formula (`HomebrewFormula/codex-status.rb`).
- Required tooling: Codex CLI `@openai/codex` version ≥ 0.41.0 available on the
  system, either via npm or the official installation instructions.

## Key Files
- `src/codex-status.js`: core logic; exports `runCli`, helper utilities, and the
  Codex CLI requirement check.
- `bin/codex-status.js`: executable entry point that loads package metadata and
  invokes `runCli`.
- `test/codex-status.test.js`: Node test suite (node:test) covering argument
  parsing, terminal truncation, version comparisons, and Codex CLI detection.
- `README.md`: user-facing instructions, including install, usage, maintenance,
  limited support policy, and Codex acknowledgement.
- `HomebrewFormula/codex-status.rb`: template formula for the Homebrew tap.
- `LICENSE`: MIT license.

## Expected Behaviours
- `codex-status` should gracefully inform users when Codex CLI is missing or out
  of date, referencing the official OpenAI installation guide.
- Output lines must fit within the user’s terminal width via `truncateToTerminal`.
- The working directory badge is placed last in the summary.
- `--version` prints `codex-status vX.Y.Z`; `--help` prints usage.

## Development Notes
- Run tests with `npm test` (Node’s built-in test runner).
- The project avoids external dependencies; prefer adding small utilities in
  `src/codex-status.js` when needed.
- Keep documentation aligned with OpenAI Codex’s official guidance and update
  the Homebrew formula checksum when publishing new releases.
- Maintain acknowledgements that the tool was built with assistance from OpenAI
  Codex and provide limited-support messaging.

## Collaboration Expectations
- Follow MIT license terms.
- Respect semantic versioning when modifying behaviour.
- Update README, tests, and Homebrew formula when features or options change.
- Ensure any automated agents leave concise, well-scoped commits and describe
  modifications clearly in pull requests.
