import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';
import AvatarPicker from './avatar-picker';
import AvatarPortrait from './avatar-portrait';
import SoundMixer from './sound-mixer';
import ControlsSettings from './controls-settings';
import DataTransfer, { transferCodeFromUrl } from './data-transfer';
import { loadProfile, saveProfile, NAME_LENGTH } from '../utils/profile';
import { formatBytes } from '../utils/file-share';
import {
  downloadBackup,
  applyBackup,
  validateBackup,
  summarise,
  idbBytes,
  STORAGE_PREFIX,
} from '../utils/site-data';
import { idbDeletePrefix } from '../utils/idb-store';
import { originOf } from '../utils/theme-origin';
import { TOOLS, groupTools } from '../tools';
import { APP_VERSION } from '../changelog';
import { askConfirm } from '../utils/confirm';

const eq = (a, b) => a === b;

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'controls', label: 'Controls', icon: 'gamepad-2' },
  { id: 'sound', label: 'Sound', icon: 'volume-2' },
  { id: 'tools', label: 'Tools', icon: 'eye' },
  { id: 'data', label: 'Data', icon: 'database' },
];
const TAB_KEY = 'woogi-settings-tab';
let requestedTab = null;

// Opens Settings on a particular tab next time it's shown (the volume popover uses it for 'sound').
export function openSettingsTab(id) {
  // Already on Settings: just switch.
  if (livePage && !livePage.isDestroying) livePage.setTab(id);
  else requestedTab = id;
}
let livePage = null;

function takeRequestedTab() {
  const id = requestedTab;
  requestedTab = null;
  if (TABS.some((t) => t.id === id)) return id;
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? saved : null;
  } catch {
    return null;
  }
}

const VISIBILITY_GROUPS = groupTools(
  TOOLS.filter((t) => t.category),
  { copies: false },
);

const THEMES = [
  { id: 'system', label: 'System', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

const MOTIONS = [
  { id: 'system', label: 'Match system' },
  { id: 'reduce', label: 'Reduced' },
];

function storedBytes() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(STORAGE_PREFIX))
        total += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2; // UTF-16
    }
    return total;
  } catch {
    return 0;
  }
}

function download(filename, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: filename,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default class SettingsPage extends Component {
  @service settings;
  @service notes;
  @service favourites;
  @service toolVisibility;
  @service offline;

  themes = THEMES;
  motions = MOTIONS;

  @tracked toolSearch = '';
  // Your name and avatar in games; every game lobby reads the same saved profile.
  @tracked profile = loadProfile();
  nameLength = NAME_LENGTH;
  // Opened from a transfer link: show that section straight away.
  transferring = Boolean(transferCodeFromUrl());

  tabs = TABS;
  // A transfer link opens the data tab; the volume popover's mixer button asks for the sound tab.
  @tracked tab = this.transferring
    ? 'data'
    : (takeRequestedTab() ?? 'appearance');

  // What the tools and saved projects hold in IndexedDB, read once on the
  // way in (it can only be read asynchronously).
  @tracked bigBytes = 0;

  constructor(owner, args) {
    super(owner, args);
    livePage = this;
    idbBytes().then((bytes) => {
      if (!this.isDestroyed) this.bigBytes = bytes * 2;
    });
  }

  willDestroy() {
    super.willDestroy();
    if (livePage === this) livePage = null;
  }

  setTab = (id) => {
    this.tab = id;
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // storage blocked
    }
  };

  setProfileName = (event) => {
    this.profile = saveProfile({ ...this.profile, name: event.target.value });
    this.storageVersion++;
  };

  pickAvatar = (look) => {
    this.profile = saveProfile({ ...this.profile, ...look });
    this.storageVersion++;
  };

  // ─── Whole-site backup ───────────────────────────────────────────────

  exportAll = async () => {
    const { data, idb } = await downloadBackup();
    this.notify(
      `Downloaded a backup of ${Object.keys(data).length + Object.keys(idb).length} saved items.`,
    );
  };

  importAll = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = validateBackup(JSON.parse(reader.result));
        const s = summarise(backup);
        const ok = await askConfirm({
          title: 'Replace everything on this device?',
          message: `This backup has ${s.notes} notes, ${s.avatars} saved avatars, ${s.favourites} favourites, ${s.keys} items in all. What's saved here now will be replaced, and this can't be undone.`,
          confirmLabel: 'Hold to replace',
        });
        if (!ok) return;
        await applyBackup(backup);
        // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a page reload, not a data request
        window.location.reload();
      } catch (error) {
        this.notify(
          error instanceof SyntaxError
            ? "That file isn't valid JSON."
            : error.message,
          true,
        );
      }
    };
    reader.readAsText(file);
  };

  get visibilityGroups() {
    const query = this.toolSearch.trim().toLowerCase();
    return VISIBILITY_GROUPS.map((group) => ({
      name: group.name,
      hidden: this.toolVisibility.isCategoryHidden(group.name),
      items: group.items
        .filter((tool) => !query || tool.label.toLowerCase().includes(query))
        .map((tool) => ({
          tool,
          hidden: this.toolVisibility.isToolHidden(tool.route),
        })),
    })).filter((group) => group.items.length);
  }

  setToolSearch = (event) => (this.toolSearch = event.target.value);

  @tracked message = null;
  @tracked isError = false;
  // Bumped after anything that changes storage, so the usage figure re-reads it.
  @tracked storageVersion = 0;

  get storageUsed() {
    // Reading these re-runs the getter whenever something that's saved changes.
    const watched = [
      this.storageVersion,
      this.notes.notes,
      this.favourites.routes,
      this.settings.themePreference,
      this.settings.motion,
      this.settings.handSearch,
    ];
    return watched && formatBytes(storedBytes() + this.bigBytes);
  }

  appVersion = APP_VERSION;

  get offlineStatus() {
    const { status, isOnline } = this.offline;
    if (status === 'ready')
      return isOnline
        ? "Saved for offline use. Updates download automatically when you're online."
        : "You're offline, running from the saved copy.";
    if (status === 'installing') return 'Downloading the site for offline use…';
    if (status === 'cleared')
      return 'Offline copy removed. Reload the page to download it again.';
    if (status === 'disabled')
      return 'Offline mode only runs on the deployed site, not in development.';
    if (status === 'unsupported')
      return "This browser doesn't support offline mode.";
    return "Offline mode couldn't start. The site still works while online.";
  }

  get offlineCacheSize() {
    return this.offline.cacheBytes === null
      ? '-'
      : formatBytes(this.offline.cacheBytes);
  }

  get lastCheckedLabel() {
    return (
      this.offline.lastChecked?.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }) ?? 'never'
    );
  }

  checkForUpdate = async () => {
    await this.offline.checkForUpdate();
    await this.offline.measure();
    if (!this.offline.updateReady)
      this.notify(
        this.offline.isOnline
          ? 'Checked for updates. If a new version exists it downloads in the background.'
          : "You're offline, so there's nothing to check right now.",
      );
  };

  clearOffline = async () => {
    if (
      !(await askConfirm({
        title: 'Remove the offline copy?',
        message:
          'Woogi Tools will need the internet again until it downloads a fresh copy. Your notes and settings are kept.',
        confirmLabel: 'Hold to remove',
        holdMs: 1500,
      }))
    )
      return;
    await this.offline.clear();
    this.notify('Offline copy removed.');
  };

  get systemThemeLabel() {
    return this.settings.systemDark ? 'dark' : 'light';
  }

  notify(text, isError = false) {
    this.message = text;
    this.isError = isError;
    this.storageVersion++;
  }

  setTheme = (id, event) => this.settings.setTheme(id, originOf(event));
  setMotion = (id) => this.settings.setMotion(id);
  toggleHandSearch = (event) =>
    this.settings.setHandSearch(event.target.checked);
  toggleCategoryHidden = (category) =>
    this.toolVisibility.toggleCategory(category);
  toggleToolHidden = (route) => this.toolVisibility.toggleTool(route);

  exportNotes = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(
      `woogi-notes-${stamp}.json`,
      JSON.stringify(this.notes.exportData(), null, 2),
    );
    this.notify(`Exported ${this.notes.notes.length} notes.`);
  };

  importNotes = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { notes, folders } = this.notes.importData(
          JSON.parse(reader.result),
        );
        this.notify(
          `Imported ${notes} note${notes === 1 ? '' : 's'} and ${folders} folder${folders === 1 ? '' : 's'}.`,
        );
      } catch (error) {
        this.notify(
          error instanceof SyntaxError
            ? "That file isn't valid JSON."
            : error.message,
          true,
        );
      }
    };
    reader.readAsText(file);
  };

  clearFavourites = async () => {
    if (
      !(await askConfirm({
        title: 'Clear favourites?',
        message: 'Every starred tool on the home page will be unstarred.',
        confirmLabel: 'Hold to clear',
        holdMs: 1500,
      }))
    )
      return;
    this.favourites.clear();
    this.notify('Favourites cleared.');
  };

  deleteNotes = async () => {
    if (
      !(await askConfirm({
        title: 'Delete all notes?',
        message:
          'Every note and folder in Quick Notes will be deleted. Export them first if you want a backup.',
        confirmLabel: 'Hold to delete',
      }))
    )
      return;
    this.notes.clearAll();
    this.notify('All notes deleted.');
  };

  resetEverything = async () => {
    if (
      !(await askConfirm({
        title: 'Reset Woogi Tools?',
        message:
          'This deletes the notes, favourites, avatars, settings and offline copy saved in this browser, then reloads.',
        confirmLabel: 'Hold to reset',
      }))
    )
      return;
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_PREFIX))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // storage blocked: nothing was saved anyway
    }
    await idbDeletePrefix(STORAGE_PREFIX);
    await this.offline.clear();
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a page reload, not a data request
    window.location.reload();
  };

  <template>
    <div class="container">
      <section class="hero pop-in">
        <div class="hero-icon"><Icon @name="settings" @size={{28}} /></div>
        <div class="hero-text">
          <h1 class="hero-title"><span>Settings</span></h1>
          <p>Preferences for the whole site. Everything is stored in this
            browser only.</p>
        </div>
      </section>

      <div
        class="math-tabs settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {{#each this.tabs key="id" as |t|}}
          <button
            type="button"
            role="tab"
            class="qr-tab {{if (eq this.tab t.id) 'active'}}"
            aria-selected={{if (eq this.tab t.id) "true" "false"}}
            {{on "click" (fn this.setTab t.id)}}
          >
            {{! the tab is named by its text; the glyph is hidden from the
            accessibility tree rather than read out beside it }}
            <Icon @name={{t.icon}} @size={{14}} aria-hidden="true" />
            {{t.label}}
          </button>
        {{/each}}
      </div>

      <div class="settings pop-in">
        {{#if (eq this.tab "appearance")}}
          <section class="math-card">
            <h3 class="qr-heading">Appearance</h3>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Theme</span>
                <span class="tool-hint">
                  {{#if (eq this.settings.themePreference "system")}}Following
                    your device, currently
                    {{this.systemThemeLabel}}.{{else}}Always
                    {{this.settings.themePreference}}.{{/if}}
                </span>
              </div>
              <div
                class="math-tabs settings-choice"
                role="group"
                aria-label="Theme"
              >
                {{#each this.themes as |t|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.themePreference t.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.themePreference t.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setTheme t.id)}}
                  >
                    <Icon @name={{t.icon}} @size={{14}} />
                    {{t.label}}
                  </button>
                {{/each}}
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Animations</span>
                <span class="tool-hint">Reduced turns off bounces, wobbles and
                  slides across the site.</span>
              </div>
              <div
                class="math-tabs settings-choice"
                role="group"
                aria-label="Animations"
              >
                {{#each this.motions as |m|}}
                  <button
                    type="button"
                    class="qr-tab
                      {{if (eq this.settings.motion m.id) 'active'}}"
                    aria-pressed={{if
                      (eq this.settings.motion m.id)
                      "true"
                      "false"
                    }}
                    {{on "click" (fn this.setMotion m.id)}}
                  >{{m.label}}</button>
                {{/each}}
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Hand of cards search</span>
                <span class="tool-hint">Home page search results are also fanned
                  out in a hand of cards. Turn off to see only the plain card
                  grid.</span>
              </div>
              <label class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.settings.handSearch}}
                  aria-checked={{if this.settings.handSearch "true" "false"}}
                  {{on "change" this.toggleHandSearch}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Show hand
              </label>
            </div>
          </section>
        {{/if}}

        {{#if (eq this.tab "appearance")}}
          <section class="math-card settings-avatar">
            <h3 class="qr-heading">You</h3>
            <p class="tool-hint">Your name and the avatar that represents you
              around the site, games included. Pick any look you’ve made in the
              Avatar Editor, whether that’s you, your OC or a little gremlin.</p>
            <div class="settings-avatar-row">
              <AvatarPortrait
                @avatar={{this.profile.avatar}}
                @pose={{this.profile.pose}}
                @size={{64}}
              />
              <label class="lobby-name">
                <span class="qr-label is-muted">Name</span>
                <input
                  type="text"
                  maxlength={{this.nameLength}}
                  value={{this.profile.name}}
                  {{on "input" this.setProfileName}}
                />
              </label>
            </div>
            <span class="qr-label is-muted">Avatar</span>
            <AvatarPicker
              @profile={{this.profile}}
              @onPick={{this.pickAvatar}}
              @size={{60}}
            />
          </section>
        {{/if}}

        {{#if (eq this.tab "controls")}}
          <section class="math-card" id="controls">
            <h3 class="qr-heading">Controls</h3>
            <p class="tool-hint">Keyboard shortcuts and controller buttons for
              the games. Change anything you like.</p>
            <ControlsSettings />
          </section>
        {{/if}}

        {{#if (eq this.tab "sound")}}
          <section class="math-card" id="sound">
            <h3 class="qr-heading">Sound</h3>
            <p class="tool-hint">Turn down, or off, just the sounds you don’t
              want. Slide a channel to hear it at its new level.</p>
            <SoundMixer />
          </section>
        {{/if}}

        {{#if (eq this.tab "tools")}}
          <section class="math-card">
            <h3 class="qr-heading">Tool visibility</h3>
            <p class="tool-hint">Hide tools or whole categories you don't use.
              Everything is shown by default; nothing is deleted, and you can
              bring it back any time.</p>

            <div class="sidebar-search settings-tool-search">
              <Icon @name="search" @size={{13}} />
              <input
                type="text"
                placeholder="Search tools…"
                aria-label="Search tools"
                value={{this.toolSearch}}
                {{on "input" this.setToolSearch}}
              />
            </div>

            {{#each this.visibilityGroups key="name" as |group|}}
              <div class="settings-row">
                <div class="settings-label">
                  <span class="qr-label">{{group.name}}</span>
                  <span class="tool-hint">Hides every tool in this category.</span>
                </div>
                <label class="qr-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={{if group.hidden false true}}
                    aria-checked={{if group.hidden "false" "true"}}
                    {{on "change" (fn this.toggleCategoryHidden group.name)}}
                  />
                  <span class="qr-switch-track" aria-hidden="true"></span>
                  Show category
                </label>
              </div>

              <div class="settings-tool-grid">
                {{#each group.items key="tool.route" as |entry|}}
                  <label
                    class="settings-tool-item
                      {{if entry.hidden 'is-off'}}
                      {{if group.hidden 'is-disabled'}}"
                  >
                    <input
                      type="checkbox"
                      checked={{if entry.hidden false true}}
                      disabled={{group.hidden}}
                      {{on
                        "change"
                        (fn this.toggleToolHidden entry.tool.route)
                      }}
                    />
                    <span class="settings-tool-check" aria-hidden="true"><Icon
                        @name="check"
                        @size={{11}}
                      /></span>
                    <Icon @name={{entry.tool.icon}} @size={{13}} />
                    <span>{{entry.tool.label}}</span>
                  </label>
                {{/each}}
              </div>
            {{/each}}

            {{#unless this.visibilityGroups.length}}
              <p class="tool-hint">No tools match "{{this.toolSearch}}".</p>
            {{/unless}}
          </section>
        {{/if}}

        {{#if (eq this.tab "data")}}
          <section class="math-card">
            <h3 class="qr-heading">Your data</h3>
            <div class="math-stats">
              <div class="math-stat"><span>Notes</span><strong
                >{{this.notes.notes.length}}</strong></div>
              <div class="math-stat"><span>Folders</span><strong
                >{{this.notes.folders.length}}</strong></div>
              <div class="math-stat"><span>Favourites</span><strong
                >{{this.favourites.routes.length}}</strong></div>
              <div class="math-stat"><span>Storage used</span><strong
                >{{this.storageUsed}}</strong></div>
              <div class="math-stat"><span>Offline cache</span><strong
                >{{this.offlineCacheSize}}</strong></div>
            </div>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Offline mode</span>
                <span class="tool-hint">{{this.offlineStatus}}</span>
                <span class="tool-hint">
                  Version
                  {{this.appVersion}}{{#if this.offline.buildId}}
                    · build
                    <code>{{this.offline.buildId}}</code>{{/if}}{{#if
                    this.offline.cacheFiles
                  }} · {{this.offline.cacheFiles}} files saved{{/if}}
                  · last checked
                  {{this.lastCheckedLabel}}
                </span>
              </div>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn math-use"
                  disabled={{if this.offline.registration false true}}
                  {{on "click" this.checkForUpdate}}
                ><Icon @name="refresh-cw" @size={{13}} />
                  {{if
                    this.offline.checking
                    "Checking…"
                    "Check for updates"
                  }}</button>
                <button
                  type="button"
                  class="btn math-use"
                  disabled={{if this.offline.cacheBytes false true}}
                  {{on "click" this.clearOffline}}
                ><Icon @name="trash-2" @size={{13}} /> Remove</button>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Quick Notes backup</span>
                <span class="tool-hint">Download every note as a JSON file, or
                  add notes from a backup. Importing never overwrites existing
                  notes.</span>
              </div>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn math-use"
                  {{on "click" this.exportNotes}}
                ><Icon @name="download" @size={{13}} /> Export</button>
                <label class="btn math-use settings-file">
                  <Icon @name="upload" @size={{13}} />
                  Import
                  <input
                    type="file"
                    accept="application/json,.json"
                    class="sr-only"
                    {{on "change" this.importNotes}}
                  />
                </label>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Back up all site data</span>
                <span class="tool-hint">Download everything this site saved in
                  this browser (notes, favourites, settings, avatars, game
                  rules) as one file, then import it on another device.
                  Importing replaces what's there.</span>
              </div>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn math-use"
                  {{on "click" this.exportAll}}
                ><Icon @name="download" @size={{13}} /> Export all</button>
                <label class="btn math-use settings-file">
                  <Icon @name="upload" @size={{13}} />
                  Import all
                  <input
                    type="file"
                    accept="application/json,.json"
                    class="sr-only"
                    {{on "change" this.importAll}}
                  />
                </label>
              </div>
            </div>

            {{#if this.message}}
              <p
                class="{{if this.isError 'tool-error' 'tool-hint'}}"
                role="status"
              >{{this.message}}</p>
            {{/if}}

            <details class="settings-transfer" open={{this.transferring}}>
              <summary><Icon @name="arrow-right-left" @size={{14}} />
                Transfer data to another device</summary>
              <p class="tool-hint">Send all your data straight to another device
                with a link, no file needed. The other device has to confirm
                before anything is replaced.</p>
              <DataTransfer />
            </details>
          </section>
        {{/if}}

        {{#if (eq this.tab "data")}}
          <section class="math-card settings-danger">
            <h3 class="qr-heading">Danger zone</h3>
            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Clear favourites</span>
                <span class="tool-hint">Unstars every tool on the home page.</span>
              </div>
              <button
                type="button"
                class="btn math-use"
                {{on "click" this.clearFavourites}}
              >Clear</button>
            </div>
            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Delete all notes</span>
                <span class="tool-hint">Removes every note and folder from Quick
                  Notes.</span>
              </div>
              <button
                type="button"
                class="btn math-use is-danger"
                {{on "click" this.deleteNotes}}
              ><Icon @name="trash-2" @size={{13}} /> Delete</button>
            </div>
            <div class="settings-row">
              <div class="settings-label">
                <span class="qr-label">Reset everything</span>
                <span class="tool-hint">Deletes all notes, favourites, settings
                  and the offline copy, then reloads.</span>
              </div>
              <button
                type="button"
                class="btn math-use is-danger"
                {{on "click" this.resetEverything}}
              >Reset</button>
            </div>
          </section>
        {{/if}}
      </div>
    </div>
  </template>
}
