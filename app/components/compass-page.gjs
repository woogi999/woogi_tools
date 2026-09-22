import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';

const eq = (a, b) => a === b;
const TICKS = Array.from({ length: 72 }, (_, i) => ({
  deg: i * 5,
  major: i % 9 === 0,
}));
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const pointFor = (deg) => POINTS[Math.round(deg / 45) % 8];
const NO_SENSOR_AFTER_MS = 3000;

export default class CompassPage extends Component {
  @tracked running = false;
  @tracked heading = null;
  @tracked hasCompass = null; // null until we know
  @tracked position = null;
  @tracked positionError = null;

  watch = null;
  orientationEvent = null;
  sensorTimer = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.stop());
  }

  get headingText() {
    return this.heading === null ? '-' : `${Math.round(this.heading)}°`;
  }

  get point() {
    return this.heading === null ? '' : pointFor(this.heading);
  }

  // The rose turns under a fixed needle, so north on the dial always points north.
  get roseStyle() {
    return htmlSafe(`transform:rotate(${-(this.heading ?? 0)}deg)`);
  }

  get coords() {
    if (!this.position) return null;
    const { latitude, longitude, altitude, accuracy, altitudeAccuracy, speed } =
      this.position;
    return {
      lat: latitude.toFixed(5),
      lon: longitude.toFixed(5),
      pair: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      accuracy: Math.round(accuracy),
      altitude:
        altitude === null || altitude === undefined
          ? null
          : `${Math.round(altitude)} m${
              altitudeAccuracy ? ` ± ${Math.round(altitudeAccuracy)} m` : ''
            }`,
      speed:
        speed === null || speed === undefined || Number.isNaN(speed)
          ? null
          : `${(speed * 3.6).toFixed(1)} km/h`,
    };
  }

  start = async () => {
    this.positionError = null;
    this.running = true;

    // iPhones ask before handing over the compass; elsewhere it's just on.
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        const answer = await DeviceOrientationEvent.requestPermission();
        if (answer !== 'granted') this.hasCompass = false;
      } catch {
        this.hasCompass = false;
      }
    }
    if (this.hasCompass !== false) {
      this.orientationEvent =
        'ondeviceorientationabsolute' in window
          ? 'deviceorientationabsolute'
          : 'deviceorientation';
      window.addEventListener(this.orientationEvent, this.onOrientation);
      this.sensorTimer = setTimeout(() => {
        if (this.heading === null) this.hasCompass = false;
      }, NO_SENSOR_AFTER_MS);
    }

    if (!navigator.geolocation) {
      this.positionError = 'This browser cannot give a location.';
      return;
    }
    this.watch = navigator.geolocation.watchPosition(
      (pos) => {
        this.position = pos.coords;
        this.positionError = null;
      },
      (err) => {
        this.positionError =
          err.code === 1
            ? 'Location was not allowed. Check the site permission.'
            : 'No position yet. Somewhere with a view of the sky helps.';
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  };

  onOrientation = (event) => {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number')
      heading = event.webkitCompassHeading;
    else if (event.absolute && typeof event.alpha === 'number')
      heading = (360 - event.alpha) % 360;
    else if (
      this.orientationEvent === 'deviceorientationabsolute' &&
      typeof event.alpha === 'number'
    )
      heading = (360 - event.alpha) % 360;
    if (heading === null) return;
    // Reading the screen sideways turns the frame with it.
    const turn = window.screen?.orientation?.angle ?? window.orientation ?? 0;
    this.heading = (heading + turn + 360) % 360;
    this.hasCompass = true;
  };

  stop = () => {
    if (this.orientationEvent)
      window.removeEventListener(this.orientationEvent, this.onOrientation);
    this.orientationEvent = null;
    clearTimeout(this.sensorTimer);
    if (this.watch !== null) navigator.geolocation?.clearWatch(this.watch);
    this.watch = null;
    this.running = false;
  };

  <template>
    <ToolPage
      @route="compass"
      @subtitle="A compass that follows your phone, with your altitude and coordinates from its GPS."
      @busy={{this.running}}
      @closeWarning="the compass"
    >
      <div class="math-grid pop-in">
        <section class="math-card compass-card">
          <div class="compass {{if this.running 'is-on'}}">
            <div class="compass-rose" style={{this.roseStyle}}>
              {{#each POINTS as |p|}}
                <span class="compass-point is-{{p}}">{{p}}</span>
              {{/each}}
              <svg
                viewBox="0 0 200 200"
                class="compass-ticks"
                aria-hidden="true"
              >
                {{#each TICKS as |t|}}
                  <line
                    x1="100"
                    y1="6"
                    x2="100"
                    y2={{if t.major "18" "12"}}
                    transform="rotate({{t.deg}} 100 100)"
                  />
                {{/each}}
              </svg>
            </div>
            <div class="compass-needle" aria-hidden="true"></div>
            <div class="compass-readout">
              <span class="compass-heading">{{this.headingText}}</span>
              <span class="compass-cardinal">{{this.point}}</span>
            </div>
          </div>
          <div class="settings-actions">
            {{#if this.running}}
              <button type="button" class="btn" {{on "click" this.stop}}>
                <Icon @name="circle-stop" @size={{13}} />
                Stop</button>
            {{else}}
              <button
                type="button"
                class="btn active"
                {{on "click" this.start}}
              >
                <Icon @name="compass" @size={{13}} />
                Start</button>
            {{/if}}
          </div>
          {{#if (eq this.hasCompass false)}}
            <p class="tool-hint">No compass sensor here, so the needle stays
              put. On a phone, hold it flat and move it in a figure of eight if
              the heading seems off.</p>
          {{else if this.running}}
            <p class="tool-hint">Hold the phone flat. If the heading drifts, a
              slow figure of eight in the air settles the sensor.</p>
          {{else}}
            <p class="tool-hint">Start asks for the motion sensors and your
              location; neither leaves your device.</p>
          {{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Where you are</h3>
          {{#if this.coords}}
            <div class="compass-facts">
              <div class="math-result">
                <span class="qr-label is-muted">Altitude</span>
                <span class="math-big">{{if
                    this.coords.altitude
                    this.coords.altitude
                    "-"
                  }}</span>
                {{#unless this.coords.altitude}}
                  <span class="tool-hint">Only a GPS fix gives an altitude; a
                    desktop or a Wi-Fi location has none.</span>
                {{/unless}}
              </div>
              <dl class="compass-dl">
                <dt>Latitude</dt>
                <dd>{{this.coords.lat}}</dd>
                <dt>Longitude</dt>
                <dd>{{this.coords.lon}}</dd>
                <dt>Accuracy</dt>
                <dd>± {{this.coords.accuracy}} m</dd>
                {{#if this.coords.speed}}
                  <dt>Speed</dt>
                  <dd>{{this.coords.speed}}</dd>
                {{/if}}
              </dl>
              <div class="settings-actions">
                <CopyButton
                  @value={{this.coords.pair}}
                  @label="Copy coordinates"
                />
              </div>
            </div>
          {{else if this.positionError}}
            <p class="tool-error">{{this.positionError}}</p>
          {{else if this.running}}
            <p class="tool-hint">Waiting for a position…</p>
          {{else}}
            <p class="tool-hint">Press Start to read your position, altitude and
              heading.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
