import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const stamp = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(cs)}`;
};

export default class StopwatchPage extends Component {
  @tracked running = false;
  @tracked elapsed = 0;
  @tracked laps = [];
  // Where the clock stood when it was last started, so a refresh mid-run carries on.
  @tracked startedAt = null;

  frame = 0;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'stopwatch', ['elapsed', 'laps', 'startedAt'], () => {
      if (this.startedAt !== null) {
        this.running = true;
        this.tick();
      }
    });
    registerDestructor(this, () => cancelAnimationFrame(this.frame));
  }

  get notStarted() {
    return !this.running && !this.elapsed;
  }

  get display() {
    return stamp(this.elapsed);
  }

  get lapRows() {
    const times = this.laps.map((l) => l.split);
    const best = times.length > 1 ? Math.min(...times) : null;
    const worst = times.length > 1 ? Math.max(...times) : null;
    return this.laps
      .map((lap, i) => ({
        n: i + 1,
        split: stamp(lap.split),
        total: stamp(lap.total),
        best: lap.split === best,
        worst: lap.split === worst,
      }))
      .reverse();
  }

  get text() {
    return this.laps
      .map((lap, i) => `Lap ${i + 1}\t${stamp(lap.split)}\t${stamp(lap.total)}`)
      .join('\n');
  }

  keys = modifier(() => {
    const onKey = (event) => {
      if (event.target.closest('input, textarea, select, button')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        this.toggle();
      } else if (event.key === 'l' || event.key === 'L') this.lap();
      else if (event.key === 'r' || event.key === 'R') this.reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  tick = () => {
    if (!this.running) return;
    this.elapsed = Date.now() - this.startedAt;
    this.frame = requestAnimationFrame(this.tick);
  };

  toggle = () => {
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.elapsed = Date.now() - this.startedAt;
      this.startedAt = null;
      return;
    }
    this.startedAt = Date.now() - this.elapsed;
    this.running = true;
    this.tick();
  };

  lap = () => {
    if (!this.running && !this.elapsed) return;
    const total = this.running ? Date.now() - this.startedAt : this.elapsed;
    const last = this.laps[this.laps.length - 1]?.total ?? 0;
    this.laps = [...this.laps, { total, split: total - last }];
  };

  reset = () => {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.elapsed = 0;
    this.startedAt = null;
    this.laps = [];
  };

  <template>
    <ToolPage
      @route="stopwatch"
      @subtitle="A stopwatch with laps. It keeps counting if you leave and come back."
      @busy={{this.running}}
      @closeWarning="the running stopwatch"
    >
      <div class="pop-in" {{this.keys}}>
        <div class="sw-face {{if this.running 'is-running'}}">
          <span class="sw-time">{{this.display}}</span>
          <div class="settings-actions sw-actions">
            <button type="button" class="btn active" {{on "click" this.toggle}}>
              <Icon @name={{if this.running "pause" "play"}} @size={{14}} />
              {{if
                this.running
                "Stop"
                (if this.elapsed "Resume" "Start")
              }}</button>
            <button
              type="button"
              class="btn"
              disabled={{this.notStarted}}
              {{on "click" this.lap}}
            >
              <Icon @name="flag" @size={{14}} />
              Lap</button>
            <button type="button" class="btn" {{on "click" this.reset}}>
              <Icon @name="rotate-ccw" @size={{14}} />
              Reset</button>
          </div>
          <p class="tool-hint">Space starts and stops, L marks a lap, R resets.</p>
        </div>

        {{#if this.laps.length}}
          <section class="math-card">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Laps</h3>
              <CopyButton @value={{this.text}} @label="Copy laps" />
            </div>
            <table class="sw-laps">
              <thead>
                <tr><th>Lap</th><th>Split</th><th>Total</th></tr>
              </thead>
              <tbody>
                {{#each this.lapRows key="n" as |lap|}}
                  <tr
                    class="{{if lap.best 'is-best'}}
                      {{if lap.worst 'is-worst'}}"
                  >
                    <td>{{lap.n}}</td>
                    <td>{{lap.split}}</td>
                    <td>{{lap.total}}</td>
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
