# codex-status

`codex-status` is a small CLI that reads Codex session rollout logs and prints a compact status line you can keep running in a terminal tab. It was originally built with help from OpenAI Codex and is now released for the community with limited, best-effort support.

## Features
- Displays the most recent Codex session summary, including model, sandbox policy, rate limits, and token usage.
- Watch mode refreshes the display on an interval without cluttering your terminal history.
- Output automatically trims to your terminal width for clean presentation.
- Optional sound alerts when the assistant requests user input (watch mode only).

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
codex-status --watch --sound  # enable sound alerts when assistant requests input
codex-status --limit 3   # display the three most recent sessions
codex-status --base ~/custom/path  # override the rollout log directory
codex-status --minimal   # hide policy and directory fields for tighter output
codex-status --format "directory,model,daily"  # reorder visible fields
codex-status --override-model=🤩  # replace the default model emoji
codex-status --version   # print version information
```
Use `codex-status --help` for the full option list.

### Sound Alerts
Use `--sound` (or `-s`) in watch mode to enable audio notifications when activity occurs. This helps you stay aware of Codex's progress without constantly watching the terminal.

**Sound Modes:**
- `--sound` or `-s` (default: **some**): Plays sound every other refresh for non-user activity (assistant, tool, thinking)
- `--sound=all`: Plays sound on every refresh for all non-user activity
- `--sound=some`: Plays sound every other refresh for non-user activity (default)
- `--sound=assistant`: Plays sound only for assistant messages

**Sound Customization:**
- `--sound-volume <1-100>`: Set volume level (1=quietest, 100=loudest, default: 100)
- `--sound-reverb <type>`: Set reverb effect (options: `none`, `subtle`, `default`, `lush`, default: `default`)

Examples:
```bash
codex-status --watch --sound --sound-volume=50  # enable sounds at half volume
codex-status --watch -s assistant --sound-reverb=lush  # assistant-only with lush reverb
codex-status --watch --sound=all --sound-volume=30 --sound-reverb=subtle  # quiet, minimal reverb
```

**Musical Tones:**
- **Assistant responses**: Full ascending arpeggio through G6 major chord (9 notes: G-B-D-E across 3 octaves)
- **Other activity** (tool/thinking):
  - **some mode**: 2 random notes descending (high to low)
  - **all mode**: 3-4 random notes descending (high to low)
- **Audio processing**: Adjustable volume, lowpass filtering (3kHz cutoff) for warmth, and configurable reverb for a pleasant, non-intrusive sound

**Platform Support:**
- **macOS**: Generates WAV programmatically and plays via `afplay`
- **Linux**: Generates WAV in-memory and plays via `aplay` (ALSA) or `paplay` (PulseAudio)
- **Windows**: Uses PowerShell's `[console]::beep()` for tone generation
- **Other**: Falls back to terminal bell (`\x07`)

The sound is generated entirely in Node.js using Buffer manipulation (no external audio files required). User messages never trigger sounds.

### Formatting and Labels
- `--format` (or `-f`) accepts a comma-separated list of fields that defines both the order and which fields appear. Supported field names include `time`, `model`, `approval`, `sandbox`, `daily`, `weekly`, `recent`, `total`, `activity`, and `directory` (aliases like `primary`, `cwd`, `role`, etc. are supported).
- `--override-<field>=<label>` lets you replace a field's prefix emoji/text (for example, `--override-directory=DIR:`). Provide the value inline or as the next argument.
- Minimal mode (`--minimal`) still hides approval, sandbox, activity, and directory fields even if requested in the custom format.

**Activity Field:**
The `activity` field shows the last action taken by Codex:
- 👤 User message
- 💬 Assistant response
- 🔧 Tool/function call
- 🤔 Reasoning/thinking

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
