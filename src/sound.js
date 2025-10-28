const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

function generateBeepWav(frequency = 800, durationMs = 200, sampleRate = 8000, volume = 0.15) {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  
  // WAV file header (44 bytes)
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + numSamples * 2, 4); // file size - 8
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20);  // audio format (1 = PCM)
  header.writeUInt16LE(1, 22);  // number of channels (1 = mono)
  header.writeUInt32LE(sampleRate, 24); // sample rate
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);  // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(numSamples * 2, 40); // data chunk size
  
  // Generate sine wave samples with envelope (fade in/out to avoid clicks)
  const samples = Buffer.alloc(numSamples * 2);
  const fadeLength = Math.min(numSamples / 10, sampleRate / 100); // 10ms fade
  
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    let amplitude = 1.0;
    
    // Fade in
    if (i < fadeLength) {
      amplitude = i / fadeLength;
    }
    // Fade out
    if (i > numSamples - fadeLength) {
      amplitude = (numSamples - i) / fadeLength;
    }
    
    // Softer volume (0.3 default instead of 0.9)
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude * 32767 * volume;
    samples.writeInt16LE(Math.round(sample), i * 2);
  }
  
  return Buffer.concat([header, samples]);
}

function applyLowpassFilter(audioSamples, cutoffFreq = 3000, sampleRate = 8000) {
  // Simple one-pole lowpass filter (smooths high frequencies)
  // RC filter coefficient: alpha = dt / (RC + dt) where RC = 1 / (2*pi*cutoff)
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffFreq);
  const alpha = dt / (rc + dt);
  
  const numSamples = audioSamples.length / 2;
  const output = Buffer.alloc(audioSamples.length);
  
  let previousOutput = 0;
  
  for (let i = 0; i < numSamples; i += 1) {
    const input = audioSamples.readInt16LE(i * 2);
    // Lowpass formula: y[n] = y[n-1] + alpha * (x[n] - y[n-1])
    const filtered = previousOutput + alpha * (input - previousOutput);
    output.writeInt16LE(Math.round(filtered), i * 2);
    previousOutput = filtered;
  }
  
  return output;
}

function applyReverb(audioSamples, sampleRate = 8000) {
  // Enhanced reverb with multiple echoes and longer tail
  const numSamples = audioSamples.length / 2;
  
  // Add extra space for reverb tail (999ms)
  const tailSamples = Math.floor(sampleRate * 5);
  const totalSamples = numSamples + tailSamples;
  const output = Buffer.alloc(totalSamples * 2);
  
  // Multiple delay lines with different lengths (in samples) 
  const delays = [
    { time: Math.floor(sampleRate * 0.323), gain: 0.1 }, // ~323ms
    // { time: Math.floor(sampleRate * 0.359), gain: 0.35 }, // ~359ms
    { time: Math.floor(sampleRate * 0.397), gain: 0.06 }, // ~397ms
    // { time: Math.floor(sampleRate * 0.437), gain: 0.04 }, // ~437ms
    { time: Math.floor(sampleRate * 0.479), gain: 0.02 }, // ~479ms
    // { time: Math.floor(sampleRate * 0.523), gain: 0.01 }, // ~523ms
    { time: Math.floor(sampleRate * 0.569), gain: 0.005 }, // ~569ms
    // { time: Math.floor(sampleRate * 0.617), gain: 0.0025 }, // ~617ms
    { time: Math.floor(sampleRate * 0.667), gain: 0.00125 }, // ~667ms
  ];
  
  // Process each sample
  for (let i = 0; i < totalSamples; i += 1) {
    // Get dry signal (0 if past original length)
    const drySignal = i < numSamples ? audioSamples.readInt16LE(i * 2) : 0;
    let wetSignal = 0;
    
    // Add multiple echoes with decay
    for (const delay of delays) {
      if (i >= delay.time) {
        const echoIdx = i - delay.time;
        if (echoIdx < numSamples) {
          const echoSample = audioSamples.readInt16LE(echoIdx * 2);
          wetSignal += echoSample * delay.gain;
        }
        // Also add feedback from previous output for longer tail
        if (echoIdx < i) {
          const feedbackSample = output.readInt16LE(echoIdx * 2);
          wetSignal += feedbackSample * delay.gain * 0.3;
        }
      }
    }
    
    // Mix dry (50%) and wet (50%) signals - more reverb!
    const mixed = drySignal * 0.3 + wetSignal * 0.5;
    output.writeInt16LE(Math.round(Math.max(-32767, Math.min(32767, mixed))), i * 2);
  }
  
  return output;
}

function generateMultiToneBeep(frequencies, noteDuration = 180, withReverb = true) {
  // Generate a sequence of tones
  const beeps = frequencies.map(freq => generateBeepWav(freq, noteDuration));
  
  // Extract audio samples (skip 44-byte header for all but first)
  const allSamples = [beeps[0].slice(44)];
  for (let i = 1; i < beeps.length; i += 1) {
    allSamples.push(beeps[i].slice(44));
  }
  
  // Concatenate all samples
  const combinedSamples = Buffer.concat(allSamples);
  
  // Apply lowpass filter to smooth high frequencies
  const filteredSamples = applyLowpassFilter(combinedSamples, 3000);
  
  // Apply reverb if requested
  const finalSamples = withReverb ? applyReverb(filteredSamples) : filteredSamples;
  
  // Create new header for combined length
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + finalSamples.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(finalSamples.length, 40);
  
  return Buffer.concat([header, finalSamples]);
}

function getG6MajorChordFrequencies() {
  // G6 major chord: G-B-D-E across 3 octaves
  // Starting from G4 (392Hz) up to G7
  return {
    // Octave 4
    G4: 392.00,
    B4: 493.88,
    D5: 587.33,
    E5: 659.25,
    // Octave 5
    G5: 783.99,
    B5: 987.77,
    D6: 1174.66,
    E6: 1318.51,
    // Octave 6
    G6: 1567.98,
  };
}

function generateG6ChordBeep(isAssistant = false) {
  const freqs = getG6MajorChordFrequencies();
  const allNotes = [
    freqs.G4, freqs.B4, freqs.D5, freqs.E5,
    freqs.G5, freqs.B5, freqs.D6, freqs.E6,
    freqs.G6
  ];
  
  if (isAssistant) {
    // Assistant: ascending arpeggio through all notes (120ms per note)
    return generateMultiToneBeep(allNotes, 120);
  }
  
  // Random selection: pick 2-3 random notes
  const count = 3 + Math.floor(Math.random() * 2); // 3 or 4 notes
  const selected = [];
  const available = [...allNotes];
  
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(Math.random() * available.length);
    selected.push(available[idx]);
    available.splice(idx, 1);
  }
  
  // Sort selected notes ascending
  selected.sort((a, b) => a - b);
  
  return generateMultiToneBeep(selected, 180);
}

function playAlertSound(activityType, overrides = {}) {
  const useSpawn = overrides.spawn || spawn;
  const platform = overrides.platform || os.platform();
  const tmpdir = overrides.tmpdir || os.tmpdir();
  const isAssistant = activityType === 'assistant';

  try {
    if (platform === 'darwin') {
      // macOS: afplay requires a file, can't read from stdin
      // Write to temp file and play it
      const wav = generateG6ChordBeep(isAssistant);
      const tmpFile = path.join(tmpdir, `codex-beep-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, wav);
      const player = useSpawn('afplay', [tmpFile], {
        stdio: 'ignore',
      });
      player.on('close', () => {
        // Clean up temp file after playback
        try {
          fs.unlinkSync(tmpFile);
        } catch (err) {
          // Ignore cleanup errors
        }
      });
    } else if (platform === 'linux') {
      // Linux: aplay and paplay support stdin
      const wav = generateG6ChordBeep(isAssistant);
      const player = useSpawn('aplay', ['-q', '-'], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      player.on('error', () => {
        // Try paplay as fallback
        const player2 = useSpawn('paplay', ['-'], {
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        player2.stdin.write(wav);
        player2.stdin.end();
        player2.on('error', () => {
          process.stdout.write('\x07');
        });
      });
      player.stdin.write(wav);
      player.stdin.end();
    } else if (platform === 'win32') {
      // Windows: Simple beep (can't easily do chord progression)
      spawnSync('powershell', ['-c', '[console]::beep(392,200)'], {
        stdio: 'ignore',
        timeout: 2000,
        windowsHide: true,
      });
    } else {
      // Universal fallback: terminal bell
      process.stdout.write('\x07');
    }
  } catch (err) {
    // Silently fail - sound is non-critical
  }
}

module.exports = {
  generateBeepWav,
  applyLowpassFilter,
  applyReverb,
  generateMultiToneBeep,
  getG6MajorChordFrequencies,
  generateG6ChordBeep,
  playAlertSound,
};

