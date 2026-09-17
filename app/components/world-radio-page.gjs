import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';

// Spin a globe and listen to whatever's on the air underneath the crosshair.
// The stations come from the Radio Browser community directory (the same
// open list radio.garden-style sites draw on); the sound streams straight
// from each station to you.

const HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
const LIMIT = 3500;
const PAGE = 700;
const STATION_CACHE = 'woogi-radio-stations';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const eq = (a, b) => a === b;
let cached = null;

// The directory is a few megabytes, so a copy is kept for a day; the globe
// is up in a moment on the second visit.
async function cachedStations() {
  try {
    const cache = await caches.open(STATION_CACHE);
    const hit = await cache.match('/stations');
    if (!hit) return null;
    const at = Number(hit.headers.get('x-fetched-at')) || 0;
    if (Date.now() - at > CACHE_TTL_MS) return null;
    return hit.json();
  } catch {
    return null;
  }
}

async function rememberStations(list) {
  try {
    const cache = await caches.open(STATION_CACHE);
    await cache.put(
      '/stations',
      new Response(JSON.stringify(list), {
        headers: {
          'content-type': 'application/json',
          'x-fetched-at': String(Date.now()),
        },
      }),
    );
  } catch {
    // No storage: it will be fetched again next time.
  }
}

const toStation = (r) => ({
  id: r.stationuuid,
  name: r.name.trim(),
  url: r.url_resolved,
  country: r.country,
  code: r.countrycode,
  state: r.state,
  lat: r.geo_lat,
  lon: r.geo_long,
  favicon: r.favicon?.startsWith('https://') ? r.favicon : '',
  tags: (r.tags ?? '').split(',').filter(Boolean).slice(0, 4),
  codec: r.codec,
  bitrate: r.bitrate,
});

// Only secure streams can play inside a secure page.
const playable = (r) =>
  r.url_resolved?.startsWith('https://') &&
  Number.isFinite(r.geo_lat) &&
  Number.isFinite(r.geo_long);

// The directory doesn't compress its answers and the full list is several
// megabytes, so it comes down in pages: the most popular stations land on
// the globe within a second and the rest fill in behind them. `onPage` is
// called with the growing list each time a page arrives.
async function loadStations(onPage) {
  if (cached) return cached;
  const stored = await cachedStations();
  if (stored?.length) return (cached = stored);
  let lastError = null;
  for (const host of HOSTS) {
    try {
      const list = [];
      const seen = new Set();
      for (let offset = 0; offset < LIMIT; offset += PAGE) {
        // eslint-disable-next-line warp-drive/no-external-request-patterns -- a public directory, not app data
        const response = await fetch(
          `${host}/json/stations/search?has_geo_info=true&hidebroken=true&order=clickcount&reverse=true&limit=${PAGE}&offset=${offset}`,
        );
        if (!response.ok)
          throw new Error(`Directory answered ${response.status}`);
        const rows = await response.json();
        for (const r of rows) {
          if (!playable(r) || seen.has(r.stationuuid)) continue;
          seen.add(r.stationuuid);
          list.push(toStation(r));
        }
        onPage?.([...list]);
        if (rows.length < PAGE) break;
      }
      cached = list;
      rememberStations(cached);
      return cached;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('The station directory is unreachable');
}

export default class WorldRadioPage extends Component {
  get pipBusy() {
    return this.playing;
  }

  get pipWarning() {
    return 'Close World Radio? The station will stop playing.';
  }
  @tracked stations = [];
  @tracked loading = true;
  @tracked error = null;
  @tracked tuned = null;
  @tracked hovered = null;
  @tracked current = null;
  @tracked playing = false;
  @tracked buffering = false;
  @tracked playError = null;
  @tracked volume = 0.8;
  @tracked query = '';
  @tracked favourites = [];
  @tracked autoRotate = true;
  @tracked panelOpen = true;

  globe = null;
  audio = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'world-radio', ['volume', 'favourites']);
    registerDestructor(this, () => {
      this.globe?.dispose();
      this.audio?.pause();
      if (this.audio) this.audio.src = '';
    });
  }

  get nearby() {
    if (!this.tuned) return [];
    const { lat, lon } = this.tuned;
    return this.stations
      .map((s) => ({
        s,
        d:
          (s.lat - lat) ** 2 +
          ((s.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2,
      }))
      .filter((x) => x.d < 4)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12)
      .map((x) => x.s);
  }

  get results() {
    const q = this.query.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.stations
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.country?.toLowerCase().includes(q) ||
          s.state?.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }

  get favouriteStations() {
    return this.favourites
      .map((id) => this.stations.find((s) => s.id === id))
      .filter(Boolean);
  }

  get isFavourite() {
    return this.current ? this.favourites.includes(this.current.id) : false;
  }

  get volumeStyle() {
    return htmlSafe(`--v:${this.volume}`);
  }

  get place() {
    const s = this.hovered ?? this.tuned;
    if (!s) return 'Turn the globe to find a station';
    return [s.state, s.country].filter(Boolean).join(', ');
  }

  get placeStation() {
    return (this.hovered ?? this.tuned)?.name ?? '';
  }

  bindGlobe = modifier((canvas) => {
    let alive = true;
    import('../lazy/radio-globe').then(({ createGlobe }) => {
      if (!alive) return;
      this.globe = createGlobe(canvas, {
        onTune: (station) => (this.tuned = station),
        onHover: (station) => (this.hovered = station),
        onClick: (station) => this.play(station),
      });
      this.globe.autoRotate(this.autoRotate);
      if (this.stations.length) this.globe.setStations(this.stations);
    });
    this.load();
    return () => {
      alive = false;
      this.globe?.dispose();
      this.globe = null;
    };
  });

  bindAudio = modifier((element) => {
    this.audio = element;
    element.volume = this.volume;
    const onPlay = () => {
      this.playing = true;
      this.buffering = false;
    };
    const onWait = () => (this.buffering = true);
    const onPause = () => (this.playing = false);
    const onError = () => {
      this.playing = this.buffering = false;
      this.playError =
        'This station isn’t answering right now. Try another nearby.';
    };
    element.addEventListener('playing', onPlay);
    element.addEventListener('waiting', onWait);
    element.addEventListener('pause', onPause);
    element.addEventListener('error', onError);
    element.addEventListener('stalled', onWait);
    return () => {
      element.removeEventListener('playing', onPlay);
      element.removeEventListener('waiting', onWait);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('error', onError);
      element.removeEventListener('stalled', onWait);
      this.audio = null;
    };
  });

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const show = (list) => {
        this.stations = list;
        this.globe?.setStations(list);
      };
      show(await loadStations(show));
    } catch (error) {
      this.error = error?.message ?? 'The station directory is unreachable';
    } finally {
      this.loading = false;
    }
  }

  play = (station) => {
    if (!station || !this.audio) return;
    this.current = station;
    this.playError = null;
    this.buffering = true;
    this.audio.src = station.url;
    this.audio.play().catch(() => {
      this.buffering = false;
      this.playError = 'This station couldn’t be played. Try another nearby.';
    });
    this.globe?.autoRotate(false);
    this.autoRotate = false;
  };

  playTuned = () => this.play(this.tuned);

  togglePlay = () => {
    if (!this.audio || !this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  };

  stop = () => {
    this.audio?.pause();
    if (this.audio) this.audio.src = '';
    this.current = null;
    this.playing = false;
  };

  setVolume = (event) => {
    this.volume = Number(event.target.value);
    if (this.audio) this.audio.volume = this.volume;
  };

  setQuery = (event) => (this.query = event.target.value);

  goTo = (station) => {
    this.globe?.flyTo(station.lat, station.lon);
    this.query = '';
    this.play(station);
  };

  toggleFavourite = () => {
    if (!this.current) return;
    const id = this.current.id;
    this.favourites = this.favourites.includes(id)
      ? this.favourites.filter((f) => f !== id)
      : [...this.favourites, id];
  };

  togglePanel = () => (this.panelOpen = !this.panelOpen);

  toggleRotate = () => {
    this.autoRotate = !this.autoRotate;
    this.globe?.autoRotate(this.autoRotate);
  };

  <template>
    {{! template-lint-disable require-media-caption }}
    <ToolPage
      @route="world-radio"
      @game={{true}}
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Spin the globe and listen to whatever's on the air underneath the crosshair: thousands of live stations from every corner of the world, streamed straight from the station to you."
    >
      <div class="wr-stage pop-in">
        <canvas class="wr-globe" {{this.bindGlobe}}></canvas>
        <div class="wr-crosshair" aria-hidden="true"></div>
        <audio {{this.bindAudio}} preload="none"></audio>

        <div class="wr-top">
          <div class="wr-search">
            <Icon @name="search" @size={{14}} />
            <input
              type="search"
              placeholder="Search a station, city or country"
              aria-label="Search stations"
              value={{this.query}}
              {{on "input" this.setQuery}}
            />
          </div>
          {{#if this.results.length}}
            <ul class="wr-list wr-results">
              {{#each this.results key="id" as |s|}}
                <li><button
                    type="button"
                    class="wr-item"
                    {{on "click" (fn this.goTo s)}}
                  ><strong>{{s.name}}</strong><span>{{s.state}}{{if
                        s.state
                        ", "
                      }}{{s.country}}</span></button></li>
              {{/each}}
            </ul>
          {{/if}}
        </div>

        <div class="wr-place">
          <strong>{{this.placeStation}}</strong>
          <span>{{this.place}}</span>
          {{#if this.tuned}}
            <button
              type="button"
              class="btn active wr-tune"
              {{on "click" this.playTuned}}
            ><Icon @name="play" @size={{13}} /> Tune in</button>
          {{/if}}
        </div>

        <aside class="wr-side {{if this.panelOpen 'is-open'}}">
          <button
            type="button"
            class="wr-side-toggle"
            aria-expanded={{if this.panelOpen "true" "false"}}
            aria-label={{if this.panelOpen "Hide the list" "Show the list"}}
            {{on "click" this.togglePanel}}
          >{{if this.panelOpen "›" "‹"}}</button>
          <div class="wr-side-body">
            {{#if this.favouriteStations.length}}
              <span class="wr-label">Favourites</span>
              <ul class="wr-list">
                {{#each this.favouriteStations key="id" as |s|}}
                  <li><button
                      type="button"
                      class="wr-item
                        {{if (eq s.id this.current.id) 'is-active'}}"
                      {{on "click" (fn this.goTo s)}}
                    ><strong>{{s.name}}</strong><span
                      >{{s.country}}</span></button></li>
                {{/each}}
              </ul>
            {{/if}}
            {{#if this.nearby.length}}
              <span class="wr-label">On the air near
                {{this.tuned.country}}</span>
              <ul class="wr-list">
                {{#each this.nearby key="id" as |s|}}
                  <li><button
                      type="button"
                      class="wr-item
                        {{if (eq s.id this.current.id) 'is-active'}}"
                      {{on "click" (fn this.play s)}}
                    ><strong>{{s.name}}</strong><span>{{s.state}}{{if
                          s.state
                          ", "
                        }}{{s.country}}</span></button></li>
                {{/each}}
              </ul>
            {{else}}
              <p class="wr-hint">Turn the globe until the crosshair sits on a
                green dot, click a dot, or search above.</p>
            {{/if}}
            <p class="wr-hint">{{this.stations.length}}
              stations from the Radio Browser directory. Streams play straight
              from each broadcaster; some go quiet from time to time.</p>
          </div>
        </aside>

        <div class="wr-bottom">
          {{#if this.current}}
            <div class="wr-now">
              {{#if this.current.favicon}}
                <img class="wr-logo" src={{this.current.favicon}} alt="" />
              {{else}}
                <div class="wr-logo is-blank"><Icon
                    @name="radio"
                    @size={{18}}
                  /></div>
              {{/if}}
              <div class="wr-now-text">
                <strong>{{this.current.name}}</strong>
                <span>{{this.current.state}}{{if
                    this.current.state
                    ", "
                  }}{{this.current.country}}{{#if this.current.bitrate}}
                    ·
                    {{this.current.bitrate}}
                    kbps{{/if}}</span>
                {{#if this.playError}}<span
                    class="wr-error"
                  >{{this.playError}}</span>{{/if}}
              </div>
              <div class="wr-controls">
                <button
                  type="button"
                  class="btn active"
                  {{on "click" this.togglePlay}}
                >
                  <Icon @name={{if this.playing "pause" "play"}} @size={{13}} />
                  {{if
                    this.buffering
                    "Connecting…"
                    (if this.playing "Pause" "Play")
                  }}
                </button>
                <button
                  type="button"
                  class="btn {{if this.isFavourite 'active'}}"
                  aria-label="Favourite"
                  {{on "click" this.toggleFavourite}}
                ><Icon @name="star" @size={{13}} /></button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.stop}}
                >Stop</button>
                <input
                  type="range"
                  class="wr-volume"
                  min="0"
                  max="1"
                  step="0.02"
                  value={{this.volume}}
                  aria-label="Volume"
                  {{on "input" this.setVolume}}
                />
                {{#if this.playing}}<div class="wr-bars" aria-hidden="true"><i
                    ></i><i></i><i></i><i></i></div>{{/if}}
              </div>
            </div>
          {{/if}}
          <div class="wr-globe-tools">
            <button
              type="button"
              class="btn {{if this.autoRotate 'active'}}"
              {{on "click" this.toggleRotate}}
            >{{if this.autoRotate "Spinning" "Spin"}}</button>
          </div>
        </div>

        {{#if this.loading}}
          <div class="wr-loading">Finding the stations…</div>
        {{/if}}
        {{#if this.error}}
          <div class="wr-loading is-error">{{this.error}}
            <button type="button" class="btn" {{on "click" this.load}}>Try again</button></div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
