<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';

  const pad = (n) => String(n).padStart(2, '0');
  const PRESETS = [
    { label: '1 min', s: 60 },
    { label: '3 min', s: 180 },
    { label: '5 min', s: 300 },
    { label: '10 min', s: 600 },
    { label: '15 min', s: 900 },
    { label: '25 min', s: 1500 },
    { label: '1 hour', s: 3600 },
  ];
  const clock = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // A two-tone chime, repeated until it's dismissed.
  function ring() {
    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    let stopped = false;
    const beep = (at, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.35, at + 0.02);
      gain.gain.setValueAtTime(0.35, at + 0.18);
      gain.gain.linearRampToValueAtTime(0, at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    };
    const cycle = () => {
      if (stopped) return;
      const at = ctx.currentTime + 0.05;
      beep(at, 880);
      beep(at + 0.3, 1175);
      beep(at + 0.6, 880);
      beep(at + 0.9, 1175);
      setTimeout(cycle, 1800);
    };
    cycle();
    return () => {
      stopped = true;
      ctx.close();
    };
  }

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted')
      return;
    try {
      new Notification(title, { body, silent: true });
    } catch {
      // some browsers only allow this from a service worker
    }
  }

  let nextId = 1;

  class TimerAlarmPage extends Component {
    presets = PRESETS;

    // Timer
    hours = $state.raw(0);
    minutes = $state.raw(5);
    seconds = $state.raw(0);
    endsAt = $state.raw(null); // ms timestamp while running
    pausedLeft = $state.raw(null); // ms left while paused
    left = $state.raw(0);
    timerDone = $state.raw(false);

    // Alarms: { id, time: 'HH:MM', label, on, lastFired }
    alarms = $state.raw([]);
    newTime = $state.raw('07:30');
    newLabel = $state.raw('');
    ringing = $state.raw(null); // { title, body }

    interval = null;
    stopRing = null;

    constructor(args) {
      super(args);
      keepState(this, 'timer-alarm', [
        'hours',
        'minutes',
        'seconds',
        'endsAt',
        'pausedLeft',
        'alarms',
        'newTime',
      ]);
      this.interval = setInterval(this.tick, 250);
      registerDestructor(this, () => {
        clearInterval(this.interval);
        this.stopRing?.();
      });
    }

    get running() {
      return this.endsAt !== null;
    }

    get paused() {
      return this.pausedLeft !== null;
    }

    get display() {
      if (this.running) return clock(this.left);
      if (this.paused) return clock(this.pausedLeft);
      return clock(this.setMs);
    }

    get setMs() {
      return (this.hours * 3600 + this.minutes * 60 + this.seconds) * 1000;
    }

    // An alarm that's switched on keeps the tool alive when you leave the page
    // (it floats into a small window), so it can still go off.
    get busy() {
      return (
        this.running || Boolean(this.ringing) || this.alarms.some((a) => a.on)
      );
    }

    get sortedAlarms() {
      return [...this.alarms].sort((a, b) => a.time.localeCompare(b.time));
    }

    get nextAlarm() {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const on = this.sortedAlarms.filter((a) => a.on);
      if (!on.length) return null;
      const toMin = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      const later = on.find((a) => toMin(a.time) > nowMin) ?? on[0];
      let diff = toMin(later.time) - nowMin;
      if (diff <= 0) diff += 24 * 60;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return `${later.label || later.time} in ${h ? `${h} h ` : ''}${m} min`;
    }

    tick = () => {
      const now = Date.now();
      if (this.running) {
        this.left = this.endsAt - now;
        if (this.left <= 0) {
          this.endsAt = null;
          this.left = 0;
          this.timerDone = true;
          this.alert('Time is up', 'The timer has finished.');
        }
      }
      const d = new Date(now);
      const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const dayKey = `${d.toDateString()} ${stamp}`;
      for (const alarm of this.alarms) {
        if (!alarm.on || alarm.time !== stamp || alarm.lastFired === dayKey)
          continue;
        this.alarms = this.alarms.map((a) =>
          a.id === alarm.id ? { ...a, lastFired: dayKey } : a,
        );
        this.alert(alarm.label || 'Alarm', `It is ${alarm.time}.`);
      }
    };

    alert(title, body) {
      this.stopRing?.();
      this.stopRing = ring();
      this.ringing = { title, body };
      notify(title, body);
    }

    dismiss = () => {
      this.stopRing?.();
      this.stopRing = null;
      this.ringing = null;
      this.timerDone = false;
    };

    askNotifications = () => {
      if ('Notification' in window && Notification.permission === 'default')
        Notification.requestPermission();
    };

    // Timer controls
    setPart = (part, event) => {
      const max = part === 'hours' ? 99 : 59;
      this[part] = Math.max(
        0,
        Math.min(max, Math.floor(+event.target.value) || 0),
      );
    };

    usePreset = (s) => {
      this.hours = Math.floor(s / 3600);
      this.minutes = Math.floor((s % 3600) / 60);
      this.seconds = s % 60;
      this.pausedLeft = null;
      this.endsAt = null;
    };

    startTimer = () => {
      const ms = this.paused ? this.pausedLeft : this.setMs;
      if (ms <= 0) return;
      this.askNotifications();
      this.pausedLeft = null;
      this.endsAt = Date.now() + ms;
      this.left = ms;
      this.timerDone = false;
    };

    pauseTimer = () => {
      if (!this.running) return;
      this.pausedLeft = Math.max(0, this.endsAt - Date.now());
      this.endsAt = null;
    };

    resetTimer = () => {
      this.endsAt = null;
      this.pausedLeft = null;
      this.timerDone = false;
    };

    // Alarm controls
    setNewTime = (event) => (this.newTime = event.target.value);
    setNewLabel = (event) => (this.newLabel = event.target.value);

    addAlarm = (event) => {
      event.preventDefault();
      if (!/^\d\d:\d\d$/.test(this.newTime)) return;
      this.askNotifications();
      this.alarms = [
        ...this.alarms,
        {
          id: `${Date.now()}-${nextId++}`,
          time: this.newTime,
          label: this.newLabel.trim(),
          on: true,
          lastFired: null,
        },
      ];
      this.newLabel = '';
    };

    toggleAlarm = (alarm) => {
      this.alarms = this.alarms.map((a) =>
        a.id === alarm.id ? { ...a, on: !a.on } : a,
      );
    };

    removeAlarm = (alarm) => {
      this.alarms = this.alarms.filter((a) => a.id !== alarm.id);
    };
  }
</script>

<script>
  let args = $props();
  const self = new TimerAlarmPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="timer-alarm"
  subtitle="A countdown timer and alarms that go off at a set time, with a chime and a notification. Both carry on while you use other tools."
  busy={self.busy}
  closeWarning="the running timer or alarm"
>
  {#if truthy(self.ringing)}
    <div class="ta-ringing pop-in" role="alert">
      <Icon name="bell-ring" size={28} />
      <div>
        <strong>{self.ringing?.title}</strong>
        <p>{self.ringing?.body}</p>
      </div>
      <button type="button" class="btn active" onclick={self.dismiss}
        >Dismiss</button
      >
    </div>
  {/if}
  <div class="math-grid pop-in">
    <section class="math-card ta-card">
      <h3 class="qr-heading">Timer</h3>
      <p
        class="ta-time
              {truthy(self.running) ? 'is-running' : ''}
              {truthy(self.timerDone) ? 'is-done' : ''}">{self.display}</p
      >
      {#if !truthy(self.running)}
        {#if !truthy(self.paused)}
          <div class="ta-parts">
            <label class="math-field"
              ><span class="qr-label is-muted">Hours</span><input
                type="number"
                min="0"
                max="99"
                class="math-input"
                {@attach prop('value', () => self.hours)}
                oninput={(..._r) => self.setPart('hours', ..._r)}
              /></label
            >
            <label class="math-field"
              ><span class="qr-label is-muted">Minutes</span><input
                type="number"
                min="0"
                max="59"
                class="math-input"
                {@attach prop('value', () => self.minutes)}
                oninput={(..._r) => self.setPart('minutes', ..._r)}
              /></label
            >
            <label class="math-field"
              ><span class="qr-label is-muted">Seconds</span><input
                type="number"
                min="0"
                max="59"
                class="math-input"
                {@attach prop('value', () => self.seconds)}
                oninput={(..._r) => self.setPart('seconds', ..._r)}
              /></label
            >
          </div>
          <div class="line-actions">
            {#each self.presets ?? [] as p}
              <button
                type="button"
                class="btn"
                onclick={(..._r) => self.usePreset(p?.s, ..._r)}
                >{p?.label}</button
              >
            {/each}
          </div>
        {/if}
      {/if}
      <div class="settings-actions">
        {#if truthy(self.running)}
          <button type="button" class="btn active" onclick={self.pauseTimer}>
            <Icon name="pause" size={14} />
            Pause</button
          >
        {:else}
          <button type="button" class="btn active" onclick={self.startTimer}>
            <Icon name="play" size={14} />
            {truthy(self.paused) ? 'Resume' : 'Start'}</button
          >
        {/if}
        <button type="button" class="btn" onclick={self.resetTimer}>
          <Icon name="rotate-ccw" size={14} />
          Reset</button
        >
      </div>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Alarms</h3>
      <form class="ta-add" onsubmit={self.addAlarm}>
        <input
          type="time"
          class="math-input"
          aria-label="Alarm time"
          {@attach prop('value', () => self.newTime)}
          required
          oninput={self.setNewTime}
        />
        <input
          type="text"
          class="math-input"
          placeholder="Label (optional)"
          aria-label="Alarm label"
          maxlength="40"
          {@attach prop('value', () => self.newLabel)}
          oninput={self.setNewLabel}
        />
        <button type="submit" class="btn active">
          <Icon name="plus" size={13} />
          Add</button
        >
      </form>
      {#if truthy(self.sortedAlarms?.length)}
        <ul class="ta-list">
          {#each self.sortedAlarms ?? [] as alarm (alarm?.id)}
            <li class="ta-alarm {!truthy(alarm?.on) ? 'is-off' : ''}">
              <button
                type="button"
                class="ta-toggle"
                role="switch"
                aria-checked={truthy(alarm?.on) ? 'true' : 'false'}
                aria-label="{alarm?.time} {alarm?.label}"
                onclick={(..._r) => self.toggleAlarm(alarm, ..._r)}
                ><span></span></button
              >
              <span class="ta-alarm-time">{alarm?.time}</span>
              <span class="ta-alarm-label">{alarm?.label}</span>
              <button
                type="button"
                class="fs-remove"
                aria-label="Delete alarm at {alarm?.time}"
                onclick={(..._r) => self.removeAlarm(alarm, ..._r)}
                ><Icon name="x" size={13} /></button
              >
            </li>
          {/each}
        </ul>
        {#if truthy(self.nextAlarm)}<p class="tool-hint"
            >Next:
            {self.nextAlarm}.</p
          >{/if}
      {:else}
        <p class="tool-hint"
          >No alarms yet. They only ring while this site is open in a tab (any
          page of it will do).</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
