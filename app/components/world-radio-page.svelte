<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';

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

  class WorldRadioPage extends Component {
    get pipBusy() {
      return this.playing;
    }

    get pipWarning() {
      return 'Close World Radio? The station will stop playing.';
    }
    stations = $state.raw([]);
    loading = $state.raw(true);
    error = $state.raw(null);
    tuned = $state.raw(null);
    hovered = $state.raw(null);
    current = $state.raw(null);
    playing = $state.raw(false);
    buffering = $state.raw(false);
    playError = $state.raw(null);
    volume = $state.raw(0.8);
    query = $state.raw('');
    favourites = $state.raw([]);
    autoRotate = $state.raw(true);
    panelOpen = $state.raw(true);

    globe = null;
    audio = null;

    constructor(args) {
      super(args);
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
      return `--v:${this.volume}`;
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
      import('../lazy/radio-globe.js').then(({ createGlobe }) => {
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
  }
</script>

<script>
  let args = $props();
  const self = new WorldRadioPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable require-media-caption -->
<ToolPage
  route="world-radio"
  game={true}
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Spin the globe and listen to whatever's on the air underneath the crosshair: thousands of live stations from every corner of the world, streamed straight from the station to you."
>
  <div class="wr-stage pop-in">
    <canvas class="wr-globe" {@attach self.bindGlobe?.()}></canvas>
    <div class="wr-crosshair" aria-hidden="true"></div>
    <audio preload="none" {@attach self.bindAudio?.()}></audio>

    <div class="wr-top">
      <div class="wr-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Search a station, city or country"
          aria-label="Search stations"
          {@attach prop('value', () => self.query)}
          oninput={self.setQuery}
        />
      </div>
      {#if truthy(self.results?.length)}
        <ul class="wr-list wr-results">
          {#each self.results ?? [] as s (s?.id)}
            <li
              ><button
                type="button"
                class="wr-item"
                onclick={(..._r) => self.goTo(s, ..._r)}
                ><strong>{s?.name}</strong><span
                  >{s?.state}{truthy(s?.state) ? ', ' : ''}{s?.country}</span
                ></button
              ></li
            >
          {/each}
        </ul>
      {/if}
    </div>

    <div class="wr-place">
      <strong>{self.placeStation}</strong>
      <span>{self.place}</span>
      {#if truthy(self.tuned)}
        <button
          type="button"
          class="btn active wr-tune"
          onclick={self.playTuned}
          ><Icon name="play" size={13} /> Tune in</button
        >
      {/if}
    </div>

    <aside class="wr-side {truthy(self.panelOpen) ? 'is-open' : ''}">
      <button
        type="button"
        class="wr-side-toggle"
        aria-expanded={truthy(self.panelOpen) ? 'true' : 'false'}
        aria-label={truthy(self.panelOpen) ? 'Hide the list' : 'Show the list'}
        onclick={self.togglePanel}>{truthy(self.panelOpen) ? '›' : '‹'}</button
      >
      <div class="wr-side-body">
        {#if truthy(self.favouriteStations?.length)}
          <span class="wr-label">Favourites</span>
          <ul class="wr-list">
            {#each self.favouriteStations ?? [] as s (s?.id)}
              <li
                ><button
                  type="button"
                  class="wr-item
                        {truthy(eq(s?.id, self.current?.id))
                    ? 'is-active'
                    : ''}"
                  onclick={(..._r) => self.goTo(s, ..._r)}
                  ><strong>{s?.name}</strong><span>{s?.country}</span></button
                ></li
              >
            {/each}
          </ul>
        {/if}
        {#if truthy(self.nearby?.length)}
          <span class="wr-label"
            >On the air near
            {self.tuned?.country}</span
          >
          <ul class="wr-list">
            {#each self.nearby ?? [] as s (s?.id)}
              <li
                ><button
                  type="button"
                  class="wr-item
                        {truthy(eq(s?.id, self.current?.id))
                    ? 'is-active'
                    : ''}"
                  onclick={(..._r) => self.play(s, ..._r)}
                  ><strong>{s?.name}</strong><span
                    >{s?.state}{truthy(s?.state) ? ', ' : ''}{s?.country}</span
                  ></button
                ></li
              >
            {/each}
          </ul>
        {:else}
          <p class="wr-hint"
            >Turn the globe until the crosshair sits on a green dot, click a
            dot, or search above.</p
          >
        {/if}
        <p class="wr-hint"
          >{self.stations?.length}
          stations from the Radio Browser directory. Streams play straight from each
          broadcaster; some go quiet from time to time.</p
        >
      </div>
    </aside>

    <div class="wr-bottom">
      {#if truthy(self.current)}
        <div class="wr-now">
          {#if truthy(self.current?.favicon)}
            <img class="wr-logo" src={self.current?.favicon} alt="" />
          {:else}
            <div class="wr-logo is-blank"><Icon name="radio" size={18} /></div>
          {/if}
          <div class="wr-now-text">
            <strong>{self.current?.name}</strong>
            <span
              >{self.current?.state}{truthy(self.current?.state)
                ? ', '
                : ''}{self.current?.country}{#if truthy(self.current?.bitrate)}
                ·
                {self.current?.bitrate}
                kbps{/if}</span
            >
            {#if truthy(self.playError)}<span class="wr-error"
                >{self.playError}</span
              >{/if}
          </div>
          <div class="wr-controls">
            <button type="button" class="btn active" onclick={self.togglePlay}>
              <Icon name={truthy(self.playing) ? 'pause' : 'play'} size={13} />
              {truthy(self.buffering)
                ? 'Connecting…'
                : truthy(self.playing)
                  ? 'Pause'
                  : 'Play'}
            </button>
            <button
              type="button"
              class="btn {truthy(self.isFavourite) ? 'active' : ''}"
              aria-label="Favourite"
              onclick={self.toggleFavourite}
              ><Icon name="star" size={13} /></button
            >
            <button type="button" class="btn" onclick={self.stop}>Stop</button>
            <input
              type="range"
              class="wr-volume"
              min="0"
              max="1"
              step="0.02"
              {@attach prop('value', () => self.volume)}
              aria-label="Volume"
              oninput={self.setVolume}
            />
            {#if truthy(self.playing)}<div class="wr-bars" aria-hidden="true"
                ><i></i><i></i><i></i><i></i></div
              >{/if}
          </div>
        </div>
      {/if}
      <div class="wr-globe-tools">
        <button
          type="button"
          class="btn {truthy(self.autoRotate) ? 'active' : ''}"
          onclick={self.toggleRotate}
          >{truthy(self.autoRotate) ? 'Spinning' : 'Spin'}</button
        >
      </div>
    </div>

    {#if truthy(self.loading)}
      <div class="wr-loading">Finding the stations…</div>
    {/if}
    {#if truthy(self.error)}
      <div class="wr-loading is-error"
        >{self.error}
        <button type="button" class="btn" onclick={self.load}>Try again</button
        ></div
      >
    {/if}
  </div>
</ToolPage>
