const STORAGE_KEY = 'chat_sound_settings_v1';

const DEFAULT_SETTINGS = {
  masterEnabled: true,
  messageSoundsEnabled: true,
  callSoundsEnabled: true,
  volumeLevel: 'normal'
};

const VOLUME_MULTIPLIER = {
  low: 0.55,
  normal: 1,
  high: 1.35
};

class SoundManager {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.incomingRingTimer = null;
    this.outgoingRingTimer = null;
    this.settings = this.readSettings();
  }

  readSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };

      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        volumeLevel: ['low', 'normal', 'high'].includes(parsed?.volumeLevel)
          ? parsed.volumeLevel
          : 'normal'
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage errors.
    }
  }

  getSettings() {
    return { ...this.settings };
  }

  updateSettings(partialSettings) {
    this.settings = {
      ...this.settings,
      ...partialSettings
    };

    if (!['low', 'normal', 'high'].includes(this.settings.volumeLevel)) {
      this.settings.volumeLevel = 'normal';
    }

    this.persistSettings();

    if (!this.settings.masterEnabled || !this.settings.callSoundsEnabled) {
      this.stopAllRingtones();
    }

    return this.getSettings();
  }

  setEnabled(nextEnabled) {
    this.updateSettings({ masterEnabled: Boolean(nextEnabled) });
  }

  canPlayMessages() {
    return Boolean(this.settings.masterEnabled && this.settings.messageSoundsEnabled);
  }

  canPlayCalls() {
    return Boolean(this.settings.masterEnabled && this.settings.callSoundsEnabled);
  }

  getVolumeMultiplier() {
    return VOLUME_MULTIPLIER[this.settings.volumeLevel] || 1;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const unlock = () => {
      this.ensureAudioContext();
      this.resumeContext();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  ensureAudioContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    return this.ctx;
  }

  async resumeContext() {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore resume error and keep app functional.
      }
    }
  }

  playTone({ frequency = 600, duration = 0.08, type = 'sine', volume = 0.08 }) {
    if (!this.settings.masterEnabled) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const effectiveVolume = Math.max(0.0001, volume * this.getVolumeMultiplier());

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(effectiveVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playMessageSent() {
    if (!this.canPlayMessages()) return;
    this.resumeContext();
    this.playTone({ frequency: 980, duration: 0.045, type: 'triangle', volume: 0.05 });
    setTimeout(() => {
      this.playTone({ frequency: 1240, duration: 0.04, type: 'triangle', volume: 0.04 });
    }, 42);
  }

  playMessageReceived() {
    if (!this.canPlayMessages()) return;
    this.resumeContext();
    this.playTone({ frequency: 740, duration: 0.06, type: 'sine', volume: 0.06 });
    setTimeout(() => {
      this.playTone({ frequency: 660, duration: 0.05, type: 'sine', volume: 0.05 });
    }, 70);
  }

  playCallConnected() {
    if (!this.canPlayCalls()) return;
    this.resumeContext();
    this.playTone({ frequency: 880, duration: 0.06, type: 'triangle', volume: 0.07 });
    setTimeout(() => {
      this.playTone({ frequency: 1175, duration: 0.07, type: 'triangle', volume: 0.06 });
    }, 70);
  }

  playCallEnded() {
    if (!this.canPlayCalls()) return;
    this.resumeContext();
    this.playTone({ frequency: 540, duration: 0.08, type: 'sawtooth', volume: 0.06 });
    setTimeout(() => {
      this.playTone({ frequency: 420, duration: 0.09, type: 'sawtooth', volume: 0.05 });
    }, 85);
  }

  startIncomingRingtone() {
    if (!this.canPlayCalls()) return;
    this.stopIncomingRingtone();
    this.resumeContext();

    const playTick = () => {
      this.playTone({ frequency: 740, duration: 0.22, type: 'sine', volume: 0.07 });
      setTimeout(() => {
        this.playTone({ frequency: 740, duration: 0.22, type: 'sine', volume: 0.07 });
      }, 340);
    };

    playTick();
    this.incomingRingTimer = setInterval(playTick, 1800);
  }

  stopIncomingRingtone() {
    if (this.incomingRingTimer) {
      clearInterval(this.incomingRingTimer);
      this.incomingRingTimer = null;
    }
  }

  startOutgoingRingback() {
    if (!this.canPlayCalls()) return;
    this.stopOutgoingRingback();
    this.resumeContext();

    const playTick = () => {
      this.playTone({ frequency: 425, duration: 0.33, type: 'sine', volume: 0.045 });
      setTimeout(() => {
        this.playTone({ frequency: 425, duration: 0.33, type: 'sine', volume: 0.045 });
      }, 700);
    };

    playTick();
    this.outgoingRingTimer = setInterval(playTick, 2400);
  }

  stopOutgoingRingback() {
    if (this.outgoingRingTimer) {
      clearInterval(this.outgoingRingTimer);
      this.outgoingRingTimer = null;
    }
  }

  stopAllRingtones() {
    this.stopIncomingRingtone();
    this.stopOutgoingRingback();
  }
}

export const soundManager = new SoundManager();
