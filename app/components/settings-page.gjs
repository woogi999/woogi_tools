import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { TOOLS, groupTools } from '../tools';

const eq = (a, b) => a === b;

const VISIBILITY_GROUPS = groupTools(TOOLS.filter((t) => t.category));

const THEMES = [
  { id: 'system', label: 'System', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

const MOTIONS = [
  { id: 'system', label: 'Match system' },
  { id: 'reduce', label: 'Reduced' },
];

const STORAGE_PREFIX = 'woogi-';

function storedBytes() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(STORAGE_PREFIX)) total += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2; // UTF-16
    }
    return total;
  } catch {
    return 0;
  }
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default class SettingsPage extends Component {
  @service settings;
  @service notes;
  @service favourites;
  @service toolVisibility;

  themes = THEMES;
  motions = MOTIONS;

  @tracked toolSearch = '';

  get visibilityGroups() {
    const query = this.toolSearch.trim().toLowerCase();
    return VISIBILITY_GROUPS.map((group) => ({
      name: group.name,
      hidden: this.toolVisibility.isCategoryHidden(group.name),
      items: group.items
        .filter((tool) => !query || tool.label.toLowerCase().includes(query))
        .map((tool) => ({ tool, hidden: this.toolVisibility.isToolHidden(tool.route) })),
    })).filter((group) => group.items.length);
  }

  setToolSearch = (event) => (this.toolSearch = event.target.value);

  @tracked message = null;
  @tracked isError = false;
  // Bumped after anything that changes storage, so the usage figure re-reads it.
  @tracked storageVersion = 0;

  get storageUsed() {
    // Reading these re-runs the getter whenever something that's saved changes.
    const watched = [this.storageVersion, this.notes.notes, this.favourites.routes, this.settings.themePreference, this.settings.motion];
    return watched && formatBytes(storedBytes());
  }

  get systemThemeLabel() {
    return this.settings.systemDark ? 'dark' : 'light';
  }

  notify(text, isError = false) {
    this.message = text;
    this.isError = isError;
    this.storageVersion++;
  }

  setTheme = (id) => this.settings.setTheme(id);
  setMotion = (id) => this.settings.setMotion(id);
  toggleCategoryHidden = (category) => this.toolVisibility.toggleCategory(category);
  toggleToolHidden = (route) => this.toolVisibility.toggleTool(route);

  exportNotes = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`woogi-notes-${stamp}.json`, JSON.stringify(this.notes.exportData(), null, 2));
    this.notify(`Exported ${this.notes.notes.length} notes.`);
  };

  importNotes = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { notes, folders } = this.notes.importData(JSON.parse(reader.result));
        this.notify(`Imported ${notes} note${notes === 1 ? '' : 's'} and ${folders} folder${folders === 1 ? '' : 's'}.`);
      } catch (error) {
        this.notify(error instanceof SyntaxError ? "That file isn't valid JSON." : error.message, true);
      }
    };
    reader.readAsText(file);
  };

  clearFavourites = () => {
    if (!window.confirm('Remove all favourites?')) return;
    this.favourites.clear();
    this.notify('Favourites cleared.');
  };

  deleteNotes = () => {
    if (!window.confirm('Delete every note and folder? Export them first if you want a backup.')) return;
    this.notes.clearAll();
    this.notify('All notes deleted.');
  };

  resetEverything = () => {
    if (!window.confirm('Reset Woogi Tools? This deletes notes, favourites and settings saved in this browser.')) return;
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_PREFIX))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // storage blocked: nothing was saved anyway
    }
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a page reload, not a data request
    window.location.reload();
  };

  <template>
    <div class="container">
      <section class="hero pop-in">
        <h1 class="hero-title"><span>Settings</span></h1>
        <p>Preferences for the whole site. Everything is stored in this browser only.</p>
      </section>

      <div class="settings pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Appearance</h3>

          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Theme</span>
              <span class="tool-hint">
                {{#if (eq this.settings.themePreference "system")}}Following your device, currently {{this.systemThemeLabel}}.{{else}}Always {{this.settings.themePreference}}.{{/if}}
              </span>
            </div>
            <div class="math-tabs settings-choice" role="group" aria-label="Theme">
              {{#each this.themes as |t|}}
                <button type="button" class="qr-tab {{if (eq this.settings.themePreference t.id) 'active'}}" aria-pressed={{if (eq this.settings.themePreference t.id) "true" "false"}} {{on "click" (fn this.setTheme t.id)}}>
                  <Icon @name={{t.icon}} @size={{14}} /> {{t.label}}
                </button>
              {{/each}}
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Animations</span>
              <span class="tool-hint">Reduced turns off bounces, wobbles and slides across the site.</span>
            </div>
            <div class="math-tabs settings-choice" role="group" aria-label="Animations">
              {{#each this.motions as |m|}}
                <button type="button" class="qr-tab {{if (eq this.settings.motion m.id) 'active'}}" aria-pressed={{if (eq this.settings.motion m.id) "true" "false"}} {{on "click" (fn this.setMotion m.id)}}>{{m.label}}</button>
              {{/each}}
            </div>
          </div>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Tool visibility</h3>
          <p class="tool-hint">Hide tools or whole categories you don't use. Everything is shown by default; nothing is deleted, and you can bring it back any time.</p>

          <div class="sidebar-search settings-tool-search">
            <Icon @name="search" @size={{13}} />
            <input type="text" placeholder="Search tools…" aria-label="Search tools" value={{this.toolSearch}} {{on "input" this.setToolSearch}} />
          </div>

          {{#each this.visibilityGroups key="name" as |group|}}
            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">{{group.name}}</span>
                <span class="tool-hint">Hides every tool in this category.</span>
              </div>
              <label class="qr-switch">
                <input type="checkbox" role="switch" checked={{if group.hidden false true}} aria-checked={{if group.hidden "false" "true"}} {{on "change" (fn this.toggleCategoryHidden group.name)}} />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Show category
              </label>
            </div>

            <div class="settings-tool-grid">
              {{#each group.items key="tool.route" as |entry|}}
                <label class="settings-tool-item {{if entry.hidden 'is-off'}} {{if group.hidden 'is-disabled'}}">
                  <input type="checkbox" checked={{if entry.hidden false true}} disabled={{group.hidden}} {{on "change" (fn this.toggleToolHidden entry.tool.route)}} />
                  <span class="settings-tool-check" aria-hidden="true"><Icon @name="check" @size={{11}} /></span>
                  <Icon @name={{entry.tool.icon}} @size={{13}} /> <span>{{entry.tool.label}}</span>
                </label>
              {{/each}}
            </div>
          {{/each}}

          {{#unless this.visibilityGroups.length}}
            <p class="tool-hint">No tools match "{{this.toolSearch}}".</p>
          {{/unless}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Your data</h3>
          <div class="math-stats">
            <div class="math-stat"><span>Notes</span><strong>{{this.notes.notes.length}}</strong></div>
            <div class="math-stat"><span>Folders</span><strong>{{this.notes.folders.length}}</strong></div>
            <div class="math-stat"><span>Favourites</span><strong>{{this.favourites.routes.length}}</strong></div>
            <div class="math-stat"><span>Storage used</span><strong>{{this.storageUsed}}</strong></div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Quick Notes backup</span>
              <span class="tool-hint">Download every note as a JSON file, or add notes from a backup. Importing never overwrites existing notes.</span>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn math-use" {{on "click" this.exportNotes}}><Icon @name="download" @size={{13}} /> Export</button>
              <label class="btn math-use settings-file">
                <Icon @name="upload" @size={{13}} /> Import
                <input type="file" accept="application/json,.json" class="sr-only" {{on "change" this.importNotes}} />
              </label>
            </div>
          </div>

          {{#if this.message}}
            <p class="{{if this.isError 'tool-error' 'tool-hint'}}" role="status">{{this.message}}</p>
          {{/if}}
        </section>

        <section class="math-card settings-danger">
          <h3 class="qr-heading">Danger zone</h3>
          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Clear favourites</span>
              <span class="tool-hint">Unstars every tool on the home page.</span>
            </div>
            <button type="button" class="btn math-use" {{on "click" this.clearFavourites}}>Clear</button>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Delete all notes</span>
              <span class="tool-hint">Removes every note and folder from Quick Notes.</span>
            </div>
            <button type="button" class="btn math-use is-danger" {{on "click" this.deleteNotes}}><Icon @name="trash-2" @size={{13}} /> Delete</button>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span class="qr-label">Reset everything</span>
              <span class="tool-hint">Deletes all notes, favourites and settings, then reloads.</span>
            </div>
            <button type="button" class="btn math-use is-danger" {{on "click" this.resetEverything}}>Reset</button>
          </div>
        </section>
      </div>
    </div>
  </template>
}
