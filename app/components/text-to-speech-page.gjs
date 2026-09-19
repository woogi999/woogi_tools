import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { parseSubtitles, clock } from '../utils/subtitles';
import { acceptPastedFiles } from '../utils/paste-files';

const eq = (a, b) => a === b;

// The two flavours: a modern system voice as it comes, or the flat robotic
// read-out of the old free TTS sites, which is the same engine's plainest
// voice pushed to a low, level pitch.
const STYLES = [
  { id: 'modern', label: 'Modern', rate: 1, pitch: 1 },
  { id: 'classic', label: 'Classic robot', rate: 0.92, pitch: 0.55 },
];
// Voices that sound the part for the classic style, in order of preference.
const CLASSIC_VOICES = [
  /microsoft (david|sam|mark)/i,
  /espeak/i,
  /microsoft zira/i,
  /english/i,
];

export default class TextToSpeechPage extends Component {
  styles = STYLES;

  @tracked text = 'Hello there. This is what I sound like.';
  @tracked style = 'modern';
  @tracked voiceName = '';
  @tracked rate = 1;
  @tracked pitch = 1;
  @tracked volume = 1;
  @tracked voices = [];
  @tracked speaking = false;
  @tracked paused = false;
  @tracked cues = null;
  @tracked cueAt = -1;
  @tracked timed = true;
  @tracked fileName = '';
  @tracked error = null;

  cueTimer = null;
  cueStartedAt = 0;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'text-to-speech', [
      'text',
      'style',
      'voiceName',
      'rate',
      'pitch',
      'volume',
      'timed',
    ]);
    this.loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', this.loadVoices);
    registerDestructor(this, () => {
      window.speechSynthesis?.removeEventListener(
        'voiceschanged',
        this.loadVoices,
      );
      this.stop();
    });
  }

  get supported() {
    return 'speechSynthesis' in window;
  }

  get voice() {
    return (
      this.voices.find((v) => v.name === this.voiceName) ??
      this.voices[0] ??
      null
    );
  }

  get voiceGroups() {
    const groups = new Map();
    for (const v of this.voices) {
      const lang = v.lang || 'other';
      if (!groups.has(lang)) groups.set(lang, []);
      groups.get(lang).push(v);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([lang, items]) => ({ lang, items }));
  }

  get isClassic() {
    return this.style === 'classic';
  }

  get currentCue() {
    return this.cues?.[this.cueAt] ?? null;
  }

  get cueRows() {
    return (this.cues ?? []).map((cue, i) => ({
      ...cue,
      i,
      time: clock(cue.start),
      active: i === this.cueAt,
    }));
  }

  loadVoices = () => {
    const list = window.speechSynthesis?.getVoices() ?? [];
    this.voices = [...list].sort(
      (a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name),
    );
    if (!this.voiceName && list.length) {
      const local =
        list.find((v) => v.lang === navigator.language) ??
        list.find((v) => v.default) ??
        list[0];
      this.voiceName = local.name;
    }
  };

  setText = (e) => (this.text = e.target.value);
  setVoice = (e) => (this.voiceName = e.target.value);
  setRate = (e) => (this.rate = Number(e.target.value));
  setPitch = (e) => (this.pitch = Number(e.target.value));
  setVolume = (e) => (this.volume = Number(e.target.value));
  toggleTimed = () => (this.timed = !this.timed);

  setStyle = (id) => {
    this.style = id;
    const preset = STYLES.find((s) => s.id === id);
    this.rate = preset.rate;
    this.pitch = preset.pitch;
    if (id === 'classic') {
      for (const pattern of CLASSIC_VOICES) {
        const hit = this.voices.find((v) => pattern.test(v.name));
        if (hit) {
          this.voiceName = hit.name;
          break;
        }
      }
    }
  };

  utterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.pitch = this.pitch;
    u.volume = this.volume;
    return u;
  }

  speak = () => {
    if (!this.supported) return;
    this.stop();
    if (this.cues) {
      this.cueAt = -1;
      this.speaking = true;
      this.cueStartedAt = performance.now();
      this.nextCue();
      return;
    }
    const text = this.text.trim();
    if (!text) return;
    const u = this.utterance(text);
    u.onend = u.onerror = () => {
      this.speaking = false;
      this.paused = false;
    };
    this.speaking = true;
    this.paused = false;
    window.speechSynthesis.speak(u);
  };

  // Subtitles are read one cue at a time, either straight after each other
  // or held back to each cue's own time, as in the film.
  nextCue() {
    const i = this.cueAt + 1;
    const cue = this.cues[i];
    if (!cue || !this.speaking) {
      this.speaking = false;
      this.cueAt = -1;
      return;
    }
    const go = () => {
      if (!this.speaking) return;
      this.cueAt = i;
      const u = this.utterance(cue.text.replace(/\n/g, ' '));
      u.onend = u.onerror = () => this.nextCue();
      window.speechSynthesis.speak(u);
    };
    if (!this.timed) return go();
    const due = this.cueStartedAt + cue.start * 1000;
    const wait = due - performance.now();
    if (wait > 50) this.cueTimer = setTimeout(go, wait);
    else go();
  }

  pause = () => {
    if (!this.speaking) return;
    if (this.paused) {
      window.speechSynthesis.resume();
      this.paused = false;
    } else {
      window.speechSynthesis.pause();
      this.paused = true;
    }
  };

  stop = () => {
    clearTimeout(this.cueTimer);
    this.speaking = false;
    this.paused = false;
    this.cueAt = -1;
    window.speechSynthesis?.cancel();
  };

  openFile = async (file) => {
    if (!file) return;
    const cues = parseSubtitles(await file.text());
    if (!cues.length) {
      this.error = 'No cues found: is that an SRT or VTT file?';
      return;
    }
    this.stop();
    this.error = null;
    this.cues = cues;
    this.fileName = file.name;
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };
  dragOverFile = (e) => e.preventDefault();
  dropFile = (e) => {
    e.preventDefault();
    this.openFile(e.dataTransfer.files?.[0]);
  };
  pasteFiles = (files) => this.openFile(files[0]);

  closeFile = () => {
    this.stop();
    this.cues = null;
    this.fileName = '';
  };

  jumpTo = (i) => {
    if (!this.cues) return;
    this.stop();
    this.speaking = true;
    this.cueAt = i - 1;
    this.cueStartedAt = performance.now() - this.cues[i].start * 1000;
    this.nextCue();
  };

  <template>
    <ToolPage
      @route="text-to-speech"
      @subtitle="Have anything read out loud in a natural voice or the flat robot of the old days, from typed text or a subtitle file."
      @busy={{this.speaking}}
      @closeWarning="the speech in progress"
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          {{#unless this.supported}}
            <p class="tool-error">This browser has no speech voices.</p>
          {{/unless}}
          {{#if this.cues}}
            <div class="fc-toolbar">
              <h3 class="qr-heading">{{this.fileName}}</h3>
              <button type="button" class="btn" {{on "click" this.closeFile}}>
                <Icon @name="x" @size={{13}} />
                Close file</button>
            </div>
            <label class="tts-check">
              <input
                type="checkbox"
                checked={{this.timed}}
                {{on "change" this.toggleTimed}}
              />
              Keep to the subtitle timings
            </label>
            <ol class="tts-cues">
              {{#each this.cueRows key="i" as |cue|}}
                <li class="{{if cue.active 'is-active'}}">
                  <button
                    type="button"
                    class="tts-cue"
                    {{on "click" (fn this.jumpTo cue.i)}}
                  >
                    <span class="tts-cue-time">{{cue.time}}</span>
                    <span>{{cue.text}}</span>
                  </button>
                </li>
              {{/each}}
            </ol>
          {{else}}
            <label class="field-label" for="tts-text">Text</label>
            <textarea
              id="tts-text"
              class="textarea text-area-tall"
              value={{this.text}}
              {{on "input" this.setText}}
            ></textarea>
            <label
              class="qr-drop tts-drop"
              {{on "dragover" this.dragOverFile}}
              {{on "drop" this.dropFile}}
            >
              <Icon @name="captions" @size={{18}} />
              <span>Or drop an .srt or .vtt subtitle file to have it read</span>
              <input
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                class="sr-only"
                {{on "change" this.selectFile}}
              />
            </label>
          {{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </section>

        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Style">
            {{#each this.styles as |s|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.style s.id) 'active'}}"
                {{on "click" (fn this.setStyle s.id)}}
              >{{s.label}}</button>
            {{/each}}
          </div>
          <label class="math-field">
            <span class="qr-label is-muted">Voice</span>
            <select class="select" {{on "change" this.setVoice}}>
              {{#each this.voiceGroups as |group|}}
                <optgroup label={{group.lang}}>
                  {{#each group.items as |v|}}
                    <option
                      value={{v.name}}
                      selected={{eq v.name this.voiceName}}
                    >{{v.name}}</option>
                  {{/each}}
                </optgroup>
              {{/each}}
            </select>
          </label>
          <label class="math-field">
            <span class="qr-label is-muted">Speed: {{this.rate}}×</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={{this.rate}}
              {{on "input" this.setRate}}
            />
          </label>
          <label class="math-field">
            <span class="qr-label is-muted">Pitch: {{this.pitch}}</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={{this.pitch}}
              {{on "input" this.setPitch}}
            />
          </label>
          <label class="math-field">
            <span class="qr-label is-muted">Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={{this.volume}}
              {{on "input" this.setVolume}}
            />
          </label>
          <div class="settings-actions">
            <button type="button" class="btn active" {{on "click" this.speak}}>
              <Icon @name="volume-2" @size={{14}} />
              {{if this.cues "Read the subtitles" "Speak"}}</button>
            {{#if this.speaking}}
              <button type="button" class="btn" {{on "click" this.pause}}>
                <Icon @name={{if this.paused "play" "pause"}} @size={{14}} />
                {{if this.paused "Resume" "Pause"}}</button>
              <button type="button" class="btn" {{on "click" this.stop}}>
                <Icon @name="circle-stop" @size={{14}} />
                Stop</button>
            {{/if}}
          </div>
          {{#if this.currentCue}}
            <p class="math-callout tts-now">{{this.currentCue.text}}</p>
          {{/if}}
          <p class="tool-hint">{{if
              this.isClassic
              "The classic sound is the plainest voice on your system, dropped to a low, level pitch: the free text-to-speech of the early YouTube era. Windows has the closest match in Microsoft David."
              "The voices are the ones installed on your device, so they differ from phone to laptop. Speech is made on the device; nothing is sent anywhere, and there is no file to save, so record the tab if you need one."
            }}</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
