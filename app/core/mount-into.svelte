<script module>
  import RenderSnippet from './render-snippet.svelte';
</script>

<script>
  import { mount, unmount, untrack } from 'svelte';

  // Mounts `component` (or renders `snippet`) into `target`, an element that
  // lives outside this component's own markup, and takes it out again when
  // this goes away. The PiP layer uses it to keep a tool alive in an element
  // it then moves around the page, and popovers use it to escape a clipped box.
  let { component, snippet, target } = $props();

  $effect(() => {
    if (!target) return;
    const Mounted = component ?? RenderSnippet;
    const props = snippet ? { snippet } : {};
    // Whatever the mounted component reads while it starts up belongs to it,
    // not to this effect: it must not mount it again when that changes.
    const instance = untrack(() => mount(Mounted, { target, props }));
    return () => unmount(instance);
  });
</script>
