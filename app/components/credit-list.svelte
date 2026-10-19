<script module>
  import { truthy } from '../core/helpers.js';
</script>

<script>
  let args = $props();
</script>

<ul class="credit-list">
  {#each args.credits ?? [] as credit}
    <li>
      <a href={credit?.url} target="_blank" rel="noopener noreferrer"
        >{credit?.name}</a
      >
      {#if truthy(credit?.author)}<span class="credit-meta">
          by
          {credit?.author}</span
        >{/if}
      {#if truthy(credit?.license)}<span class="credit-meta">
          ·
          {credit?.license}</span
        >{/if}
    </li>
  {/each}
</ul>
