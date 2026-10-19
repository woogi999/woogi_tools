<script module>
  import { truthy } from '../core/helpers.js';
  import Icon from './icon.svelte';

  // One file in a list of downloads: its name, what it is, and how the save is
  // going. @row is { key, icon, label, meta } joined with DownloadJobs.view().
</script>

<script>
  let args = $props();
</script>

<li class="vd-format {truthy(args.row?.failed) ? 'is-failed' : ''}">
  <Icon name={args.row?.icon} size={16} />
  <div class="vd-format-info">
    <span class="vd-format-label">{args.row?.label}</span>
    {#if truthy(args.row?.meta)}
      <span class="vd-format-meta">{args.row?.meta}</span>
    {/if}
    {#if truthy(args.row?.going)}
      {#if truthy(args.row?.hasTotal)}
        <progress
          class="tool-progress"
          value={args.row?.fraction}
          max="1"
          aria-label="Download progress"
        ></progress>
      {:else}
        <progress class="tool-progress" aria-label="Working, length unknown"
        ></progress>
      {/if}
    {/if}
    {#if truthy(args.row?.status)}
      <span class="vd-format-status" aria-live="polite">{args.row?.status}</span
      >
    {/if}
    {#if truthy(args.row?.error)}
      <span class="tool-error" role="alert">{args.row?.error}</span>
    {/if}
  </div>
  {#if truthy(args.row?.going)}
    <button
      type="button"
      class="btn"
      onclick={(..._r) => args.onCancel(args.row, ..._r)}
    >
      <Icon name="x" size={13} />
      Cancel
    </button>
  {:else}
    <button
      type="button"
      class="btn active"
      disabled={args.disabled}
      onclick={(..._r) => args.onSave(args.row, ..._r)}
    >
      <Icon name="download" size={13} />
      {truthy(args.row?.done) ? 'Save again' : 'Save'}
    </button>
  {/if}
</li>
