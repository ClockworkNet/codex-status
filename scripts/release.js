#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

function log(step, message) {
  process.stdout.write(`\n[${step}] ${message}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    const pretty = [command, ...args].join(' ');
    throw new Error(`Command failed: ${pretty}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (result.status !== 0) {
    const pretty = [command, ...args].join(' ');
    const stderr = result.stderr?.toString() || '';
    throw new Error(`Command failed: ${pretty}\n${stderr}`);
  }
  return result.stdout.toString().trim();
}

function ensureCleanWorkingTree() {
  const status = runCapture('git', ['status', '--porcelain']);
  if (status) {
    throw new Error('Working tree is not clean. Commit or stash your changes before running the release script.');
  }
}

function ensureTagDoesNotExist(tagName) {
  const existing = runCapture('git', ['tag', '--list', tagName]);
  if (existing === tagName) {
    throw new Error(`Tag ${tagName} already exists. Bump the version in package.json before re-running.`);
  }
}

function getVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return pkg.version;
}

function runTests() {
  log('test', 'Running npm test');
  run('npm', ['test']);
}

function createArchive(version) {
  const archiveName = `codex-status-v${version}.tar.gz`;
  const outputDir = resolve('dist');
  mkdirSync(outputDir, { recursive: true });
  const archivePath = join(outputDir, archiveName);
  try {
    rmSync(archivePath);
  } catch (_) {
    // nothing to clean up
  }
  log('archive', `Creating git archive at ${archivePath}`);
  run('git', ['archive', '--format=tar.gz', `--prefix=codex-status-${version}/`, 'HEAD', '-o', archivePath]);
  return archivePath;
}

function calculateSha256(filePath) {
  const hash = runCapture('shasum', ['-a', '256', filePath]);
  const [sha] = hash.split(/\s+/);
  return sha;
}

function updateFormula(version, sha) {
  const formulaPath = 'HomebrewFormula/codex-status.rb';
  const formula = readFileSync(formulaPath, 'utf8');
  const versionUrlPattern = /url "https:\/\/github\.com\/clockworknet\/codex-status\/archive\/refs\/tags\/v[\d.]+\.tar\.gz"/;
  const shaPattern = /sha256 "[^"]+"/;
  if (!versionUrlPattern.test(formula)) {
    throw new Error('Unable to locate url line in formula. Confirm the expected format.');
  }
  if (!shaPattern.test(formula)) {
    throw new Error('Unable to locate sha256 line in formula. Confirm the expected format.');
  }
  const updated = formula
    .replace(versionUrlPattern, `url "https://github.com/clockworknet/codex-status/archive/refs/tags/v${version}.tar.gz"`)
    .replace(shaPattern, `sha256 "${sha}"`);
  writeFileSync(formulaPath, updated);
  log('formula', `Updated Homebrew formula with version v${version} and SHA.`);
}

function main() {
  try {
    log('check', 'Ensuring working tree is clean');
    ensureCleanWorkingTree();

    const version = getVersion();
    const tagName = `v${version}`;
    log('version', `Preparing release for ${tagName}`);

    ensureTagDoesNotExist(tagName);
    runTests();

    const archivePath = createArchive(version);
    const sha = calculateSha256(archivePath);
    log('sha', `SHA256 for ${archivePath}: ${sha}`);

    updateFormula(version, sha);

    log('next', 'Review changes, commit, then tag and push when ready.');
  } catch (error) {
    const message = error?.message || error;
    process.stderr.write(`\nError: ${message}\n`);
    process.exit(1);
  }
}

main();
