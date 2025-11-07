#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { playAlertSound, generateBeepWav, generateG6ChordBeep } = require('./sound');

function trimPath(p) {
  if (!p) return '';
  const home = os.homedir();
  let result = p.startsWith(home) ? p.slice(home.length) : p;
  if (result.startsWith(path.sep)) result = result.slice(1);
  const parts = result.split(path.sep);
  if (parts.length > 1 && parts[0] === 'dev') {
    result = parts.slice(1).join(path.sep);
  }
  return result || '.';
}

function stripModelPrefix(model) {
  if (typeof model !== 'string') return model;
  return model.startsWith('gpt-') ? model.slice(4) : model;
}

const MARK_REGEX = /\p{Mark}/u;
const EXTENDED_PICTOGRAPHIC_REGEX = /\p{Extended_Pictographic}/u;

function isFullWidthCodePoint(codePoint) {
  return (
    codePoint >= 0x1100
    && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0x303e)
      || (codePoint >= 0x3040 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
      || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
      || (codePoint >= 0x1fa70 && codePoint <= 0x1faff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  );
}

function codePointWidth(codePoint) {
  if (codePoint === 0) return 0;
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
  if (codePoint === 0x200d) return 0; // zero-width joiner
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 0; // variation selectors
  const char = String.fromCodePoint(codePoint);
  if (MARK_REGEX.test(char)) return 0;
  if (EXTENDED_PICTOGRAPHIC_REGEX.test(char)) return 2;
  if (isFullWidthCodePoint(codePoint)) return 2;
  return 1;
}

function truncateToTerminal(text, columns) {
  if (!columns || columns <= 0) return text;
  let width = 0;
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const codePoint = text.codePointAt(i);
    const char = String.fromCodePoint(codePoint);
    if (codePoint > 0xffff) i += 1;
    const charWidth = codePointWidth(codePoint);
    if (width + charWidth > columns) break;
    result += char;
    width += charWidth;
  }
  return result;
}

function compareVersions(a, b) {
  const toNumeric = (version) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = 3;
  const [aParts, bParts] = [toNumeric(a), toNumeric(b)];
  for (let i = 0; i < maxLength; i += 1) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

function ensureCodexCli(required = '0.41.0', overrides = {}) {
  const installHint = 'Install or upgrade via "npm install -g @openai/codex" or follow https://github.com/openai/codex for instructions.';
  const missingMessage = (reason) => `codex-status requires Codex CLI @ ${required} or newer (${reason}). ${installHint}`;

  const defaultLoaders = [
    () => require('@openai/codex/package.json'),
    () => require('codex-cli/package.json'),
  ];
  const loadPackage = overrides.loadPackage || (() => {
    for (const loader of defaultLoaders) {
      try {
        return loader();
      } catch (err) {
        // try next loader
      }
    }
    throw new Error('package not found');
  });
  const execSpawn = overrides.execSpawn || (() => spawnSync('codex', ['--version'], { encoding: 'utf8' }));

  try {
    const codexPackage = loadPackage();
    const current = codexPackage.version || '0.0.0';
    if (compareVersions(current, required) < 0) {
      console.error(missingMessage(`detected ${current}`));
      return 1;
    }
    return true;
  } catch (err) {
    // fall back to checking PATH for other installations
  }

  const result = execSpawn();
  if (result.error) {
    console.error(missingMessage('binary not found on PATH'));
    return 1;
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const match = output.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    console.error(missingMessage('unable to detect version'));
    return 1;
  }
  const current = match[1];
  if (compareVersions(current, required) < 0) {
    console.error(missingMessage(`detected ${current}`));
    return 1;
  }
  return true;
}

const CANONICAL_FIELDS = [
  'sound',
  'time',
  'error',
  'model',
  'approval',
  'sandbox',
  'daily',
  'weekly',
  'recent',
  'total',
  'activity',
  'directory',
];

const FIELD_ALIASES = {
  sound: 'sound',
  speaker: 'sound',
  time: 'time',
  timestamp: 'time',
  age: 'time',
  error: 'error',
  model: 'model',
  agent: 'model',
  approval: 'approval',
  policy: 'approval',
  sandbox: 'sandbox',
  'sandbox-policy': 'sandbox',
  env: 'sandbox',
  primary: 'daily',
  daily: 'daily',
  quota: 'daily',
  secondary: 'weekly',
  weekly: 'weekly',
  billing: 'weekly',
  recent: 'recent',
  'recent-tokens': 'recent',
  latest: 'recent',
  total: 'total',
  'total-tokens': 'total',
  cumulative: 'total',
  activity: 'activity',
  role: 'activity',
  action: 'activity',
  directory: 'directory',
  cwd: 'directory',
  path: 'directory',
};

const DEFAULT_FORMAT_ORDER = [
  'sound',
  'time',
  'activity',
  'daily',
  'weekly',
  'recent',
  'total',
  'error',
  'model',
  'approval',
  'sandbox',
  'directory',
];

const SOUND_REVERB_SEQUENCE = ['default', 'subtle', 'lush', 'none'];

function normalizeFieldKey(key) {
  if (typeof key !== 'string') return null;
  const lookup = FIELD_ALIASES[key.trim().toLowerCase()];
  if (!lookup) return null;
  return CANONICAL_FIELDS.includes(lookup) ? lookup : null;
}

function parseFormatList(raw) {
  if (typeof raw !== 'string') {
    throw new Error('Format must be a comma-separated list of field names.');
  }
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (!parts.length) {
    throw new Error('Format must include at least one field.');
  }
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const normalized = normalizeFieldKey(part);
    if (!normalized) {
      throw new Error(`Unknown field in format: ${part}`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    baseDir: path.join(os.homedir(), '.codex', 'sessions'),
    watch: false,
    interval: 15,
    limit: 1,
    minimal: false,
    formatOrder: null,
    labelOverrides: {},
    sound: 'off',
    soundVolume: 100,
    soundReverb: 'default',
  };

  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      options.formatOrder = parseFormatList(value);
    } else if (arg.startsWith('--override-')) {
      const [flag, inlineValue] = arg.split('=', 2);
      const keyPart = flag.slice('--override-'.length);
      if (!keyPart) {
        throw new Error('Override flag requires a field name.');
      }
      let overrideValue = inlineValue;
      if (overrideValue === undefined) {
        overrideValue = argv[i + 1];
        if (overrideValue === undefined) {
          throw new Error(`Override for ${keyPart} requires a value.`);
        }
        i += 1;
      }
      const normalizedKey = normalizeFieldKey(keyPart);
      if (!normalizedKey) {
        throw new Error(`Unknown override field: ${keyPart}`);
      }
      options.labelOverrides[normalizedKey] = overrideValue;
    } else if ((arg === '--base' || arg === '-b') && argv[i + 1]) {
      options.baseDir = argv[i + 1];
      i += 1;
    } else if (arg === '--watch' || arg === '-w') {
      options.watch = true;
    } else if ((arg === '--interval' || arg === '-n') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Interval must be a positive number of seconds.');
      }
      options.interval = value;
      i += 1;
    } else if ((arg === '--limit' || arg === '-l') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Limit must be a positive integer.');
      }
      options.limit = value;
      i += 1;
    } else if (arg === '--minimal' || arg === '-m') {
      options.minimal = true;
    } else if (arg === '--format' || arg === '-f') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('Format flag requires a comma-separated list of fields.');
      }
      options.formatOrder = parseFormatList(value);
      i += 1;
    } else if (arg.startsWith('--sound=')) {
      const value = arg.slice('--sound='.length);
      if (!['all', 'some', 'assistant'].includes(value)) {
        throw new Error('Sound mode must be one of: all, some, assistant');
      }
      options.sound = value;
    } else if (arg === '--sound' || arg === '-s') {
      const nextArg = argv[i + 1];
      if (nextArg && ['all', 'some', 'assistant'].includes(nextArg)) {
        options.sound = nextArg;
        i += 1;
      } else {
        options.sound = 'some';
      }
    } else if (arg.startsWith('--sound-volume=')) {
      const value = Number(arg.slice('--sound-volume='.length));
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('Sound volume must be an integer between 1 and 100');
      }
      options.soundVolume = value;
    } else if (arg === '--sound-volume') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('Sound volume must be an integer between 1 and 100');
      }
      options.soundVolume = value;
      i += 1;
    } else if (arg.startsWith('--sound-reverb=')) {
      const value = arg.slice('--sound-reverb='.length);
      if (!['none', 'subtle', 'default', 'lush'].includes(value)) {
        throw new Error('Sound reverb must be one of: none, subtle, default, lush');
      }
      options.soundReverb = value;
    } else if (arg === '--sound-reverb') {
      const value = argv[i + 1];
      if (!value || !['none', 'subtle', 'default', 'lush'].includes(value)) {
        throw new Error('Sound reverb must be one of: none, subtle, default, lush');
      }
      options.soundReverb = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { options, showHelp, showVersion };
}

function buildHelpMessage() {
  return `Usage: codex-status [options]

Options:
  --base, -b <path>     Override base sessions directory (default: ~/.codex/sessions)
  --watch, -w           Continuously refresh status until interrupted
  --interval, -n <sec>  Seconds between refresh updates (default: 15)
  --limit, -l <count>   Maximum sessions to display (default: 1)
  --minimal, -m         Hide policy and directory details for a compact view
  --format, -f <fields> Comma-separated field order (e.g., time,model,directory)
  --override-<field> <label>
                        Replace a field label emoji/text (e.g., --override-model=🤩)
  --sound, -s [mode]    Play alert sounds in watch mode (modes: all, some, assistant)
                        Default: some when -s is used without value
  --sound-volume <1-100>
                        Set sound volume (1=quiet, 100=max, default: 100)
  --sound-reverb <type> Set reverb effect (none, subtle, default, lush)
                        Default: default
  --version, -v         Show version information
  --help, -h            Show this message
`;
}

async function findSessionLogs(baseDir, limit) {
  const stack = [baseDir];
  const sessions = [];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        let stats;
        try {
          stats = await fs.promises.stat(entryPath);
        } catch (err) {
          continue;
        }
        sessions.push({
          path: entryPath,
          mtime: stats.mtime,
        });
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  if (Number.isFinite(limit) && limit > 0) {
    return sessions.slice(0, limit);
  }
  return sessions;
}

function formatDuration(seconds, maxUnits = 2) {
  if (seconds == null || Number.isNaN(seconds)) return 'unknown';
  const abs = Math.max(0, Math.floor(seconds));
  const units = [
    { label: 'd', value: 24 * 60 * 60 },
    { label: 'h', value: 60 * 60 },
    { label: 'm', value: 60 },
    { label: 's', value: 1 },
  ];
  const parts = [];
  let remaining = abs;
  for (const unit of units) {
    if (unit.value > remaining && parts.length === 0) continue;
    const count = Math.floor(remaining / unit.value);
    if (count > 0 || parts.length > 0) {
      parts.push(`${count}${unit.label}`);
      remaining -= count * unit.value;
    }
    if (parts.length >= maxUnits) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}

function formatAgoShort(date) {
  if (!date) return 'n/a';
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(diffSeconds)) return 'n/a';
  if (diffSeconds < 5) return 'now';
  const duration = formatDuration(diffSeconds, 1);
  return duration.replace(/\s+/g, '');
}

function formatResetTarget(seconds, now = Date.now()) {
  if (!Number.isFinite(seconds)) return 'n/a';
  if (!Number.isFinite(now)) return 'n/a';
  if (seconds <= 0) return 'now';
  const targetMs = now + (seconds * 1000);
  if (!Number.isFinite(targetMs)) return 'n/a';
  const target = new Date(targetMs);
  if (Number.isNaN(target.getTime())) return 'n/a';
  const current = new Date(now);
  const sameDay = (
    target.getFullYear() === current.getFullYear()
    && target.getMonth() === current.getMonth()
    && target.getDate() === current.getDate()
  );
  if (sameDay) {
    const hours = String(target.getHours()).padStart(2, '0');
    const minutes = String(target.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

function parseTimestampMs(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function resolveResetSeconds(windowData, now = Date.now()) {
  if (!windowData || typeof windowData !== 'object') return null;
  const resetsSecondsRaw = windowData.resets_in_seconds;
  if (Number.isFinite(resetsSecondsRaw)) {
    return resetsSecondsRaw;
  }
  if (typeof resetsSecondsRaw === 'string') {
    const trimmed = resetsSecondsRaw.trim();
    if (trimmed) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;
    }
  }

  const nowMs = Number.isFinite(now) ? now : Date.now();
  const candidates = ['resets_at', 'reset_at', 'resetsAt', 'resetAt'];
  for (const key of candidates) {
    if (!(key in windowData)) continue;
    const ms = parseTimestampMs(windowData[key]);
    if (!Number.isFinite(ms)) continue;
    const diffSeconds = Math.floor((ms - nowMs) / 1000);
    if (Number.isFinite(diffSeconds)) return diffSeconds;
  }

  return null;
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompact(value) {
  return typeof value === 'number' ? compactFormatter.format(value) : 'n/a';
}

function normalizeReviewFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null;
  const body = typeof raw.body === 'string' && raw.body.trim() ? raw.body.trim() : null;
  const priority = Number.isFinite(raw.priority) ? raw.priority : null;
  const severity = typeof raw.severity === 'string' && raw.severity.trim() ? raw.severity.trim() : null;
  const confidence = Number.isFinite(raw.confidence_score)
    ? raw.confidence_score
    : Number.isFinite(raw.confidence)
      ? raw.confidence
      : null;

  let location = null;
  if (raw.code_location && typeof raw.code_location === 'object') {
    const loc = raw.code_location;
    const file = typeof loc.absolute_file_path === 'string' && loc.absolute_file_path.trim()
      ? loc.absolute_file_path.trim()
      : typeof loc.file_path === 'string' && loc.file_path.trim()
        ? loc.file_path.trim()
        : null;
    let startLine = null;
    let endLine = null;
    if (loc.line_range && typeof loc.line_range === 'object') {
      if (Number.isFinite(loc.line_range.start)) startLine = loc.line_range.start;
      if (Number.isFinite(loc.line_range.end)) endLine = loc.line_range.end;
    } else {
      if (Number.isFinite(loc.start_line)) startLine = loc.start_line;
      if (Number.isFinite(loc.end_line)) endLine = loc.end_line;
    }
    if (file || startLine != null || endLine != null) {
      location = {
        file,
        startLine: startLine != null ? startLine : null,
        endLine: endLine != null ? endLine : null,
      };
    }
  }

  if (!title && !body && !location) return null;
  return {
    title,
    body,
    priority,
    severity,
    confidence,
    location,
  };
}

function deriveReviewVerdict(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('incorrect') || normalized.includes('reject') || normalized.includes('changes')) {
    return 'incorrect';
  }
  if (normalized.includes('correct') || normalized.includes('approve')) {
    return 'correct';
  }
  if (normalized.includes('unsure') || normalized.includes('uncertain') || normalized.includes('follow-up')) {
    return 'unsure';
  }
  return null;
}

function normalizeReviewPayload(raw, { source = 'unknown', fallbackText = null } = {}) {
  if (raw == null) {
    if (fallbackText) {
      return normalizeReviewPayload(fallbackText, { source, fallbackText: null });
    }
    return null;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeReviewPayload(parsed, { source, fallbackText: trimmed });
    } catch (err) {
      return {
        source,
        summary: trimmed,
        overallCorrectness: null,
        overallExplanation: trimmed,
        overallConfidence: null,
        findings: [],
        text: trimmed,
        verdict: null,
        raw,
      };
    }
  }

  if (typeof raw !== 'object') {
    const text = String(raw).trim();
    if (!text) return null;
    return {
      source,
      summary: text,
      overallCorrectness: null,
      overallExplanation: text,
      overallConfidence: null,
      findings: [],
      text,
      verdict: null,
      raw,
    };
  }

  const findings = Array.isArray(raw.findings)
    ? raw.findings
      .map((finding) => normalizeReviewFinding(finding))
      .filter(Boolean)
    : [];

  const overallCorrectness = typeof raw.overall_correctness === 'string'
    ? raw.overall_correctness
    : typeof raw.overallCorrectness === 'string'
      ? raw.overallCorrectness
      : null;

  const explanationRaw = typeof raw.overall_explanation === 'string'
    ? raw.overall_explanation
    : typeof raw.overallExplanation === 'string'
      ? raw.overallExplanation
      : null;
  const overallExplanation = explanationRaw && explanationRaw.trim() ? explanationRaw.trim() : null;

  const confidenceRaw = Number.isFinite(raw.overall_confidence_score)
    ? raw.overall_confidence_score
    : Number.isFinite(raw.overall_confidence)
      ? raw.overall_confidence
      : null;

  const summaryRaw = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null;
  const summary = summaryRaw || overallExplanation || (fallbackText && fallbackText.trim()) || null;
  const text = summary || (findings.length ? (findings[0].title || findings[0].body || null) : null);

  return {
    source,
    summary,
    overallCorrectness,
    overallExplanation,
    overallConfidence: confidenceRaw,
    findings,
    text,
    verdict: deriveReviewVerdict(overallCorrectness),
    raw,
  };
}

function mergeReviewData(base, update) {
  if (!update) return base || null;
  if (!base) return { ...update };

  const merged = { ...base };

  if (!merged.summary && update.summary) merged.summary = update.summary;
  if (!merged.overallCorrectness && update.overallCorrectness) merged.overallCorrectness = update.overallCorrectness;
  if (!merged.overallExplanation && update.overallExplanation) merged.overallExplanation = update.overallExplanation;
  if (!Number.isFinite(merged.overallConfidence) && Number.isFinite(update.overallConfidence)) {
    merged.overallConfidence = update.overallConfidence;
  }
  if (!merged.text && update.text) merged.text = update.text;
  if (!merged.verdict && update.verdict) merged.verdict = update.verdict;
  if (!merged.source && update.source) merged.source = update.source;

  if (!Array.isArray(merged.findings) || merged.findings.length === 0) {
    merged.findings = Array.isArray(update.findings) ? update.findings : [];
  } else if (Array.isArray(update.findings) && update.findings.length > 0) {
    merged.findings = merged.findings.concat(update.findings);
  }

  if (!merged.raw && update.raw) merged.raw = update.raw;
  if (!merged.timestamp && update.timestamp) merged.timestamp = update.timestamp;

  return merged;
}

function parseUserActionReview(text) {
  if (typeof text !== 'string' || !text.includes('<user_action>')) return null;
  const actionMatch = text.match(/<action>\s*([^<]+)\s*<\/action>/i);
  if (!actionMatch || actionMatch[1].trim().toLowerCase() !== 'review') return null;
  const resultsMatch = text.match(/<results>([\s\S]*?)<\/results>/i);
  const resultsText = resultsMatch ? resultsMatch[1].trim() : '';
  if (!resultsText) return null;
  return normalizeReviewPayload(resultsText, { source: 'user_action' });
}

async function readLog(filePath) {
  const stream = fs.createReadStream(filePath, 'utf8');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastContext = null;
  let lastTokenCount = null;
  let lastTimestamp = null;
  let lastAssistantMessageTime = null;
  let lastActivity = null;
  let lastReview = null;
  let reviewMode = false;
  let pendingReview = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (err) {
      continue;
    }

    if (record.timestamp) {
      const ts = new Date(record.timestamp);
      if (!Number.isNaN(ts.getTime())) lastTimestamp = ts;
    }

    if (record.type === 'turn_context') {
      lastContext = record.payload || null;
    } else if (record.type === 'event_msg' && record.payload) {
      const eventPayload = record.payload;
      if (eventPayload.type === 'token_count') {
        lastTokenCount = eventPayload;
      } else if (eventPayload.type === 'entered_review_mode') {
        reviewMode = true;
        pendingReview = null;
      } else if (eventPayload.type === 'agent_message') {
        if (reviewMode) {
          const normalized = normalizeReviewPayload(eventPayload.message, { source: 'agent_message' });
          if (normalized) {
            if (lastTimestamp) normalized.timestamp = lastTimestamp;
            pendingReview = mergeReviewData(pendingReview, normalized);
          }
        }
      } else if (eventPayload.type === 'exited_review_mode') {
        reviewMode = false;
        const fromPayload = normalizeReviewPayload(eventPayload.review_output, { source: 'exited_review_mode' });
        let reviewData = mergeReviewData(fromPayload, pendingReview);
        if (!reviewData && eventPayload.message) {
          reviewData = normalizeReviewPayload(eventPayload.message, { source: 'exited_review_mode' });
        }
        if (reviewData) {
          if (lastTimestamp) reviewData.timestamp = lastTimestamp;
          if (!reviewData.verdict) reviewData.verdict = deriveReviewVerdict(reviewData.overallCorrectness);
          lastReview = reviewData;
          lastActivity = 'review';
        }
        pendingReview = null;
      }
    } else if (record.type === 'response_item' && record.payload) {
      const payload = record.payload;
      
      // Track assistant messages for sound alerts
      if (payload.role === 'assistant') {
        if (record.timestamp) {
          const ts = new Date(record.timestamp);
          if (!Number.isNaN(ts.getTime())) lastAssistantMessageTime = ts;
        }
      }

      // Track activity type for display
      if (payload.role === 'user') {
        let treated = false;
        if (Array.isArray(payload.content)) {
          for (const part of payload.content) {
            if (part && typeof part === 'object' && typeof part.text === 'string') {
              const reviewFromUserAction = parseUserActionReview(part.text);
              if (reviewFromUserAction) {
                if (lastTimestamp) reviewFromUserAction.timestamp = lastTimestamp;
                lastReview = mergeReviewData(lastReview, reviewFromUserAction) || reviewFromUserAction;
                if (!lastReview.verdict) {
                  lastReview.verdict = deriveReviewVerdict(lastReview.overallCorrectness);
                }
                lastActivity = 'review';
                treated = true;
                break;
              }
            }
          }
        }
        if (!treated) {
          lastActivity = 'user';
        }
      } else if (payload.role === 'assistant') {
        lastActivity = 'assistant';
      } else if (payload.type === 'function_call') {
        lastActivity = 'tool';
      } else if (payload.type === 'reasoning') {
        lastActivity = 'thinking';
      }
    }
  }

  return { lastContext, lastTokenCount, lastTimestamp, lastAssistantMessageTime, lastActivity, lastReview };
}

async function gatherStatuses(baseDir, limit) {
  const sessions = await findSessionLogs(baseDir, limit);
  if (!sessions.length) {
    return { error: `No rollout logs found in ${baseDir}` };
  }

  const details = [];
  for (const session of sessions) {
    try {
      const info = await readLog(session.path);
      details.push({
        log: session,
        ...info,
      });
    } catch (err) {
      details.push({
        log: session,
        error: err.message || String(err),
      });
    }
  }

  return { sessions: details };
}

function formatRateWindow(windowData) {
  if (!windowData) return 'n/a';
  const used = windowData.used_percent != null ? `${windowData.used_percent}%` : 'n/a';
  const nowMs = Date.now();
  const resetSeconds = resolveResetSeconds(windowData, nowMs);
  const reset = formatResetTarget(resetSeconds, nowMs);
  return `${used}/${reset}`;
}

const FIELD_DEFINITIONS = {
  sound: {
    defaultLabel: '',
    build: ({ options }) => resolveSoundStatusIcon(options),
  },
  time: {
    defaultLabel: '🕒',
    build: ({ detail }) => formatAgoShort(detail.log.mtime),
  },
  error: {
    defaultLabel: '❌',
    build: ({ detail }) => detail.error || null,
  },
  model: {
    defaultLabel: '🤖',
    build: ({ context }) => {
      if (typeof context.model === 'string' && context.model) {
        return stripModelPrefix(context.model);
      }
      return null;
    },
  },
  approval: {
    defaultLabel: '🛂',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      if (context.approval_policy) return context.approval_policy;
      return null;
    },
  },
  sandbox: {
    defaultLabel: '🧪',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      const policy = context.sandbox_policy;
      if (policy && policy.mode) {
        let label = policy.mode;
        if (policy.network_access === false) label += '🚫';
        return label;
      }
      return null;
    },
  },
  daily: {
    defaultLabel: '🕔',
    build: ({ rateLimits }) => {
      if (rateLimits && rateLimits.primary) {
        return formatRateWindow(rateLimits.primary);
      }
      return null;
    },
  },
  weekly: {
    defaultLabel: '🗓',
    build: ({ rateLimits }) => {
      if (rateLimits && rateLimits.secondary) {
        return formatRateWindow(rateLimits.secondary);
      }
      return null;
    },
  },
  recent: {
    defaultLabel: '🔄',
    build: ({ tokenInfo }) => {
      if (tokenInfo && tokenInfo.last_token_usage && typeof tokenInfo.last_token_usage.total_tokens === 'number') {
        return formatCompact(tokenInfo.last_token_usage.total_tokens);
      }
      if (!tokenInfo) return 'n/a';
      return null;
    },
  },
  total: {
    defaultLabel: '📦',
    build: ({ tokenInfo }) => {
      if (tokenInfo && tokenInfo.total_token_usage && typeof tokenInfo.total_token_usage.total_tokens === 'number') {
        return formatCompact(tokenInfo.total_token_usage.total_tokens);
      }
      return null;
    },
  },
  activity: {
    defaultLabel: '💭',
    build: ({ detail, minimal }) => {
      if (minimal) return null;
      const activity = detail.lastActivity;
      if (!activity) return null;
      
      const activityMap = {
        user: '👤',
        assistant: '⁉️',
        tool: '🔧',
        thinking: '🤔',
        review: '📝',
      };

      return activityMap[activity] || activity;
    },
  },
  directory: {
    defaultLabel: '📁',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      if (context.cwd) {
        const display = trimPath(context.cwd);
        if (display) return display;
      }
      return null;
    },
  },
};

function resolveSoundStatusIcon(options) {
  if (!options || !options.showSoundStatus) return null;
  if (!options.sound || options.sound === 'off') return null;
  const muted = Boolean(options.soundMuted);
  if (muted) return '🔇';
  return '🔊';
}

function nextReverbSetting(current) {
  const idx = SOUND_REVERB_SEQUENCE.indexOf(current || 'default');
  const nextIdx = (idx + 1) % SOUND_REVERB_SEQUENCE.length;
  return SOUND_REVERB_SEQUENCE[nextIdx];
}

function formatSessionSummary(detail, options = {}) {
  const minimal = Boolean(options.minimal);
  const labelOverrides = options.labelOverrides || {};
  const orderSource = Array.isArray(options.formatOrder) && options.formatOrder.length > 0
    ? options.formatOrder
    : DEFAULT_FORMAT_ORDER;
  const order = [];
  for (const entry of orderSource) {
    const key = normalizeFieldKey(entry);
    if (key && !order.includes(key)) order.push(key);
  }

  const context = detail.lastContext || {};
  const tokenCount = detail.lastTokenCount || null;
  const tokenInfo = tokenCount ? tokenCount.info || null : null;
  const rateLimits = tokenCount ? tokenCount.rate_limits || null : null;

  const fieldContext = {
    detail,
    minimal,
    context,
    tokenInfo,
    rateLimits,
    options,
  };

  const pieces = [];
  for (const key of order) {
    const definition = FIELD_DEFINITIONS[key];
    if (!definition) continue;
    const value = definition.build(fieldContext);
    if (value == null || value === '') continue;
    const override = Object.prototype.hasOwnProperty.call(labelOverrides, key)
      ? labelOverrides[key]
      : undefined;
    const label = override !== undefined ? override : definition.defaultLabel;
    if (label && String(label).length > 0) {
      pieces.push(`${label}${value}`);
    } else {
      pieces.push(String(value));
    }
  }

  if (!pieces.length) {
    return '⚡ no status';
  }

  return pieces.join(' ');
}

function buildReport(status, options = {}) {
  if (status.error) return status.error;
  const detail = status.sessions[0];
  if (!detail) return '⚡ no sessions';
  return formatSessionSummary(detail, options);
}

async function runOnce(options, stdout) {
  const status = await gatherStatuses(path.resolve(options.baseDir), options.limit);
  console.clear();
  const columns = stdout && Number.isInteger(stdout.columns) ? stdout.columns : null;
  stdout.write(`${truncateToTerminal(buildReport(status, options), columns)}\n`);
}

async function runWatch(options, stdout, deps = {}) {
  const baseDir = path.resolve(options.baseDir);
  const intervalMs = Math.max(1, options.interval) * 1000;
  const columns = () => (stdout && Number.isInteger(stdout.columns) ? stdout.columns : null);
  const gather = deps.gatherStatuses || gatherStatuses;
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const playSound = deps.playSound || playAlertSound;
  const stdin = deps.stdin || process.stdin;
  const processObj = deps.processObject || process;

  let running = false;
  let lastSeenActivity = null;
  let lastSeenTimestamp = null;
  let lastStatus = null;
  let soundMuted = false;
  let cleanedUp = false;
  let keypressListener = null;
  let rawModeEnabled = false;
  let messageCounter = 0;

  function cleanupInput() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (stdin && keypressListener) {
      stdin.removeListener('keypress', keypressListener);
    }
    if (stdin && rawModeEnabled && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
  }

  function updateSoundOptions() {
    options.soundMuted = soundMuted;
    options.showSoundStatus = options.sound !== 'off';
  }

  function isSoundMuted() {
    return options.sound === 'off' || soundMuted;
  }

  async function draw({ reuseLastStatus = false } = {}) {
    if (running) return;
    running = true;
    try {
      let status;
      let gathered = false;
      if (reuseLastStatus && lastStatus) {
        status = lastStatus;
      } else {
        status = await gather(baseDir, options.limit);
        lastStatus = status;
        gathered = true;
      }

      updateSoundOptions();
      const summary = buildReport(status, options);
      console.clear();
      stdout.write(`${truncateToTerminal(summary, columns())}\n`);

      // Check for any new activity if sound is enabled
      if (gathered && !isSoundMuted() && status.sessions && status.sessions.length > 0) {
        const detail = status.sessions[0];
        const currentActivity = detail.lastActivity;
        const currentTimestamp = detail.lastTimestamp ? detail.lastTimestamp.getTime() : null;
        
        if (lastSeenActivity === null && lastSeenTimestamp === null) {
          // First run, just record the state without playing sound
          lastSeenActivity = currentActivity;
          lastSeenTimestamp = currentTimestamp;
        } else if (currentTimestamp && currentTimestamp > lastSeenTimestamp) {
          // New activity detected (timestamp changed)!
          lastSeenActivity = currentActivity;
          lastSeenTimestamp = currentTimestamp;

          // Determine if we should play sound based on mode and activity
          let shouldPlay = false;
          
          if (options.sound === 'assistant') {
            // Only play for assistant messages
            shouldPlay = currentActivity === 'assistant';
          } else if (options.sound === 'some') {
            // Play for assistant messages always (tada sound)
            if (currentActivity === 'assistant') {
              shouldPlay = true;
              // Don't increment counter for assistant messages
            } else if (currentActivity !== 'user') {
              // For other non-user activities, increment counter and play every 2nd or 3rd
              messageCounter += 1;
              shouldPlay = messageCounter % 2 === 0 || messageCounter % 3 === 0;
            }
            // User messages are ignored (no sound, no counter increment)
          } else if (options.sound === 'all') {
            // Play for all non-user activities
            shouldPlay = currentActivity !== 'user';
          }

          if (shouldPlay) {
            playSound(currentActivity, options.sound, options.soundVolume, options.soundReverb);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  updateSoundOptions();

  if (stdin && typeof stdin.on === 'function') {
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
      rawModeEnabled = true;
      if (typeof stdin.resume === 'function') stdin.resume();
    }

    keypressListener = (str, key = {}) => {
      const sequence = typeof str === 'string' ? str : '';
      const keyName = key && typeof key.name === 'string' ? key.name : '';
      if (sequence && sequence.charCodeAt(0) === 3) {
        cleanupInput();
        if (processObj && typeof processObj.exit === 'function') {
          processObj.exit();
        } else {
          process.exit();
        }
        return;
      }
      if ((sequence && sequence.toLowerCase() === 'q') || keyName === 'q') {
        cleanupInput();
        if (processObj && typeof processObj.exit === 'function') {
          processObj.exit();
        } else {
          process.exit();
        }
        return;
      }
      if ((sequence && sequence.toLowerCase() === 'm') || keyName === 'm') {
        soundMuted = !soundMuted;
        updateSoundOptions();
        draw({ reuseLastStatus: true }).catch((err) => {
          console.error('Redraw failed after mute toggle:', err.message || err);
        });
      } else if ((sequence && sequence.toLowerCase() === 'r') || keyName === 'r') {
        if (options.sound === 'off') return;
        options.soundReverb = nextReverbSetting(options.soundReverb);
        updateSoundOptions();
        draw({ reuseLastStatus: true }).catch((err) => {
          console.error('Redraw failed after reverb toggle:', err.message || err);
        });
      }
    };

    stdin.on('keypress', keypressListener);
    if (processObj && typeof processObj.once === 'function') {
      processObj.once('SIGINT', () => {
        cleanupInput();
        if (typeof processObj.exit === 'function') {
          processObj.exit();
        } else {
          process.exit();
        }
      });
      processObj.once('exit', cleanupInput);
    }
  }

  await draw();
  setIntervalFn(() => {
    draw().catch((err) => {
      console.error('Watch update failed:', err.message || err);
    });
  }, intervalMs);
}

async function runCli({ argv = process.argv.slice(2), version = '0.0.0', stdout = process.stdout }) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(err.message || err);
    return 1;
  }

  const { options, showHelp, showVersion } = parsed;
  if (showHelp) {
    stdout.write(buildHelpMessage());
    return 0;
  }
  if (showVersion) {
    stdout.write(`codex-status v${version}\n`);
    return 0;
  }

  const requirementResult = ensureCodexCli('0.41.0');
  if (requirementResult !== true) {
    return requirementResult;
  }

  try {
    if (options.watch) {
      await runWatch(options, stdout);
    } else {
      await runOnce(options, stdout);
    }
    return 0;
  } catch (err) {
    console.error(err.message || err);
    return 1;
  }
}

module.exports = {
  runCli,
  ensureCodexCli,
  parseArgs,
  compareVersions,
  truncateToTerminal,
  runWatch,
  readLog,
};
