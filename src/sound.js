const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

function generateBeepWav(frequency = 800, durationMs = 200, sampleRate = 8000, volumePercent = 100) {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  
  // Scale volume: 1-100 maps to 0.0015-0.15 (15% max of full scale)
  const volume = Math.max(1, Math.min(100, volumePercent)) * 0.0015;
  
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

// Reverb preset configurations
const REVERB_PRESETS = {
  none: null,  // No reverb - dry signal only
  subtle: {
    tailSeconds: 0.5,
    numDelays: 3,
    wetMix: 0.3,
    dryMix: 0.5,
    feedbackGain: 0.15,
  },
  default: {
    tailSeconds: 1.5,
    numDelays: 5,
    wetMix: 0.5,
    dryMix: 0.3,
    feedbackGain: 0.3,
  },
  lush: {
    tailSeconds: 4.5,
    numDelays: 9,
    wetMix: 0.85,
    dryMix: 0.15,
    feedbackGain: 0.6,
  },
};

function applyReverb(audioSamples, sampleRate = 8000, options = {}) {
  // If a preset name is provided, use it; otherwise use custom options or defaults
  let reverbConfig;
  if (typeof options === 'string' && options in REVERB_PRESETS) {
    reverbConfig = REVERB_PRESETS[options];
    // If preset is 'none', return audio unchanged
    if (reverbConfig === null) return audioSamples;
  } else if (typeof options === 'object') {
    const preset = options.preset && REVERB_PRESETS[options.preset];
    // If preset is 'none', return audio unchanged
    if (preset === null) return audioSamples;
    
    reverbConfig = {
      tailSeconds: options.tailSeconds ?? preset?.tailSeconds ?? 1.5,
      numDelays: options.numDelays ?? preset?.numDelays ?? 5,
      wetMix: options.wetMix ?? preset?.wetMix ?? 0.5,
      dryMix: options.dryMix ?? preset?.dryMix ?? 0.3,
      feedbackGain: options.feedbackGain ?? preset?.feedbackGain ?? 0.3,
    };
  } else {
    reverbConfig = REVERB_PRESETS.default;
  }
  
  const {
    tailSeconds,
    numDelays,
    wetMix,
    dryMix,
    feedbackGain,
  } = reverbConfig;
  
  const numSamples = audioSamples.length / 2;
  
  // Add extra space for reverb tail
  const tailSamples = Math.floor(sampleRate * tailSeconds);
  const totalSamples = numSamples + tailSamples;
  const output = Buffer.alloc(totalSamples * 2);
  
  // Predefined delay times in seconds (prime numbers for less resonance)
  const baseDelayTimes = [
    0.323, 0.359, 0.397, 0.437, 0.479, 0.523, 0.569, 0.617, 0.667
  ];
  
  // Select the specified number of delay lines
  const selectedDelayTimes = baseDelayTimes.slice(0, Math.max(1, Math.min(9, numDelays)));
  
  // Generate delay configuration with exponential decay
  const delays = selectedDelayTimes.map((time, idx) => {
    // Exponential decay: first delays are louder
    const gain = 0.1 * Math.pow(0.6, idx);
    return {
      time: Math.floor(sampleRate * time),
      gain,
    };
  });
  
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
          wetSignal += feedbackSample * delay.gain * feedbackGain;
        }
      }
    }
    
    // Mix dry and wet signals
    const mixed = drySignal * dryMix + wetSignal * wetMix;
    output.writeInt16LE(Math.round(Math.max(-32767, Math.min(32767, mixed))), i * 2);
  }
  
  return output;
}

function generateMultiToneBeep(frequencies, noteDuration = 180, reverbOptions = 'default') {
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
  
  // Apply reverb (supports preset strings, options objects, false, or 'none' to disable)
  const finalSamples = (reverbOptions === false || reverbOptions === 'none')
    ? filteredSamples 
    : applyReverb(filteredSamples, 8000, reverbOptions);

  return wrapSamplesWithHeader(finalSamples);
}

function wrapSamplesWithHeader(finalSamples) {
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

// Cache for pre-generated audio buffers
let preGeneratedSounds = null;

function initializePreGeneratedSounds(volumePercent = 100) {
  if (preGeneratedSounds) return; // Already initialized
  
  const freqs = getG6MajorChordFrequencies();
  const allNotes = [
    freqs.G4, freqs.B4, freqs.D5, freqs.E5,
    freqs.G5, freqs.B5, freqs.D6, freqs.E6,
    freqs.G6
  ];
  
  // Pre-generate individual note buffers (180ms duration for non-assistant)
  const noteBuffers = allNotes.map(freq => {
    const beep = generateBeepWav(freq, 180, 8000, volumePercent);
    // Extract just the audio samples (skip header)
    return beep.slice(44);
  });
  
  // Pre-generate assistant note buffers (120ms per note)
  const assistantNoteBuffers = allNotes.map(freq => {
    const beep = generateBeepWav(freq, 120, 8000, volumePercent);
    // Extract just the audio samples (skip header)
    return beep.slice(44);
  });
  
  preGeneratedSounds = {
    noteBuffers,
    assistantNoteBuffers,
    noteFrequencies: allNotes,
  };
}

function generateG6ChordBeep(activityType, soundMode = 'all', volumePercent = 100, reverbOptions = 'default') {
  // Lazy initialization - only generate sounds when first needed
  initializePreGeneratedSounds(volumePercent);

  const isAssistant = activityType === 'assistant';

  if (isAssistant) {
    // Generate assistant sound with specified reverb
    const combinedSamples = Buffer.concat(preGeneratedSounds.assistantNoteBuffers);
    const filteredSamples = applyLowpassFilter(combinedSamples, 3000);
    const finalSamples = (reverbOptions === false || reverbOptions === 'none')
      ? filteredSamples
      : applyReverb(filteredSamples, 8000, reverbOptions);
    
    return wrapSamplesWithHeader(finalSamples);
  }

  // Non-assistant sounds: select random notes and combine them
  const noteCount = soundMode === 'some' ? 2 : 3 + Math.floor(Math.random() * 2);
  const availableIndices = Array.from({ length: preGeneratedSounds.noteBuffers.length }, (_, i) => i);
  const selectedIndices = [];
  
  // Pick random note indices
  for (let i = 0; i < noteCount; i += 1) {
    const idx = Math.floor(Math.random() * availableIndices.length);
    selectedIndices.push(availableIndices[idx]);
    availableIndices.splice(idx, 1);
  }
  
  // Sort indices by frequency (descending - high to low)
  selectedIndices.sort((a, b) => 
    preGeneratedSounds.noteFrequencies[b] - preGeneratedSounds.noteFrequencies[a]
  );
  
  // Concatenate selected note buffers
  const selectedBuffers = selectedIndices.map(idx => preGeneratedSounds.noteBuffers[idx]);
  const combinedSamples = Buffer.concat(selectedBuffers);
  
  // Apply processing
  const filteredSamples = applyLowpassFilter(combinedSamples, 3000);
  const finalSamples = (reverbOptions === false || reverbOptions === 'none')
    ? filteredSamples
    : applyReverb(filteredSamples, 8000, reverbOptions);
  
  return wrapSamplesWithHeader(finalSamples);
}

function playAlertSound(activityType, soundMode = 'all', volumePercent = 100, reverbOptions = 'default', overrides = {}) {
  const useSpawn = overrides.spawn || spawn;
  const platform = overrides.platform || os.platform();
  const tmpdir = overrides.tmpdir || os.tmpdir();

  try {
    if (platform === 'darwin') {
      // macOS: afplay requires a file, can't read from stdin
      // Write to temp file and play it
      const wav = generateG6ChordBeep(activityType, soundMode, volumePercent, reverbOptions);
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
      const wav = generateG6ChordBeep(activityType, soundMode, volumePercent, reverbOptions);
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
  REVERB_PRESETS,
};
