import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import {
  lookup,
  parseTarget,
  placeLine,
  mapView,
  mapLinkUrl,
  localTime,
  flagFor,
  MAP_VIEWS,
} from '../utils/ip-lookup';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

// IP Address Lookup. The map is the tool, the way the globe is World Radio's:
// it fills the page, and the address, the search box and the map's own
// controls sit over it. Everything that used to be a wall of rows now lives
// in one panel that slides in from the side, so the map is what you see.
//
// The map itself is a same-origin Leaflet map rather than an embedded iframe.
// That is what makes the scroll wheel zoom the ordinary way instead of
// needing Ctrl+scroll (an iframe from another site can demand that; a map
// drawn straight into this page's own DOM has no reason to), and it is also
// why this site's own Ctrl+F keeps working while the map has focus: a
// cross-origin iframe is a separate document, so a keystroke typed into it
// never reaches this page's listener at all.

const RECENT = 6;
const eq = (a, b) => a === b;

// Where the map sits before any address has been looked up: zoomed right out.
const WORLD = { lat: 20, lng: 0, zoom: 2 };

// Leaflet is only ever needed on this one page, so it is fetched when the map
// mounts rather than bundled into everything else, and cached so switching
// views or looking up a second address doesn't fetch it again.
let leafletPromise = null;
function loadLeaflet() {
  return (leafletPromise ??= import('leaflet').then((L) => {
    // Leaflet's default marker finds its own images by reading a CSS
    // background-image trick that doesn't survive being bundled; pointing it
    // at the actual built URLs is the fix every bundled Leaflet needs.
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: markerIconUrl,
      iconRetinaUrl: markerIcon2xUrl,
      shadowUrl: markerShadowUrl,
    });
    return L;
  }));
}

function buildLayerGroup(L, viewId) {
  const view = mapView(viewId);
  return L.layerGroup(
    view.layers.map((layer) =>
      L.tileLayer(layer.url, {
        attribution: layer.attribution,
        maxZoom: view.maxZoom,
      }),
    ),
  );
}

export default class IpLookupPage extends Component {
  views = MAP_VIEWS;

  @tracked query = '';
  @tracked loading = false;
  @tracked error = '';
  @tracked result = null;
  @tracked recent = [];
  @tracked view = 'road';
  @tracked panelOpen = false;

  // Leaflet's own map, its current tile layer and marker. Plain fields, not
  // tracked: once the map exists it manages its own pan and zoom, and
  // rebuilding it on every keystroke would fight the person dragging it.
  map = null;
  tileLayer = null;
  marker = null;

  constructor(owner, args) {
    super(owner, args);
    // The lookup waits for the restore, so reopening the tool shows the
    // address you were last looking at. With nothing remembered, that is the
    // empty box, which means your own address: the thing most people came
    // here for. It also has to wait because a tracked field cannot be written
    // while the page is still rendering.
    keepState(this, 'ip-lookup', ['query', 'recent', 'view'], () =>
      this.run(this.query),
    );
  }

  get target() {
    return parseTarget(this.query);
  }

  get isSelf() {
    return !this.target;
  }

  get place() {
    return this.result ? placeLine(this.result) : '';
  }

  get flag() {
    return flagFor(this.result?.countryCode);
  }

  get time() {
    return localTime(this.result?.timezone);
  }

  get coordinates() {
    const r = this.result;
    if (!r || r.latitude == null) return '';
    return `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`;
  }

  get hasPin() {
    return Boolean(this.result && this.result.latitude != null);
  }

  get mapLink() {
    return this.hasPin ? mapLinkUrl(this.result) : '';
  }

  // The headline facts, for the card over the map. Everything else is in the
  // panel, so this stays a couple of lines whatever came back.
  get summary() {
    const r = this.result;
    if (!r) return [];
    return [
      { label: 'Provider', value: r.isp || r.org },
      { label: 'Network', value: r.asn },
      { label: 'Local time', value: this.time },
      { label: 'Coordinates', value: this.coordinates },
    ].filter((row) => row.value);
  }

  get groups() {
    const r = this.result;
    if (!r) return [];
    return [
      {
        title: 'Location',
        icon: 'globe',
        rows: [
          { label: 'City', value: r.city },
          {
            label: 'Region',
            value: [r.region, r.regionCode].filter(Boolean).join(' · '),
          },
          {
            label: 'Country',
            value: [this.flag, r.country, r.countryCode && `(${r.countryCode})`]
              .filter(Boolean)
              .join(' '),
          },
          { label: 'Continent', value: r.continent },
          { label: 'Capital', value: r.capital },
          { label: 'Postcode', value: r.postal },
          { label: 'Coordinates', value: this.coordinates },
          {
            label: 'In the EU',
            value: r.country ? (r.isEu ? 'Yes' : 'No') : '',
          },
        ],
      },
      {
        title: 'Network',
        icon: 'network',
        rows: [
          { label: 'Address', value: r.ip },
          { label: 'Address type', value: r.type },
          { label: 'ASN', value: r.asn },
          { label: 'Internet provider', value: r.isp },
          {
            label: 'Organisation',
            value: r.org && r.org !== r.isp ? r.org : '',
          },
          { label: 'Provider domain', value: r.domain },
        ],
      },
      {
        title: 'Time and money',
        icon: 'clock',
        rows: [
          {
            label: 'Time zone',
            value: [r.timezone, r.utcOffset && `UTC${r.utcOffset}`]
              .filter(Boolean)
              .join(' · '),
          },
          { label: 'Local time', value: this.time },
          {
            label: 'Currency',
            value: [r.currencyName, r.currency && `(${r.currency})`]
              .filter(Boolean)
              .join(' '),
          },
          {
            label: 'Dialling code',
            value:
              r.callingCode && `+${String(r.callingCode).replace(/^\+/, '')}`,
          },
        ],
      },
    ]
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => row.value),
      }))
      .filter((group) => group.rows.length);
  }

  setQuery = (event) => (this.query = event.target.value);
  togglePanel = () => (this.panelOpen = !this.panelOpen);

  setView = async (id) => {
    this.view = id;
    const L = await loadLeaflet();
    if (this.isDestroying || this.isDestroyed || !this.map) return;
    this.tileLayer?.remove();
    this.tileLayer = buildLayerGroup(L, id).addTo(this.map);
    // Satellite and terrain imagery are worth being closer in for; a road
    // map isn't. The pan position stays put; only the zoom follows the view.
    this.map.setZoom(mapView(id).zoom);
  };

  zoomIn = () => this.map?.zoomIn();
  zoomOut = () => this.map?.zoomOut();

  submit = (event) => {
    event.preventDefault();
    this.run(this.query);
  };

  myIp = () => {
    this.query = '';
    this.run('');
  };

  again = (value) => {
    this.query = value;
    this.run(value);
  };

  async run(value) {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const result = await lookup(value);
      if (this.isDestroying || this.isDestroyed) return;
      this.result = result;
      this.remember(result.ip);
      this.showOnMap(result);
    } catch (error) {
      if (this.isDestroying || this.isDestroyed) return;
      this.error = error.message;
      this.result = null;
    } finally {
      this.loading = false;
    }
  }

  // The looked-up address itself is remembered, not what was typed, so a
  // hostname and its address don't both sit in the list.
  remember(ip) {
    if (!ip) return;
    this.recent = [ip, ...this.recent.filter((old) => old !== ip)].slice(
      0,
      RECENT,
    );
  }

  clearRecent = () => (this.recent = []);

  // ─── The map itself ────────────────────────────────────────────────────

  mountMap = modifier((element) => {
    this.startMap(element);
    return () => {
      this.map?.remove();
      this.map = null;
      this.tileLayer = null;
      this.marker = null;
    };
  });

  async startMap(element) {
    const L = await loadLeaflet();
    if (this.isDestroying || this.isDestroyed) return;
    const map = L.map(element, {
      // No built-in zoom buttons: the toolbar's own zoom chips call the map
      // directly, so there is only one set of controls to look at.
      zoomControl: false,
      attributionControl: true,
      // The whole point of leaving the iframe behind: this scrolls like any
      // other map, no modifier key needed.
      scrollWheelZoom: true,
    });
    this.map = map;
    this.tileLayer = buildLayerGroup(L, this.view).addTo(map);
    if (this.hasPin) {
      this.placeMarker(L, this.result);
      map.setView(
        [this.result.latitude, this.result.longitude],
        mapView(this.view).zoom,
      );
    } else {
      map.setView([WORLD.lat, WORLD.lng], WORLD.zoom);
    }
  }

  async showOnMap(result) {
    const L = await loadLeaflet();
    if (this.isDestroying || this.isDestroyed || !this.map) return;
    if (result.latitude == null) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    this.placeMarker(L, result);
    this.map.setView(
      [result.latitude, result.longitude],
      mapView(this.view).zoom,
    );
  }

  placeMarker(L, result) {
    const at = [result.latitude, result.longitude];
    if (this.marker) this.marker.setLatLng(at);
    else this.marker = L.marker(at).addTo(this.map);
  }

  <template>
    <ToolPage
      @route="ip-lookup"
      @game={{true}}
      @subtitle="Where an address is, who runs it and what time it is there. Leave the box empty for your own."
    >
      <div class="ipl-stage">
        <div class="ipl-map" {{this.mountMap}}></div>

        <div class="ipl-top">
          <form class="ipl-search" {{on "submit" this.submit}}>
            <Icon @name="search" @size={{15}} />
            <input
              type="text"
              placeholder="An address or a hostname"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              aria-label="IP address or hostname"
              value={{this.query}}
              {{on "input" this.setQuery}}
            />
            <button
              type="button"
              class="ipl-chip-btn"
              title="Look up this device's address"
              aria-label="Look up this device's address"
              {{on "click" this.myIp}}
            ><Icon @name="locate-fixed" @size={{14}} /></button>
            <button type="submit" class="ipl-go" disabled={{this.loading}}>{{if
                this.loading
                "…"
                "Look up"
              }}</button>
          </form>

          {{#if this.recent.length}}
            <div class="ipl-recent">
              {{#each this.recent as |ip|}}
                <button
                  type="button"
                  class="ipl-chip"
                  {{on "click" (fn this.again ip)}}
                >{{ip}}</button>
              {{/each}}
              <button
                type="button"
                class="ipl-chip is-quiet"
                {{on "click" this.clearRecent}}
              >Clear</button>
            </div>
          {{/if}}

          {{#if this.error}}
            <p class="ipl-error">{{this.error}}</p>
          {{/if}}
        </div>

        <div class="ipl-views">
          {{#each this.views as |view|}}
            <button
              type="button"
              class="ipl-view {{if (eq this.view view.id) 'is-on'}}"
              {{on "click" (fn this.setView view.id)}}
            >{{view.label}}</button>
          {{/each}}
          <span class="ipl-zoom">
            <button
              type="button"
              class="ipl-chip-btn"
              aria-label="Zoom out"
              {{on "click" this.zoomOut}}
            ><Icon @name="zoom-out" @size={{14}} /></button>
            <button
              type="button"
              class="ipl-chip-btn"
              aria-label="Zoom in"
              {{on "click" this.zoomIn}}
            ><Icon @name="zoom-in" @size={{14}} /></button>
          </span>
        </div>

        {{#if this.result}}
          <div class="ipl-card">
            <div class="ipl-card-head">
              <span class="ipl-flag" aria-hidden="true">{{if
                  this.flag
                  this.flag
                  "🌐"
                }}</span>
              <div class="ipl-card-title">
                <h2>{{this.result.ip}}</h2>
                <p>{{if
                    this.place
                    this.place
                    "Somewhere this service can't place"
                  }}</p>
              </div>
              <div class="ipl-card-actions">
                <CopyButton @value={{this.result.ip}} />
                <button
                  type="button"
                  class="ipl-chip"
                  {{on "click" this.togglePanel}}
                >{{if this.panelOpen "Hide details" "All details"}}</button>
              </div>
            </div>
            <div class="ipl-tags">
              {{#if this.isSelf}}<span class="ipl-tag">Your address</span>{{/if}}
              {{#if this.result.type}}<span
                  class="ipl-tag"
                >{{this.result.type}}</span>{{/if}}
              {{#each this.summary as |row|}}
                <span class="ipl-tag"><b>{{row.label}}</b> {{row.value}}</span>
              {{/each}}
            </div>
          </div>
        {{/if}}

        <aside
          class="ipl-panel {{if this.panelOpen 'is-open'}}"
          aria-label="Everything known about this address"
        >
          <div class="ipl-panel-head">
            <h3>Details</h3>
            {{#if this.mapLink}}
              <a
                class="ipl-chip"
                href={{this.mapLink}}
                target="_blank"
                rel="noopener noreferrer"
              >Open in maps</a>
            {{/if}}
            <button
              type="button"
              class="ipl-chip-btn"
              aria-label="Close the details"
              {{on "click" this.togglePanel}}
            ><Icon @name="x" @size={{14}} /></button>
          </div>
          <div class="ipl-panel-body">
            {{#each this.groups as |group|}}
              <section>
                <h4><Icon @name={{group.icon}} @size={{13}} />
                  {{group.title}}</h4>
                <dl>
                  {{#each group.rows as |row|}}
                    <div><dt>{{row.label}}</dt><dd>{{row.value}}</dd></div>
                  {{/each}}
                </dl>
              </section>
            {{/each}}
            <p class="ipl-note">Addresses are placed by database, not by
              satellite. City and country are usually right; the pin is often
              the middle of the area, or wherever the provider registered the
              block, and a phone or a VPN can put it hundreds of kilometres from
              the person using it.</p>
            {{#if this.result}}
              <p class="ipl-note">Answered by
                {{this.result.source}}, straight from this page, so nothing
                about the lookup passes through this site.</p>
            {{/if}}
          </div>
        </aside>

        {{#unless this.panelOpen}}
          <button
            type="button"
            class="ipl-panel-tab"
            aria-label="Show all the details"
            {{on "click" this.togglePanel}}
          ><Icon @name="chevrons-left" @size={{16}} /></button>
        {{/unless}}
      </div>
    </ToolPage>
  </template>
}
