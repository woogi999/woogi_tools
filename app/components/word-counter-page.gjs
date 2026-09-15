import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';

const READING_WPM = 238;
const SPEAKING_WPM = 150;
const STOPWORDS = new Set('a an and are as at be but by for from has have he her his i if in into is it its of on or our she so that the their them then there these they this to was we were what when which who will with you your not no do does did can could would should than too very just about also'.split(' '));

// Intl.Segmenter counts words properly in languages without spaces (Chinese, Japanese, Thai…).
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function wordsOf(text) {
  if (segmenter) return [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
  return text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
}

function duration(minutes) {
  if (minutes < 1) return `${Math.max(0, Math.round(minutes * 60))} sec`;
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return s ? `${m} min ${s} sec` : `${m} min`;
}

export default class WordCounterPage extends Component {
  @tracked text = '';

  get words() {
    return wordsOf(this.text);
  }

  get stats() {
    const text = this.text;
    const words = this.words;
    return [
      { label: 'Words', value: words.length.toLocaleString() },
      { label: 'Characters', value: [...text].length.toLocaleString() },
      { label: 'Without spaces', value: [...text.replace(/\s/g, '')].length.toLocaleString() },
      { label: 'Sentences', value: (text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? []).filter((s) => s.trim()).length.toLocaleString() },
      { label: 'Paragraphs', value: text.split(/\n\s*\n/).filter((p) => p.trim()).length.toLocaleString() },
      { label: 'Lines', value: (text ? text.split('\n').length : 0).toLocaleString() },
      { label: 'Reading time', value: duration(words.length / READING_WPM) },
      { label: 'Speaking time', value: duration(words.length / SPEAKING_WPM) },
    ];
  }

  get keywords() {
    const counts = new Map();
    for (const word of this.words) {
      const w = word.toLowerCase();
      if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const total = this.words.length || 1;
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([word, count]) => ({ word, count, share: `${((count / total) * 100).toFixed(1)}%` }));
  }

  setText = (event) => (this.text = event.target.value);

  <template>
    <ToolPage @route="word-counter" @subtitle="Type or paste your text for words, characters, sentences and reading time, live as you go.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="wc-text">Your text</label>
          <textarea id="wc-text" class="textarea text-area-tall" placeholder="Paste or start typing…" value={{this.text}} {{on "input" this.setText}}></textarea>
        </section>
        <section class="math-card">
          <h3 class="qr-heading">Stats</h3>
          <div class="math-stats">
            {{#each this.stats as |s|}}
              <div class="math-stat"><span>{{s.label}}</span><strong>{{s.value}}</strong></div>
            {{/each}}
          </div>
          <h3 class="qr-heading">Top words</h3>
          {{#if this.keywords.length}}
            <ol class="wc-keywords">
              {{#each this.keywords as |k|}}
                <li><span>{{k.word}}</span><span class="tool-hint">{{k.count}} · {{k.share}}</span></li>
              {{/each}}
            </ol>
          {{else}}
            <p class="tool-hint">Common words like "the" and "and" are skipped.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
