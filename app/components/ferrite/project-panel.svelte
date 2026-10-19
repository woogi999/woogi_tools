<script module>
  import { truthy } from '../../core/helpers.js';
  import Icon from '../icon.svelte';

  // The Project panel, ported from `ferrite-app/src/ui/panels.rs`.
  //
  // The scenes in this production, in one flat list with each animation directly
  // after the scene it belongs to, so reading straight down it is already the
  // right order. All this adds is the indent and a different glyph; the
  // ordering is maintained where the list is edited rather than sorted back into
  // shape on every frame.
</script>

<script>
  let args = $props();
</script>

<div class="fr-panel-body">
  <div class="fr-head"><Icon name="layers" size={11} /> SCENES</div>
  <div class="fr-scroll">
    {#each args.editor?.sceneRows ?? [] as row (row?.id)}
      <div class="fr-scene {truthy(row?.selected) ? 'is-selected' : ''}">
        <button
          type="button"
          class="fr-scene-name"
          style={row?.indent}
          onclick={(..._r) => args.editor?.selectScene(row?.id, ..._r)}
        >
          <Icon name={truthy(row?.animation) ? 'spline' : 'frame'} size={11} />
          <span>{row?.name}</span>
          <i class="fr-faint">{row?.duration}</i>
        </button>
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Scene properties"
          onclick={(..._r) => args.editor?.openSceneDialog(row?.id, ..._r)}
          ><Icon name="settings" size={11} /></button
        >
        <button
          type="button"
          class="fr-icon-btn"
          aria-label="Delete scene"
          onclick={(..._r) => args.editor?.deleteScene(row?.id, ..._r)}
          ><Icon name="trash-2" size={11} /></button
        >
      </div>
    {/each}
    <div class="fr-scene-actions">
      <button type="button" class="fr-btn" onclick={args.editor?.addScene}>
        <Icon name="plus" size={11} />
        New scene</button
      >
      <button
        type="button"
        class="fr-btn"
        onclick={args.editor?.addSceneAnimation}
        ><Icon name="spline" size={11} /> New animation</button
      >
    </div>
  </div>
</div>
