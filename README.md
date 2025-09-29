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
- Node.js 20 or newer
- Codex CLI (`@openai/codex`) version 0.41.0 or later. Install with `npm install -g @openai/codex` or follow the official guide at [github.com/openai/codex](https://github.com/openai/codex).

### npm
```bash
npm install -g codex-status
# or run ad-hoc
npx codex-status --help
```

## Usage
```bash
codex-status             # show the most recent session summary
codex-status --watch     # refresh every 15 seconds (default)
codex-status --watch -n 5  # refresh every 5 seconds
codex-status --limit 3   # display the three most recent sessions
codex-status --base ~/custom/path  # override the rollout log directory
codex-status --minimal   # hide policy and directory fields for tighter output
codex-status --format "directory,model,daily"  # reorder visible fields
codex-status --override-model=🤩  # replace the default model emoji
codex-status --version   # print version information
```
Use `codex-status --help` for the full option list.

### Formatting and Labels
- `--format` (or `-f`) accepts a comma-separated list of fields that defines both the order and which fields appear. Supported field names include `time`, `model`, `approval`, `sandbox`, `daily`, `weekly`, `recent`, `total`, and `directory` (aliases like `primary`, `cwd`, etc. are supported).
- `--override-<field>=<label>` lets you replace a field’s prefix emoji/text (for example, `--override-directory=DIR:`). Provide the value inline or as the next argument.
- Minimal mode (`--minimal`) still hides approval, sandbox, and directory fields even if requested in the custom format.

## Maintenance
1. Bump the version in `package.json`.
2. Run `npm test` to ensure the suite passes.
3. Commit the version bump and tag the release (`git tag vX.Y.Z`).
4. Publish to npm (`npm publish`) and push the tag to GitHub.
5. Optional: trigger the **Manual Release** GitHub Action instead of the manual steps—provide the new version and, if needed, an npm dist-tag. The workflow bumps the version, runs tests, pushes the tag, bumps npm, and creates the GitHub release (requires the `NPM_TOKEN` secret).

## Support Policy
This project is provided as-is with limited support. Please file issues on GitHub and we will respond on a best-effort basis.

## Acknowledgements
Built with assistance from OpenAI Codex and the broader open-source community.
