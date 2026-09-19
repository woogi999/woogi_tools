import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { drawPlate, makeRun, PLATE_TYPES } from '../utils/ishihara';

function reading(rg, rgTotal, by, byTotal) {
  const lines = [];
  if (rg >= rgTotal - 1)
    lines.push('Red-green: you read the plates the way most people do.');
  else if (rg >= rgTotal / 2)
    lines.push(
      'Red-green: a few plates were hard to read. That can be the screen, but it is also how a mild red-green deficiency shows up.',
    );
  else
    lines.push(
      'Red-green: most of these plates were hard to read, which is the pattern of a red-green colour vision deficiency (the commonest kind, usually deutan or protan).',
    );
  if (by >= byTotal) lines.push('Blue-yellow: all clear.');
  else if (by >= byTotal - 1)
    lines.push('Blue-yellow: one slipped, which is usually nothing.');
  else
    lines.push(
      'Blue-yellow: several were hard to read, which is rarer and worth mentioning to an optometrist.',
    );
  return lines;
}

export default class ColourBlindnessTestPage extends Component {
  @tracked run = null;
  @tracked at = 0;
  @tracked answers = [];
  @tracked finished = false;
  @tracked revealed = false;

  get plate() {
    return this.run?.[this.at] ?? null;
  }

  get inProgress() {
    return !this.finished;
  }

  get plateNumber() {
    return this.at + 1;
  }

  get total() {
    return this.run?.length ?? 0;
  }

  get score() {
    if (!this.run) return null;
    const tally = { rg: [0, 0], by: [0, 0] };
    this.run.forEach((plate, i) => {
      tally[plate.type][1]++;
      if (this.answers[i] === plate.number) tally[plate.type][0]++;
    });
    return {
      rg: tally.rg[0],
      rgTotal: tally.rg[1],
      by: tally.by[0],
      byTotal: tally.by[1],
      correct: tally.rg[0] + tally.by[0],
      lines: reading(tally.rg[0], tally.rg[1], tally.by[0], tally.by[1]),
    };
  }

  get review() {
    if (!this.run) return [];
    return this.run.map((plate, i) => ({
      ...plate,
      i: i + 1,
      typeLabel: PLATE_TYPES[plate.type].label,
      answer: this.answers[i],
      right: this.answers[i] === plate.number,
    }));
  }

  // Each plate is drawn the moment its canvas is on the page.
  paint = modifier((canvas, [plate]) => {
    if (plate) drawPlate(canvas, plate.number, plate.type);
  });

  start = () => {
    this.run = makeRun();
    this.at = 0;
    this.answers = [];
    this.finished = false;
    this.revealed = false;
  };

  answer = (value) => {
    this.answers = [...this.answers, value];
    if (this.at + 1 >= this.total) this.finished = true;
    else this.at++;
  };

  reveal = () => (this.revealed = !this.revealed);

  <template>
    <ToolPage
      @route="colour-blindness-test"
      @subtitle="Nine plates of coloured dots, each hiding a number. Pick what you see and get a read on your red-green and blue-yellow vision."
    >
      <div class="math-grid pop-in">
        <section class="math-card cb-card">
          {{#if this.plate}}
            {{#if this.inProgress}}
              <p class="cb-progress">Plate
                {{this.plateNumber}}
                of
                {{this.total}}</p>
              <canvas
                class="cb-plate"
                aria-label="A disc of coloured dots hiding a number"
                {{this.paint this.plate}}
              ></canvas>
              <div class="cb-options">
                {{#each this.plate.options as |n|}}
                  <button
                    type="button"
                    class="btn cb-option"
                    {{on "click" (fn this.answer n)}}
                  >{{n}}</button>
                {{/each}}
                <button
                  type="button"
                  class="btn cb-option is-none"
                  {{on "click" (fn this.answer null)}}
                >I can't see a number</button>
              </div>
            {{else}}
              <div class="math-result">
                <span class="qr-label is-muted">You read</span>
                <span class="math-big">{{this.score.correct}}
                  of
                  {{this.total}}</span>
                <span class="tool-hint">Red-green
                  {{this.score.rg}}/{{this.score.rgTotal}}, blue-yellow
                  {{this.score.by}}/{{this.score.byTotal}}</span>
              </div>
              {{#each this.score.lines as |line|}}
                <p class="math-callout">{{line}}</p>
              {{/each}}
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  {{on "click" this.start}}
                >
                  <Icon @name="refresh-cw" @size={{13}} />
                  Go again</button>
                <button type="button" class="btn" {{on "click" this.reveal}}>
                  <Icon
                    @name={{if this.revealed "eye-off" "eye"}}
                    @size={{13}}
                  />
                  {{if
                    this.revealed
                    "Hide the answers"
                    "Show the answers"
                  }}</button>
              </div>
              {{#if this.revealed}}
                <ul class="cb-review">
                  {{#each this.review as |p|}}
                    <li class="{{if p.right 'is-right' 'is-wrong'}}">
                      <span>Plate {{p.i}} ({{p.typeLabel}})</span>
                      <strong>{{p.number}}</strong>
                      <span class="is-muted">you said
                        {{if p.answer p.answer "nothing"}}</span>
                    </li>
                  {{/each}}
                </ul>
              {{/if}}
            {{/if}}
          {{else}}
            <div class="cb-intro">
              <Icon @name="eye" @size={{40}} />
              <p>Sit at a normal distance, with the screen at its usual
                brightness, and pick the number you see in each plate. Take a
                guess if it's faint; say so if there's nothing.</p>
              <button
                type="button"
                class="btn active"
                {{on "click" this.start}}
              >
                <Icon @name="play" @size={{13}} />
                Start</button>
            </div>
          {{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">About this test</h3>
          <p class="tool-hint">These plates work like the Ishihara test: a
            number in reds and oranges sits among greens and olives at the same
            brightness, so it only stands out if your eyes tell those hues
            apart. Three of the nine swap that for blues against yellows.</p>
          <p class="tool-hint">Screens vary a lot in colour, and a night-light
            mode or a warm colour profile can hide the numbers from anyone.
            Treat it as a rough check, not a diagnosis: an optometrist can do
            the proper thing in a few minutes.</p>
          <p class="tool-hint">Roughly one in twelve men and one in two hundred
            women have some red-green deficiency, so a low score here is common
            and nothing to worry about on its own.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
