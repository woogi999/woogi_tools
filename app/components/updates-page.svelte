<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { CHANGELOG, APP_VERSION } from '../changelog.js';

  const TYPE_LABELS = {
    new: 'New',
    improved: 'Improved',
    fixed: 'Fixed',
    removed: 'Removed',
  };

  const formatDate = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      dateStyle: 'long',
    });

  class UpdatesPage extends Component {
    offline = service('offline');

    releases = CHANGELOG.map((release) => ({
      ...release,
      isCurrent: release.version === APP_VERSION,
      dateLabel: formatDate(release.date),
      changes: release.changes.map((c) => ({
        ...c,
        label: TYPE_LABELS[c.type] ?? c.type,
      })),
    }));
  }
</script>

<script>
  let args = $props();
  const self = new UpdatesPage(args);
  onDestroy(() => destroy(self));
</script>

<div class="container">
  <section class="hero pop-in">
    <div class="hero-icon"><Icon name="history" size={28} /></div>
    <div class="hero-text">
      <h1 class="hero-title"><span>Updates</span></h1>
      <p
        >What's changed on Woogi Tools. You're on version
        {APP_VERSION}{#if truthy(self.offline?.buildId)}
          (build
          <code>{self.offline?.buildId}</code>){/if}.</p
      >
    </div>
  </section>

  {#if truthy(self.offline?.updateReady)}
    <div class="updates-ready pop-in">
      <span>A newer version has downloaded. Reload to see what's new.</span>
      <button type="button" class="btn math-use" onclick={self.offline?.reload}
        ><Icon name="refresh-cw" size={13} /> Reload</button
      >
    </div>
  {/if}

  <ol class="updates pop-in">
    {#each self.releases ?? [] as release}
      <li class="updates-release">
        <header class="updates-header">
          <h2 class="updates-version">v{release?.version}</h2>
          {#if truthy(release?.isCurrent)}<span class="updates-badge"
              >Current</span
            >{/if}
          <time class="tool-hint" datetime={release?.date}
            >{release?.dateLabel}</time
          >
        </header>
        <h3 class="qr-heading">{release?.title}</h3>
        <ul class="updates-changes">
          {#each release?.changes ?? [] as change}
            <li class="updates-change">
              <span class="updates-type is-{change?.type}">{change?.label}</span
              >
              <span>{change?.text}</span>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ol>
</div>
