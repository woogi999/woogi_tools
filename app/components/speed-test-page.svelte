<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';

  // How fast the line is: ping, jitter, download and upload, measured against
  // Cloudflare's speed endpoints (the same ones speed.cloudflare.com uses),
  // which sit in a data centre near you. A gauge shows it as it happens.

  const ENDPOINT = 'https://speed.cloudflare.com';
  const PING_ROUNDS = 12;
  const DOWNLOAD_SIZES = [1e6, 5e6, 10e6, 25e6, 50e6];
  const UPLOAD_SIZES = [0.5e6, 2e6, 5e6, 10e6];
  const TEST_SECONDS = 8;
  const mbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;
  const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '-');

  class SpeedTestPage extends Component {
    get pipBusy() {
      return this.running;
    }

    get pipWarning() {
      return 'Close the Speed Test? The test in progress will stop.';
    }
    running = $state.raw(false);
    phase = $state.raw(''); // 'ping' | 'download' | 'upload' | 'done'
    ping = $state.raw(null);
    jitter = $state.raw(null);
    download = $state.raw(null);
    upload = $state.raw(null);
    live = $state.raw(0);
    error = $state.raw(null);
    history = $state.raw([]);
    where = $state.raw(null);
    pings = $state.raw([]);

    abort = null;
    canvas = null;

    constructor(args) {
      super(args);
      keepState(this, 'speed-test', ['history']);
      registerDestructor(this, () => this.abort?.abort());
    }

    get gaugeMax() {
      // The dial rescales to what's being measured so a slow line still moves it.
      const v = this.live;
      if (v < 10) return 10;
      if (v < 50) return 50;
      if (v < 100) return 100;
      if (v < 250) return 250;
      if (v < 500) return 500;
      return 1000;
    }

    get gaugeStyle() {
      const share = Math.min(1, this.live / this.gaugeMax);
      return `--share:${share}`;
    }

    get phaseLabel() {
      return (
        { ping: 'Ping', download: 'Download', upload: 'Upload', done: 'Done' }[
          this.phase
        ] ?? ''
      );
    }

    get liveLabel() {
      return this.phase === 'ping'
        ? `${fmt(this.live, 0)} ms`
        : `${fmt(this.live)} Mbps`;
    }

    get rows() {
      return this.history.map((h) => ({
        ...h,
        when: new Date(h.at).toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: 'short',
        }),
      }));
    }

    get verdict() {
      if (this.download === null) return '';
      const d = this.download;
      if (d >= 100)
        return 'Plenty for 4K streaming, big downloads and a houseful of devices.';
      if (d >= 25)
        return 'Comfortable for HD streaming, video calls and gaming.';
      if (d >= 10)
        return 'Fine for browsing and HD video on one or two screens.';
      if (d >= 3)
        return 'Enough for calls and standard-definition video; downloads will crawl.';
      return 'Slow going: expect buffering and long waits.';
    }

    bindSparkline = modifier((canvas, [pings]) => {
      const ctx = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      ctx.scale(ratio, ratio);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (pings.length < 2) return;
      const max = Math.max(...pings) * 1.2 || 1;
      ctx.beginPath();
      pings.forEach((p, i) => {
        const x = (i / (pings.length - 1)) * w;
        const y = h - (p / max) * h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle =
        getComputedStyle(canvas).getPropertyValue('--accent').trim() ||
        '#4ea8de';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    async measurePing(signal) {
      const times = [];
      for (let i = 0; i < PING_ROUNDS; i++) {
        const started = performance.now();
        await fetch(`${ENDPOINT}/__down?bytes=0&r=${Math.random()}`, {
          cache: 'no-store',
          signal,
        });
        const t = performance.now() - started;
        // The first request pays for the connection; it's not the latency.
        if (i > 0) times.push(t);
        this.pings = [...times];
        this.live = times.length ? Math.min(...times) : t;
      }
      times.sort((a, b) => a - b);
      // The median is steadier than the mean on a noisy Wi-Fi link.
      const ping = times[Math.floor(times.length / 2)];
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const jitter = Math.sqrt(
        times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length,
      );
      return { ping, jitter };
    }

    // Bigger and bigger downloads until the time is up; the speed is the total
    // moved over the total time, which smooths the ramp-up.
    async measureDownload(signal) {
      const started = performance.now();
      let bytes = 0;
      let round = 0;
      while (performance.now() - started < TEST_SECONDS * 1000) {
        const size =
          DOWNLOAD_SIZES[Math.min(round++, DOWNLOAD_SIZES.length - 1)];
        const response = await fetch(
          `${ENDPOINT}/__down?bytes=${size}&r=${Math.random()}`,
          { cache: 'no-store', signal },
        );
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          this.live = mbps(bytes, performance.now() - started);
        }
      }
      return mbps(bytes, performance.now() - started);
    }

    async measureUpload(signal) {
      const started = performance.now();
      let bytes = 0;
      let round = 0;
      while (performance.now() - started < TEST_SECONDS * 1000) {
        const size = UPLOAD_SIZES[Math.min(round++, UPLOAD_SIZES.length - 1)];
        const body = new Uint8Array(size);
        await fetch(`${ENDPOINT}/__up?r=${Math.random()}`, {
          method: 'POST',
          body,
          signal,
          cache: 'no-store',
        });
        bytes += size;
        this.live = mbps(bytes, performance.now() - started);
      }
      return mbps(bytes, performance.now() - started);
    }

    async whereAmI(signal) {
      try {
        const text = await fetch(`${ENDPOINT}/cdn-cgi/trace`, { signal }).then(
          (r) => r.text(),
        );
        const info = Object.fromEntries(
          text
            .trim()
            .split('\n')
            .map((line) => line.split('=')),
        );
        this.where = { ip: info.ip, colo: info.colo, loc: info.loc };
      } catch {
        this.where = null;
      }
    }

    start = async () => {
      if (this.running) return;
      this.running = true;
      this.error = null;
      this.ping = this.jitter = this.download = this.upload = null;
      this.pings = [];
      this.abort = new AbortController();
      const { signal } = this.abort;
      try {
        this.whereAmI(signal);
        this.phase = 'ping';
        this.live = 0;
        const { ping, jitter } = await this.measurePing(signal);
        this.ping = ping;
        this.jitter = jitter;
        this.phase = 'download';
        this.live = 0;
        this.download = await this.measureDownload(signal);
        this.phase = 'upload';
        this.live = 0;
        this.upload = await this.measureUpload(signal);
        this.phase = 'done';
        this.live = this.download;
        this.history = [
          {
            at: Date.now(),
            ping,
            jitter,
            download: this.download,
            upload: this.upload,
          },
          ...this.history,
        ].slice(0, 10);
      } catch (error) {
        if (error?.name !== 'AbortError')
          this.error =
            'The test couldn’t reach the speed server. Are you online?';
        this.phase = '';
      } finally {
        this.running = false;
      }
    };

    stop = () => this.abort?.abort();
    clearHistory = () => (this.history = []);
  }
</script>

<script>
  let args = $props();
  const self = new SpeedTestPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="speed-test"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Ping, jitter, download and upload, measured against a Cloudflare server near you. Press the button and watch the dial."
>
  <div class="math-grid pop-in">
    <section class="math-card st-stage">
      <div
        class="st-gauge"
        style={self.gaugeStyle}
        role="img"
        aria-label={self.liveLabel}
      >
        <div class="st-gauge-arc"></div>
        <div class="st-gauge-needle"></div>
        <div class="st-gauge-face">
          <span class="st-gauge-value">{self.liveLabel}</span>
          <span class="st-gauge-phase"
            >{truthy(self.running)
              ? self.phaseLabel
              : truthy(self.phase)
                ? 'Done'
                : 'Ready'}</span
          >
        </div>
        <span class="st-gauge-min">0</span>
        <span class="st-gauge-max">{self.gaugeMax}</span>
      </div>
      {#if truthy(self.running)}
        <button
          type="button"
          class="btn dice-roll-btn st-go"
          onclick={self.stop}>Stop</button
        >
      {:else}
        <button
          type="button"
          class="btn active dice-roll-btn st-go"
          onclick={self.start}
          ><Icon name="gauge" size={14} />
          {truthy(self.phase) ? 'Test again' : 'Go'}</button
        >
      {/if}
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
      <p class="tool-hint"
        >Close other downloads and video for a true reading. Wi-Fi usually
        measures well under what the line can do; plug in for the real number.</p
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Results</h3>
      <div class="st-results">
        <div class="st-result"
          ><span class="qr-label is-muted">Ping</span><strong
            >{fmt(self.ping, 0)}
            <small>ms</small></strong
          ></div
        >
        <div class="st-result"
          ><span class="qr-label is-muted">Jitter</span><strong
            >{fmt(self.jitter, 1)}
            <small>ms</small></strong
          ></div
        >
        <div class="st-result"
          ><span class="qr-label is-muted">Download</span><strong
            >{fmt(self.download)}
            <small>Mbps</small></strong
          ></div
        >
        <div class="st-result"
          ><span class="qr-label is-muted">Upload</span><strong
            >{fmt(self.upload)}
            <small>Mbps</small></strong
          ></div
        >
      </div>
      {#if truthy(self.verdict)}<p class="tool-hint">{self.verdict}</p>{/if}
      {#if truthy(self.pings?.length)}
        <span class="qr-label is-muted">Ping, round by round</span>
        <canvas class="st-spark" {@attach self.bindSparkline?.([self.pings])}
        ></canvas>
      {/if}
      {#if truthy(self.where)}
        <p class="tool-hint"
          >Tested from
          {self.where?.ip}
          ({self.where?.loc}) to Cloudflare's
          {self.where?.colo}
          data centre.</p
        >
      {/if}
      {#if truthy(self.rows?.length)}
        <div class="field-head">
          <span class="qr-label is-muted">Earlier tests</span>
          <button type="button" class="btn" onclick={self.clearHistory}
            >Clear</button
          >
        </div>
        <table class="st-table">
          <thead
            ><tr><th>When</th><th>Ping</th><th>Down</th><th>Up</th></tr></thead
          >
          <tbody>
            {#each self.rows ?? [] as r}
              <tr
                ><td>{r?.when}</td><td>{fmt(r?.ping, 0)} ms</td><td
                  >{fmt(r?.download)}</td
                ><td>{fmt(r?.upload)}</td></tr
              >
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  </div>
</ToolPage>
