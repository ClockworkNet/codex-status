# codex-status

`codex-status` is a small CLI that reads Codex session rollout logs and prints a compact status line you can keep running in a terminal tab. It was originally built with help from OpenAI Codex and is now released for the community with limited, best-effort support.

## Features
- Displays the most recent Codex session summary, including model, sandbox policy, rate limits, and token usage.
- Watch mode refreshes the display on an interval without cluttering your terminal history.
- Output automatically trims to your terminal width for clean presentation.

## Output Example

![codex-status output example](output-example.png)

## Installation

### Requirements
- Node.js 18 or newer
- Codex CLI (`@openai/codex`) version 0.41.0 or later. Install with `npm install -g @openai/codex` or follow the official guide at [github.com/openai/codex](https://github.com/openai/codex).

### npm
```bash
npm install -g codex-status
# or run ad-hoc
npx codex-status --help
```

### Homebrew
A Homebrew formula is provided under `HomebrewFormula/codex-status.rb`. Once published, users can install via:
```bash
brew tap ClockworkNet/codex-status https://github.com/ClockworkNet/codex-status
brew install codex-status
```
Use the release helper (`npm run release:prepare`) to regenerate the tarball and checksum before cutting a new tag (see Maintenance).

## Usage
```bash
codex-status             # show the most recent session summary
codex-status --watch     # refresh every 15 seconds (default)
codex-status --watch -n 5  # refresh every 5 seconds
codex-status --limit 3   # display the three most recent sessions
codex-status --base ~/custom/path  # override the rollout log directory
codex-status --minimal   # hide policy and directory fields for tighter output
codex-status --version   # print version information
```
Use `codex-status --help` for the full option list.

## Maintenance
1. Bump the version in `package.json`.
2. Run `npm run release:prepare` to execute tests, build the release tarball under `dist/`, and refresh the Homebrew formula URL/SHA256.
3. Inspect the generated tarball checksum in the script output, commit the changes (including the updated formula), and tag the release (`git tag vX.Y.Z`).
4. Publish to npm (`npm publish`) and push the tag to GitHub so the release tarball matches the checksum. Alternatively, trigger the **Manual Release** GitHub Action with the new version—it performs these steps automatically when the `NPM_TOKEN` secret is configured.
5. Update or publish the Homebrew tap (`brew tap --repair clockworknet/codex-status`) if necessary.

## Support Policy
This project is provided as-is with limited support. Please file issues on GitHub and we will respond on a best-effort basis.

## Acknowledgements
Built with assistance from OpenAI Codex and the broader open-source community.
