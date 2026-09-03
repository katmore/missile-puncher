import { CONFIG } from "../config";

/**
 * Tiny WebAudio synth. No samples — every sound is generated. The context is
 * created lazily and resumed on the first key press (autoplay policy).
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.sfx_master_gain;
    this.master.connect(this.ctx.destination);
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  punchConnect(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(CONFIG.sfx_punch_gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    g.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.15);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.08);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(ng).connect(this.master);
    src.start(t);
  }

  explosion(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.6);

    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(CONFIG.sfx_explosion_gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  private dropOsc: OscillatorNode | null = null;
  private dropGain: GainNode | null = null;
  private warnNodes: { osc: OscillatorNode; lfo: OscillatorNode; g: GainNode } | null =
    null;

  /** The pre-drop "incoming" warble — a high tremolo tone with a pitch wobble. */
  campWarnStart(): void {
    if (
      !CONFIG.sfx_camp_warn_enabled ||
      !this.ctx ||
      !this.master ||
      this.warnNodes
    ) {
      return;
    }
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CONFIG.sfx_camp_warn_gain, t + 0.25);
    g.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1500, t);

    // one LFO drives both a gain tremolo and a detune wobble → "weird"
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 8.5;

    const trem = this.ctx.createGain();
    trem.gain.value = CONFIG.sfx_camp_warn_gain * 0.6;
    lfo.connect(trem).connect(g.gain);

    const wob = this.ctx.createGain();
    wob.gain.value = 55; // cents
    lfo.connect(wob).connect(osc.detune);

    osc.connect(g);
    osc.start(t);
    lfo.start(t);
    this.warnNodes = { osc, lfo, g };
  }

  /** Stop the warble (dropper spawned, or the player moved off the spot). */
  campWarnStop(): void {
    if (!this.warnNodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    const { osc, lfo, g } = this.warnNodes;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.stop(t + 0.1);
    lfo.stop(t + 0.1);
    this.warnNodes = null;
  }

  /** Start the falling-dropper whine — a pitch sweeping down over the descent. */
  dropWhineStart(): void {
    if (!CONFIG.sfx_drop_enabled || !this.ctx || !this.master || this.dropOsc) {
      return;
    }
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CONFIG.sfx_drop_gain, t + 0.12);
    g.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 1.1);
    osc.connect(g);
    osc.start(t);

    this.dropOsc = osc;
    this.dropGain = g;
  }

  /** Stop the whine (dropper landed / was cleared). Safe to call any time. */
  dropWhineStop(): void {
    if (!this.dropOsc || !this.ctx || !this.dropGain) return;
    const t = this.ctx.currentTime;
    this.dropGain.gain.cancelScheduledValues(t);
    this.dropGain.gain.setValueAtTime(Math.max(0.0001, this.dropGain.gain.value), t);
    this.dropGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    this.dropOsc.stop(t + 0.07);
    this.dropOsc = null;
    this.dropGain = null;
  }

  reflect(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(CONFIG.sfx_reflect_gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    g.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.2);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.24);
  }
}
