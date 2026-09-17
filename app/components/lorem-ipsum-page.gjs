import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

const UNITS = [
  { id: 'paragraphs', label: 'Paragraphs' },
  { id: 'sentences', label: 'Sentences' },
  { id: 'words', label: 'Words' },
];

const eq = (a, b) => a === b;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function capitalize(word) {
  return word[0].toUpperCase() + word.slice(1);
}

function makeSentence(minWords = 6, maxWords = 16) {
  const count = randomInt(minWords, maxWords);
  const words = Array.from(
    { length: count },
    () => WORDS[randomInt(0, WORDS.length - 1)],
  );
  // Sprinkle in an occasional comma, the way real Lorem Ipsum generators do.
  if (count > 6 && Math.random() < 0.6) {
    const at = randomInt(2, count - 3);
    words[at] += ',';
  }
  return `${capitalize(words[0])} ${words.slice(1).join(' ')}.`;
}

function makeParagraph(minSentences = 4, maxSentences = 8) {
  const count = randomInt(minSentences, maxSentences);
  return Array.from({ length: count }, () => makeSentence()).join(' ');
}

function generate(unit, count, startWithLorem) {
  if (unit === 'words') {
    const words = Array.from(
      { length: Math.max(1, count) },
      () => WORDS[randomInt(0, WORDS.length - 1)],
    );
    if (startWithLorem) {
      const lead = 'lorem ipsum dolor sit amet'.split(' ');
      lead.forEach((w, i) => (words[i] = w));
    }
    return capitalize(words.join(' '));
  }
  if (unit === 'sentences') {
    const sentences = Array.from({ length: Math.max(1, count) }, () =>
      makeSentence(),
    );
    if (startWithLorem)
      sentences[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    return sentences.join(' ');
  }
  const paragraphs = Array.from({ length: Math.max(1, count) }, () =>
    makeParagraph(),
  );
  if (startWithLorem)
    paragraphs[0] = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. ${paragraphs[0]}`;
  return paragraphs.join('\n\n');
}

export default class LoremIpsumPage extends Component {
  units = UNITS;

  @tracked unit = 'paragraphs';
  @tracked count = 3;
  @tracked startWithLorem = true;
  @tracked output = '';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'lorem-ipsum', ['unit', 'count', 'startWithLorem']);
    this.regenerate();
  }

  get wordCount() {
    return this.output ? this.output.trim().split(/\s+/).length : 0;
  }

  get charCount() {
    return this.output.length;
  }

  regenerate = () => {
    this.output = generate(this.unit, this.count, this.startWithLorem);
  };

  setUnit = (unit) => {
    this.unit = unit;
    this.regenerate();
  };

  setCount = (event) => {
    this.count = Math.max(1, Math.min(50, +event.target.value || 1));
    this.regenerate();
  };

  toggleStart = () => {
    this.startWithLorem = !this.startWithLorem;
    this.regenerate();
  };

  <template>
    <ToolPage
      @route="lorem-ipsum"
      @subtitle="Generate placeholder text by paragraphs, sentences or words. Lorem ipsum dolor sit whatever."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Options</h3>
          <div class="math-tabs" role="group" aria-label="Unit">
            {{#each this.units as |u|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.unit u.id) 'active'}}"
                {{on "click" (fn this.setUnit u.id)}}
              >{{u.label}}</button>
            {{/each}}
          </div>
          <label class="math-field">
            <span class="qr-label is-muted">How many {{this.unit}}</span>
            <input
              type="number"
              min="1"
              max="50"
              class="math-input"
              value={{this.count}}
              {{on "input" this.setCount}}
            />
          </label>
          <label class="math-check">
            <input
              type="checkbox"
              checked={{this.startWithLorem}}
              {{on "change" this.toggleStart}}
            />
            Start with "Lorem ipsum dolor sit amet…"
          </label>
          <button
            type="button"
            class="btn math-use"
            {{on "click" this.regenerate}}
          ><Icon @name="refresh-cw" @size={{13}} /> Regenerate</button>
        </section>

        <section class="math-card">
          <div class="settings-row lorem-output-head">
            <h3 class="qr-heading">Output</h3>
            <CopyButton @value={{this.output}} />
          </div>
          <textarea
            class="math-input lorem-output"
            readonly
            rows="14"
            aria-label="Generated placeholder text"
          >{{this.output}}</textarea>
          <p class="tool-hint">{{this.wordCount}}
            words ·
            {{this.charCount}}
            characters</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
