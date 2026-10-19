<script>
  import Icon from './icon.svelte';

  // A guest's Ready toggle; also shown at the end of a game, to agree to a rematch.
  let { room, label, readyLabel, class: className } = $props();

  const ready = $derived(room.iAmReady);
  const toggle = () => room.setReady(!ready);
</script>

<button
  type="button"
  class="btn lobby-ready-btn {ready ? 'is-ready' : 'active'} {className ?? ''}"
  aria-pressed={ready ? 'true' : 'false'}
  onclick={toggle}
>
  <Icon name={ready ? 'circle-check-big' : 'check'} size={14} />
  {ready ? readyLabel || 'Ready!' : label || 'Ready'}
</button>
