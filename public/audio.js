(() => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const readSetting = (key, fallback) => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : saved === "true";
    } catch {
      return fallback;
    }
  };
  const saveSetting = (key, value) => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Audio settings still work for this page when storage is unavailable.
    }
  };

  let context = null;
  let musicBus = null;
  let effectsBus = null;
  let musicEnabled = readSetting("remoteDuelMusic", true);
  let effectsEnabled = readSetting("remoteDuelEffects", true);
  let musicTimer = null;
  let musicNodes = new Set();
  let musicStep = 0;
  let nextMusicNote = 0;
  let started = false;

  const progression = [
    [45, 52, 57, 60, 64, 67],
    [41, 48, 53, 57, 60, 64],
    [36, 43, 48, 52, 55, 60],
    [43, 50, 55, 59, 62, 67]
  ];
  const stepPattern = [0, 3, 4, 2, 1, 4, 5, 2];
  const stepDuration = 60 / 76 / 2;

  function initialize() {
    if (!AudioContextClass) return false;
    if (!context) {
      context = new AudioContextClass();
      musicBus = context.createGain();
      effectsBus = context.createGain();
      musicBus.gain.value = musicEnabled ? 0.24 : 0;
      effectsBus.gain.value = effectsEnabled ? 0.48 : 0;
      musicBus.connect(context.destination);
      effectsBus.connect(context.destination);
    }
    if (context.state === "suspended") context.resume();
    if (musicEnabled && !musicTimer) startMusic();
    return true;
  }

  function makeTone(frequency, startAt, duration, volume, type, bus, options = {}) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, startAt + duration);
    }
    if (options.detune) oscillator.detune.setValueAtTime(options.detune, startAt);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.025, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
    return oscillator;
  }

  function trackMusicNode(node) {
    musicNodes.add(node);
    node.addEventListener("ended", () => musicNodes.delete(node), { once: true });
  }

  function scheduleMusic() {
    if (!context || !musicEnabled) return;
    while (nextMusicNote < context.currentTime + 0.12) {
      const chordIndex = Math.floor(musicStep / 8) % progression.length;
      const stepInChord = musicStep % 8;
      const chord = progression[chordIndex];
      const note = chord[stepPattern[stepInChord]];
      const frequency = 440 * Math.pow(2, (note - 69) / 12);
      const pluck = makeTone(frequency, nextMusicNote, 0.48, 0.10, "triangle", musicBus);
      trackMusicNode(pluck);
      if (stepInChord === 0) {
        chord.slice(0, 4).forEach((midi, index) => {
          const padFrequency = 440 * Math.pow(2, (midi + 12 - 69) / 12);
          const pad = makeTone(padFrequency, nextMusicNote, stepDuration * 7.5, index === 0 ? 0.024 : 0.012, "sine", musicBus);
          trackMusicNode(pad);
        });
      }
      if (stepInChord === 0 || stepInChord === 4) {
        const bassFrequency = 440 * Math.pow(2, (chord[0] - 12 - 69) / 12);
        const bass = makeTone(bassFrequency, nextMusicNote, stepDuration * 3.5, 0.12, "sine", musicBus);
        trackMusicNode(bass);
      }
      nextMusicNote += stepDuration;
      musicStep += 1;
    }
  }

  function startMusic() {
    if (!context || musicTimer) return;
    musicBus.gain.cancelScheduledValues(context.currentTime);
    musicBus.gain.setTargetAtTime(0.24, context.currentTime, 0.25);
    nextMusicNote = context.currentTime + 0.06;
    musicTimer = window.setInterval(scheduleMusic, 60);
    scheduleMusic();
  }

  function stopMusic() {
    if (musicTimer) window.clearInterval(musicTimer);
    musicTimer = null;
    if (!context) return;
    const now = context.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(0, now, 0.025);
    musicNodes.forEach(node => {
      try {
        node.stop(now + 0.08);
      } catch {
        // A note may have naturally ended just before music was switched off.
      }
    });
    musicNodes.clear();
    musicStep = 0;
  }

  function playEffect(notes, type = "sine") {
    if (!effectsEnabled || !initialize()) return;
    const startAt = context.currentTime + 0.01;
    notes.forEach(({ frequency, duration = 0.18, volume = 0.2, delay = 0, endFrequency }) => {
      makeTone(frequency, startAt + delay, duration, volume, type, effectsBus, { endFrequency });
    });
  }

  const audio = {
    available: !!AudioContextClass,
    get musicEnabled() { return musicEnabled; },
    get effectsEnabled() { return effectsEnabled; },
    unlock: initialize,
    toggleMusic() {
      musicEnabled = !musicEnabled;
      saveSetting("remoteDuelMusic", musicEnabled);
      if (musicEnabled) initialize();
      else stopMusic();
      return musicEnabled;
    },
    toggleEffects() {
      effectsEnabled = !effectsEnabled;
      saveSetting("remoteDuelEffects", effectsEnabled);
      if (initialize()) {
        effectsBus.gain.setTargetAtTime(effectsEnabled ? 0.48 : 0, context.currentTime, 0.04);
      }
      return effectsEnabled;
    },
    playMove(mark) {
      const base = mark === "X" ? 660 : 523.25;
      playEffect([{ frequency: base, duration: 0.12, volume: 0.26 }, { frequency: base * 1.5, duration: 0.16, volume: 0.12, delay: 0.035 }], "triangle");
    },
    playJoin() {
      playEffect([{ frequency: 523.25, volume: 0.16 }, { frequency: 659.25, delay: 0.1, volume: 0.16 }, { frequency: 783.99, delay: 0.2, volume: 0.2 }]);
    },
    playWin() {
      playEffect([{ frequency: 523.25, duration: 0.32, volume: 0.2 }, { frequency: 659.25, duration: 0.36, delay: 0.11, volume: 0.2 }, { frequency: 783.99, duration: 0.5, delay: 0.22, volume: 0.24 }, { frequency: 1046.5, duration: 0.65, delay: 0.34, volume: 0.2 }]);
    },
    playLose() {
      playEffect([{ frequency: 392, duration: 0.24, volume: 0.18 }, { frequency: 329.63, duration: 0.3, delay: 0.16, volume: 0.15 }, { frequency: 261.63, duration: 0.46, delay: 0.34, volume: 0.14 }]);
    },
    playDraw() {
      playEffect([{ frequency: 440, duration: 0.24, volume: 0.16 }, { frequency: 523.25, duration: 0.36, delay: 0.16, volume: 0.18 }]);
    },
    playAccept() {
      playEffect([{ frequency: 659.25, duration: 0.18, volume: 0.16 }, { frequency: 880, duration: 0.32, delay: 0.12, volume: 0.2 }]);
    },
    playRequest() {
      playEffect([{ frequency: 587.33, duration: 0.14, volume: 0.16 }, { frequency: 739.99, duration: 0.22, delay: 0.11, volume: 0.18 }]);
    }
  };

  window.RemoteDuelAudio = audio;
  document.addEventListener("pointerdown", () => {
    if (!started) {
      started = true;
      initialize();
    }
  }, { once: true });
  document.addEventListener("keydown", () => {
    if (!started) {
      started = true;
      initialize();
    }
  }, { once: true });
})();
