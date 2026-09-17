import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';

const SETTINGS_KEY = 'woogi-pomodoro';
const DEFAULTS = { focus: 25, short: 5, long: 15, rounds: 4, sound: true };
const PHASES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const RING = 2 * Math.PI * 88;
const eq = (a, b) => a === b;

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

function chime() {
  try {
    const audio = new AudioContext();
    [0, 0.22, 0.44].forEach((delay, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = [660, 880, 990][i];
      gain.gain.setValueAtTime(0.0001, audio.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.25,
        audio.currentTime + delay + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audio.currentTime + delay + 0.5,
      );
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + delay);
      osc.stop(audio.currentTime + delay + 0.55);
    });
    setTimeout(() => audio.close(), 1500);
  } catch {
    // audio unavailable; the visual change still signals the phase switch
  }
}

export default class PomodoroTimerPage extends Component {
  @tracked settings = loadSettings();
  @tracked phase = 'focus';
  @tracked round = 1;
  @tracked remaining = this.settings.focus * 60 * 1000;
  @tracked running = false;
  @tracked completed = 0;

  endsAt = null;
  interval = null;
  originalTitle = document.title;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      clearInterval(this.interval);
      document.title = this.originalTitle;
    });
  }

  get phaseLength() {
    return this.settings[this.phase] * 60 * 1000;
  }

  get clock() {
    const total = Math.max(0, Math.ceil(this.remaining / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  get phaseLabel() {
    return PHASES[this.phase];
  }

  get ringStyle() {
    const done = this.phaseLength ? 1 - this.remaining / this.phaseLength : 0;
    return htmlSafe(
      `stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - Math.min(1, Math.max(0, done)))}`,
    );
  }

  get roundDots() {
    return Array.from({ length: this.settings.rounds }, (_, i) => ({
      done:
        i < this.round - 1 || (i === this.round - 1 && this.phase !== 'focus'),
    }));
  }

  // Timing comes from the wall clock, so a throttled background tab stays accurate.
  tick = () => {
    this.remaining = Math.max(0, this.endsAt - Date.now());
    document.title = `${this.clock} · ${this.phaseLabel}`;
    if (this.remaining === 0) this.advance(true);
  };

  start = () => {
    if (this.running) return;
    if ('Notification' in window && Notification.permission === 'default')
      Notification.requestPermission();
    this.running = true;
    this.endsAt = Date.now() + this.remaining;
    this.interval = setInterval(this.tick, 250);
  };

  pause = () => {
    this.running = false;
    clearInterval(this.interval);
    this.remaining = Math.max(0, this.endsAt - Date.now());
    document.title = this.originalTitle;
  };

  reset = () => {
    this.pause();
    this.remaining = this.phaseLength;
  };

  advance(finished = false) {
    const wasRunning = this.running;
    this.pause();
    if (finished) {
      if (this.settings.sound) chime();
      if (
        'Notification' in window &&
        Notification.permission === 'granted' &&
        document.hidden
      ) {
        new Notification(
          this.phase === 'focus'
            ? 'Focus session done. Time for a break.'
            : 'Break over. Back to it.',
        );
      }
    }
    if (this.phase === 'focus') {
      this.completed++;
      this.phase = this.round >= this.settings.rounds ? 'long' : 'short';
    } else {
      this.round = this.phase === 'long' ? 1 : this.round + 1;
      this.phase = 'focus';
    }
    this.remaining = this.phaseLength;
    // Finishing a phase flows straight into the next one; skipping keeps the current state.
    if (finished || wasRunning) this.start();
  }

  skip = () => this.advance(false);

  choosePhase = (phase) => {
    this.pause();
    this.phase = phase;
    this.remaining = this.phaseLength;
  };

  updateSetting = (key, event) => {
    const value =
      key === 'sound'
        ? event.target.checked
        : Math.min(
            key === 'rounds' ? 12 : 180,
            Math.max(1, Math.floor(+event.target.value) || 1),
          );
    this.settings = { ...this.settings, [key]: value };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // storage blocked: settings still apply for this visit
    }
    if (!this.running && key === this.phase) this.remaining = this.phaseLength;
  };

  <template>
    <ToolPage
      @route="pomodoro-timer"
      @subtitle="Work in focused sessions with little breaks in between, and a longer break every few rounds."
    >
      <div class="math-grid pop-in">
        <section class="math-card pomo-card">
          <div class="math-tabs" role="group" aria-label="Phase">
            <button
              type="button"
              class="qr-tab {{if (eq this.phase 'focus') 'active'}}"
              {{on "click" (fn this.choosePhase "focus")}}
            >Focus</button>
            <button
              type="button"
              class="qr-tab {{if (eq this.phase 'short') 'active'}}"
              {{on "click" (fn this.choosePhase "short")}}
            >Short break</button>
            <button
              type="button"
              class="qr-tab {{if (eq this.phase 'long') 'active'}}"
              {{on "click" (fn this.choosePhase "long")}}
            >Long break</button>
          </div>
          <div class="pomo-dial is-{{this.phase}}">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle class="pomo-track" cx="100" cy="100" r="88" />
              <circle
                class="pomo-progress"
                cx="100"
                cy="100"
                r="88"
                style={{this.ringStyle}}
              />
            </svg>
            <div class="pomo-readout">
              <span
                class="pomo-clock"
                role="timer"
                aria-live="off"
              >{{this.clock}}</span>
              <span class="tool-hint">{{this.phaseLabel}}
                · round
                {{this.round}}
                of
                {{this.settings.rounds}}</span>
            </div>
          </div>
          <div class="pomo-dots" aria-label="Rounds">
            {{#each this.roundDots as |dot|}}<span
                class="pomo-dot {{if dot.done 'is-done'}}"
              ></span>{{/each}}
          </div>
          <div class="settings-actions pomo-actions">
            {{#if this.running}}
              <button
                type="button"
                class="btn active"
                {{on "click" this.pause}}
              >Pause</button>
            {{else}}
              <button
                type="button"
                class="btn active"
                {{on "click" this.start}}
              >Start</button>
            {{/if}}
            <button type="button" class="btn" {{on "click" this.reset}}><Icon
                @name="rotate-ccw"
                @size={{13}}
              />
              Reset</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.skip}}
            >Skip</button>
          </div>
          <p class="tool-hint">{{this.completed}}
            focus session{{if (eq this.completed 1) "" "s"}}
            completed this visit.</p>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Settings</h3>
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Focus
                (min)</span><input
                type="number"
                min="1"
                max="180"
                class="math-input"
                value={{this.settings.focus}}
                {{on "input" (fn this.updateSetting "focus")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Short
                break (min)</span><input
                type="number"
                min="1"
                max="180"
                class="math-input"
                value={{this.settings.short}}
                {{on "input" (fn this.updateSetting "short")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Long break
                (min)</span><input
                type="number"
                min="1"
                max="180"
                class="math-input"
                value={{this.settings.long}}
                {{on "input" (fn this.updateSetting "long")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Rounds
                before long break</span><input
                type="number"
                min="1"
                max="12"
                class="math-input"
                value={{this.settings.rounds}}
                {{on "input" (fn this.updateSetting "rounds")}}
              /></label>
          </div>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.settings.sound}}
              {{on "change" (fn this.updateSetting "sound")}}
            />
            Play a chime when a phase ends</label>
          <p class="tool-hint">Keep this tab open. If you allow notifications,
            you'll get one when a phase ends while you're in another tab.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
