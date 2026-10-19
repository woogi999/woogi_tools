<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import Link from '../../core/link.svelte';
  import { truthy, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import { PRESETS, whenSaved } from '../../utils/ferrite/projects.js';

  // The start screen, which is the one thing Ferrite has that a web editor needs
  // more than Ferrite does.
  //
  // Opening a native editor to an empty timeline is fine: the project you want
  // is a file on your disk and you know where it is. Opening a *web* editor to
  // an empty timeline is a question with no answer on screen: is my work still
  // here? where did it go? So this page answers it before anything else: here is
  // what is on this machine, here is how to make a new one, here is how to bring
  // one in from a file.
  //
  // Everything on it is one click. Nothing on it is a menu.
  const eq = (a, b) => a === b;

  class StartPage extends Component {
    presets = PRESETS;

    name = $state.raw('');
    preset = $state.raw('hd');
    seconds = $state.raw(10);
    confirming = $state.raw(null);

    get editor() {
      return this.args.editor;
    }

    get recents() {
      return this.editor.recents.map((p) => ({
        ...p,
        when: whenSaved(p.savedAt),
        size: `${p.width}×${p.height} · ${p.fps}fps`,
        length: `${Math.round((p.durationMs ?? 0) / 1000)}s`,
        count: `${p.layers} layer${p.layers === 1 ? '' : 's'}`,
      }));
    }

    get chosen() {
      return PRESETS.find((p) => p.id === this.preset) ?? PRESETS[0];
    }

    setName = (event) => (this.name = event.target.value);
    setPreset = (id) => (this.preset = id);
    setSeconds = (event) =>
      (this.seconds = Math.max(1, Number(event.target.value) || 1));

    create = (event) => {
      event.preventDefault();
      this.editor.startNew({
        name: this.name,
        preset: this.preset,
        durationMs: this.seconds * 1000,
      });
    };

    askForget = (id) => (this.confirming = id);
    cancelForget = () => (this.confirming = null);
    forget = (id) => {
      this.confirming = null;
      this.editor.forgetStored(id);
    };
  }
</script>

<script>
  let args = $props();
  const self = new StartPage(args);
  onDestroy(() => destroy(self));
</script>

<div class="fr-start">
  <header class="fr-start-top">
    <Link route="index" class="fr-brand" title="Back to Woogi Tools">
      <img src="/icon_expanded.png" alt="Woogi Tools" />
    </Link>
    <div class="fr-start-title">
      <h1>Video Editor</h1>
      <p>Layers, keyframes and 145 effects, in the browser.</p>
    </div>
    <span class="fr-spacer"></span>
    <button
      type="button"
      class="fr-icon-btn"
      title="Switch theme"
      aria-label="Switch theme"
      onclick={args.editor?.toggleTheme}
      ><Icon
        name={truthy(args.editor?.settings?.isDark) ? 'moon' : 'sun'}
        size={14}
      /></button
    >
  </header>

  <div class="fr-start-body">
    <form class="fr-start-new" onsubmit={self.create}>
      <h2><Icon name="plus" size={13} /> New project</h2>

      <label class="fr-field">
        <span>Name</span>
        <input
          type="text"
          class="fr-input"
          placeholder="Untitled"
          {@attach prop('value', () => self.name)}
          oninput={self.setName}
        />
      </label>

      <span class="fr-field-label">Composition</span>
      <div class="fr-preset-grid">
        {#each self.presets ?? [] as p (p?.id)}
          <button
            type="button"
            class="fr-preset {truthy(eq(self.preset, p?.id)) ? 'is-on' : ''}"
            data-preset={p?.id}
            onclick={(..._r) => self.setPreset(p?.id, ..._r)}
          >
            <b>{p?.label}</b>
          </button>
        {/each}
      </div>

      <label class="fr-field">
        <span>Length</span>
        <span class="fr-field-row">
          <input
            type="number"
            class="fr-input is-short"
            min="1"
            max="3600"
            {@attach prop('value', () => self.seconds)}
            oninput={self.setSeconds}
          />
          <i class="fr-faint">seconds</i>
        </span>
      </label>

      <button type="submit" class="fr-btn is-accent is-big" data-new-project
        >Create project</button
      >

      <div class="fr-start-or"><span>or</span></div>

      <button
        type="button"
        class="fr-btn is-big"
        onclick={args.editor?.openProject}
        ><Icon name="folder-plus" size={13} />
        Import a project file</button
      >
      <p class="fr-hint"
        >A
        <code>.woogi.json</code>
        holds the edit, not the footage. Any clips in it ask to be pointed at their
        files again.</p
      >
    </form>

    <section class="fr-start-recent">
      <h2><Icon name="clock" size={13} /> On this computer</h2>
      {#if truthy(self.recents?.length)}
        <ul class="fr-recent-list">
          {#each self.recents ?? [] as p (p?.id)}
            <li class="fr-recent">
              <button
                type="button"
                class="fr-recent-open"
                data-open={p?.id}
                onclick={(..._r) => args.editor?.openStored(p?.id, ..._r)}
              >
                <Icon name="film" size={15} />
                <span class="fr-recent-text">
                  <b>{p?.name}</b>
                  <i class="fr-faint"
                    >{p?.size}
                    ·
                    {p?.length}
                    ·
                    {p?.count}</i
                  >
                </span>
                <i class="fr-faint">{p?.when}</i>
              </button>
              {#if truthy(eq(self.confirming, p?.id))}
                <button
                  type="button"
                  class="fr-btn is-danger is-small"
                  onclick={(..._r) => self.forget(p?.id, ..._r)}>Remove</button
                >
                <button
                  type="button"
                  class="fr-btn is-small"
                  onclick={self.cancelForget}>Keep</button
                >
              {:else}
                <button
                  type="button"
                  class="fr-icon-btn"
                  title="Remove from this list"
                  aria-label="Remove {p?.name} from this list"
                  onclick={(..._r) => self.askForget(p?.id, ..._r)}
                  ><Icon name="trash-2" size={12} /></button
                >
              {/if}
            </li>
          {/each}
        </ul>
        <p class="fr-hint"
          >These live in this browser's storage. Clearing site data takes them
          with it, so keep anything you care about as a file:
          <b>File → Save to disk</b>.</p
        >
      {:else}
        <div class="fr-empty">
          <Icon name="film" size={28} />
          <p>Nothing saved here yet.</p>
          <p class="fr-hint"
            >Projects you save from inside the editor show up here, on this
            computer, in this browser.</p
          >
        </div>
      {/if}

      <h2 class="fr-start-h2"
        ><Icon name="keyboard" size={13} />
        Worth knowing</h2
      >
      <ul class="fr-start-tips">
        <li
          ><b>Space</b>
          plays,
          <b>J K L</b>
          shuttle,
          <b>,</b>
          and
          <b>.</b>
          step a frame.</li
        >
        <li>Drag footage straight onto the window to bring it in.</li>
        <li
          >The stopwatch beside a property starts animating it; drag a box on
          the stage to select.</li
        >
        <li><b>Ctrl+M</b> opens the render queue when you are done.</li>
      </ul>
    </section>
  </div>
</div>
