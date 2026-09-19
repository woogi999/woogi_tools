import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import Icon from './icon';
import {
  COLOURS,
  REPEATS,
  loadEvents,
  saveEvents,
  newId,
  key,
  parseKey,
  occursOn,
  sortByTime,
  monthGrid,
  toIcs,
} from '../utils/calendar';

const eq = (a, b) => a === b;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const swatch = (colour) => htmlSafe(`background:${colour}`);
const blank = (date) => ({
  id: null,
  title: '',
  date,
  start: '',
  end: '',
  colour: COLOURS[0],
  notes: '',
  noteId: '',
  repeat: 'none',
});

export default class CalendarPage extends Component {
  @service notes;
  @service router;

  weekdays = WEEKDAYS;
  colours = COLOURS;
  repeats = REPEATS;

  @tracked events = loadEvents();
  @tracked cursor = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  @tracked selected = key(new Date());
  @tracked draft = null;

  get monthLabel() {
    return this.cursor.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }

  get today() {
    return key(new Date());
  }

  get cells() {
    return monthGrid(this.cursor.getFullYear(), this.cursor.getMonth()).map(
      (cell) => ({
        ...cell,
        day: cell.date.getDate(),
        today: cell.key === this.today,
        selected: cell.key === this.selected,
        events: this.eventsOn(cell.key).slice(0, 3),
        more: Math.max(0, this.eventsOn(cell.key).length - 3),
      }),
    );
  }

  eventsOn(dayKey) {
    return this.events
      .filter((e) => occursOn(e, dayKey))
      .sort(sortByTime)
      .map((e) => ({
        ...e,
        style: swatch(e.colour),
        note: this.noteFor(e.noteId),
      }));
  }

  noteFor(id) {
    if (!id) return null;
    const note = this.notes.notes.find((n) => n.id === id);
    return note ? { id, title: note.title || 'Untitled note' } : null;
  }

  get selectedLabel() {
    return parseKey(this.selected).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  get selectedEvents() {
    return this.eventsOn(this.selected);
  }

  get upcoming() {
    const list = [];
    const from = new Date();
    for (let i = 0; i < 60 && list.length < 8; i++) {
      const d = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + i,
      );
      const k = key(d);
      for (const e of this.eventsOn(k))
        list.push({
          ...e,
          when:
            i === 0
              ? 'Today'
              : i === 1
                ? 'Tomorrow'
                : d.toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }),
          dayKey: k,
        });
    }
    return list.slice(0, 8);
  }

  get noteOptions() {
    return this.notes.notes.map((n) => ({
      id: n.id,
      title: n.title || 'Untitled note',
    }));
  }

  get icsUrl() {
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(toIcs(this.events))}`;
  }

  persist() {
    saveEvents(this.events);
  }

  prev = () =>
    (this.cursor = new Date(
      this.cursor.getFullYear(),
      this.cursor.getMonth() - 1,
      1,
    ));
  next = () =>
    (this.cursor = new Date(
      this.cursor.getFullYear(),
      this.cursor.getMonth() + 1,
      1,
    ));
  goToday = () => {
    const now = new Date();
    this.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    this.selected = key(now);
  };

  pick = (cell) => {
    this.selected = cell.key;
    if (!cell.inMonth)
      this.cursor = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
  };

  add = () => (this.draft = blank(this.selected));
  edit = (event) =>
    (this.draft = { ...this.events.find((e) => e.id === event.id) });
  cancel = () => (this.draft = null);

  set = (field, event) => {
    this.draft = { ...this.draft, [field]: event.target.value };
  };
  setColour = (colour) => (this.draft = { ...this.draft, colour });

  save = (event) => {
    event.preventDefault();
    const d = this.draft;
    if (!d.title.trim() || !d.date) return;
    const saved = { ...d, title: d.title.trim(), id: d.id ?? newId() };
    this.events = d.id
      ? this.events.map((e) => (e.id === d.id ? saved : e))
      : [...this.events, saved];
    this.persist();
    this.selected = saved.date;
    this.cursor = new Date(
      parseKey(saved.date).getFullYear(),
      parseKey(saved.date).getMonth(),
      1,
    );
    this.draft = null;
  };

  remove = () => {
    if (!this.draft?.id) return;
    this.events = this.events.filter((e) => e.id !== this.draft.id);
    this.persist();
    this.draft = null;
  };

  openNote = (noteId) => {
    this.notes.requestOpen(noteId);
    this.router.transitionTo('quick-notes');
  };

  <template>
    <ToolPage
      @route="calendar"
      @subtitle="A month at a glance, with events that repeat, colours to tell them apart, and a link to any of your Quick Notes."
    >
      <div class="cal pop-in">
        <div class="cal-main">
          <div class="cal-head">
            <div class="settings-actions">
              <button
                type="button"
                class="btn"
                aria-label="Previous month"
                {{on "click" this.prev}}
              >
                <Icon @name="arrow-left" @size={{14}} />
              </button>
              <button
                type="button"
                class="btn"
                {{on "click" this.goToday}}
              >Today</button>
              <button
                type="button"
                class="btn"
                aria-label="Next month"
                {{on "click" this.next}}
              >
                <Icon @name="arrow-right" @size={{14}} />
              </button>
            </div>
            <h3 class="cal-month">{{this.monthLabel}}</h3>
            <div class="settings-actions">
              <button type="button" class="btn active" {{on "click" this.add}}>
                <Icon @name="plus" @size={{13}} />
                Event</button>
              {{#if this.events.length}}
                <a
                  class="btn"
                  href={{this.icsUrl}}
                  download="woogi-calendar.ics"
                  title="Export as an .ics file"
                >
                  <Icon @name="download" @size={{13}} />
                </a>
              {{/if}}
            </div>
          </div>
          <div class="cal-grid">
            {{#each this.weekdays as |d|}}
              <div class="cal-weekday" aria-hidden="true">{{d}}</div>
            {{/each}}
            {{#each this.cells key="key" as |cell|}}
              <button
                type="button"
                class="cal-cell
                  {{unless cell.inMonth 'is-outside'}}
                  {{if cell.today 'is-today'}}
                  {{if cell.selected 'is-selected'}}"
                aria-label={{cell.key}}
                aria-pressed={{if cell.selected "true" "false"}}
                {{on "click" (fn this.pick cell)}}
              >
                <span class="cal-day">{{cell.day}}</span>
                <span class="cal-cell-events">
                  {{#each cell.events as |e|}}
                    <span
                      class="cal-pill"
                      style={{e.style}}
                      title={{e.title}}
                    >{{e.title}}</span>
                  {{/each}}
                  {{#if cell.more}}<span
                      class="cal-more"
                    >+{{cell.more}}</span>{{/if}}
                </span>
              </button>
            {{/each}}
          </div>
        </div>

        <aside class="cal-side">
          {{#if this.draft}}
            <form class="cal-form" {{on "submit" this.save}}>
              <h3 class="qr-heading">{{if
                  this.draft.id
                  "Edit event"
                  "New event"
                }}</h3>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Title</span><input
                  type="text"
                  class="math-input"
                  required
                  maxlength="80"
                  value={{this.draft.title}}
                  {{on "input" (fn this.set "title")}}
                /></label>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Date</span><input
                  type="date"
                  class="math-input"
                  required
                  value={{this.draft.date}}
                  {{on "input" (fn this.set "date")}}
                /></label>
              <div class="math-row">
                <label class="math-field"><span
                    class="qr-label is-muted"
                  >Starts</span><input
                    type="time"
                    class="math-input"
                    value={{this.draft.start}}
                    {{on "input" (fn this.set "start")}}
                  /></label>
                <label class="math-field"><span
                    class="qr-label is-muted"
                  >Ends</span><input
                    type="time"
                    class="math-input"
                    value={{this.draft.end}}
                    {{on "input" (fn this.set "end")}}
                  /></label>
              </div>
              <p class="tool-hint">Leave the times empty for an all-day event.</p>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Repeats</span>
                <select class="select" {{on "change" (fn this.set "repeat")}}>
                  {{#each this.repeats as |r|}}
                    <option
                      value={{r.id}}
                      selected={{eq r.id this.draft.repeat}}
                    >{{r.label}}</option>
                  {{/each}}
                </select></label>
              <div class="math-field">
                <span class="qr-label is-muted">Colour</span>
                <div class="cal-colours">
                  {{#each this.colours as |c|}}
                    <button
                      type="button"
                      class="cal-colour {{if (eq c this.draft.colour) 'is-on'}}"
                      style={{swatch c}}
                      aria-label="Colour {{c}}"
                      aria-pressed={{if
                        (eq c this.draft.colour)
                        "true"
                        "false"
                      }}
                      {{on "click" (fn this.setColour c)}}
                    ></button>
                  {{/each}}
                </div>
              </div>
              <label class="math-field"><span class="qr-label is-muted">Quick
                  Note</span>
                <select class="select" {{on "change" (fn this.set "noteId")}}>
                  <option
                    value=""
                    selected={{eq "" this.draft.noteId}}
                  >None</option>
                  {{#each this.noteOptions as |n|}}
                    <option
                      value={{n.id}}
                      selected={{eq n.id this.draft.noteId}}
                    >{{n.title}}</option>
                  {{/each}}
                </select></label>
              <label class="math-field"><span
                  class="qr-label is-muted"
                >Notes</span><textarea
                  class="textarea cal-notes"
                  value={{this.draft.notes}}
                  {{on "input" (fn this.set "notes")}}
                ></textarea></label>
              <div class="settings-actions">
                <button type="submit" class="btn active">Save</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.cancel}}
                >Cancel</button>
                {{#if this.draft.id}}
                  <button
                    type="button"
                    class="btn cal-delete"
                    {{on "click" this.remove}}
                  >
                    <Icon @name="trash-2" @size={{13}} />
                    Delete</button>
                {{/if}}
              </div>
            </form>
          {{else}}
            <h3 class="qr-heading">{{this.selectedLabel}}</h3>
            {{#if this.selectedEvents.length}}
              <ul class="cal-list">
                {{#each this.selectedEvents key="id" as |e|}}
                  <li class="cal-event">
                    <button
                      type="button"
                      class="cal-event-main"
                      {{on "click" (fn this.edit e)}}
                    >
                      <span class="cal-dot" style={{e.style}}></span>
                      <span class="cal-event-time">{{if
                          e.start
                          e.start
                          "All day"
                        }}{{if e.end (concat "–" e.end)}}</span>
                      <span class="cal-event-title">{{e.title}}</span>
                    </button>
                    {{#if e.note}}
                      <button
                        type="button"
                        class="cal-note-link"
                        {{on "click" (fn this.openNote e.note.id)}}
                      >
                        <Icon @name="notebook-pen" @size={{12}} />
                        {{e.note.title}}</button>
                    {{/if}}
                    {{#if e.notes}}<p
                        class="cal-event-notes"
                      >{{e.notes}}</p>{{/if}}
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class="tool-hint">Nothing on this day. Press Event to add
                something.</p>
            {{/if}}

            <h3 class="qr-heading cal-upcoming-head">Coming up</h3>
            {{#if this.upcoming.length}}
              <ul class="cal-list">
                {{#each this.upcoming as |e|}}
                  <li class="cal-event">
                    <button
                      type="button"
                      class="cal-event-main"
                      {{on "click" (fn this.edit e)}}
                    >
                      <span class="cal-dot" style={{e.style}}></span>
                      <span class="cal-event-time">{{e.when}}{{#if e.start}}
                          {{e.start}}{{/if}}</span>
                      <span class="cal-event-title">{{e.title}}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class="tool-hint">Nothing in the next two months.</p>
            {{/if}}
          {{/if}}
        </aside>
      </div>
    </ToolPage>
  </template>
}
