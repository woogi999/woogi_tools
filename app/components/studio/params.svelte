<script module>
  import { truthy, prop } from '../../core/helpers.js';
  import StNum from './num.svelte';

  // Draws a list of parameter specs ({ key, label, type, min, max, step,
  // options }) against a values object. @onChange(key, value, final).
  // @objects lists [id, name] pairs for 'object' parameters (boolean cutters).

  const val = (o, k) => o?.[k];
  const eq = (a, b) => String(a) === String(b);
  const isType = (p, t) => p.type === t;

  function pickBool(onChange, key, e) {
    onChange(key, e.target.checked, true);
  }

  function pickSelect(onChange, key, options, e) {
    const raw = e.target.value;
    const opt = options.find((o) => String(o.value) === raw);
    onChange(key, opt ? opt.value : raw, true);
  }

  function pickObject(onChange, key, e) {
    onChange(key, e.target.value || null, true);
  }

  function numChange(onChange, key, value, final) {
    onChange(key, value, final);
  }
</script>

<script>
  let args = $props();
</script>

<div class="st-params">
  {#each args.params ?? [] as p}
    {#if truthy(isType(p, 'bool'))}
      <label class="st-check">
        <input
          type="checkbox"
          {@attach prop('checked', () => val(args.values, p?.key))}
          onchange={(..._r) => pickBool(args.onChange, p?.key, ..._r)}
        />
        <span>{p?.label}</span>
      </label>
    {:else if truthy(isType(p, 'select'))}
      <label class="st-field">
        <span>{p?.label}</span>
        <select
          onchange={(..._r) =>
            pickSelect(args.onChange, p?.key, p?.options, ..._r)}
        >
          {#each p?.options ?? [] as o}
            <option
              value={o?.value}
              {@attach prop('selected', () =>
                eq(o?.value, val(args.values, p?.key)),
              )}>{o?.label}</option
            >
          {/each}
        </select>
      </label>
    {:else if truthy(isType(p, 'object'))}
      <label class="st-field">
        <span>{p?.label}</span>
        <select onchange={(..._r) => pickObject(args.onChange, p?.key, ..._r)}>
          <option value="">None</option>
          {#each args.objects ?? [] as o}
            <option
              value={val(o, 0)}
              {@attach prop('selected', () =>
                eq(val(o, 0), val(args.values, p?.key)),
              )}>{val(o, 1)}</option
            >
          {/each}
        </select>
      </label>
    {:else}
      <StNum
        label={p?.label}
        value={val(args.values, p?.key)}
        min={p?.min}
        max={p?.max}
        step={p?.step}
        int={isType(p, 'int')}
        onChange={(..._r) => numChange(args.onChange, p?.key, ..._r)}
      />
    {/if}
  {/each}
</div>
