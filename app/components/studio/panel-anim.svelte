<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';

  // The Animate workspace's panel: clips, keying, key interpolation, onion
  // skinning, retargeting and quick poses.

  const eq = (a, b) => a === b;
  const not = (x) => !x;

  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const INTERP = [
    { value: 'bezier', label: 'Bézier' },
    { value: 'linear', label: 'Linear' },
    { value: 'constant', label: 'Constant' },
  ];
  const EASES = [
    { value: 'auto', label: 'Auto' },
    { value: 'ease-in', label: 'Ease in' },
    { value: 'ease-out', label: 'Ease out' },
    { value: 'ease', label: 'Ease in & out' },
  ];

  class StudioAnimPanel extends Component {
    speeds = SPEEDS;
    interps = INTERP;
    eases = EASES;

    get s() {
      return this.args.s;
    }

    get c() {
      return this.s.clip;
    }

    clipNum = (key, v, final) => this.s.setClip(key, v, final);
    clipLoop = (e) => this.s.setClip('loop', e.target.checked, true);
    speed = (e) => this.s.setSpeed(e.target.value);
    onion = (key, v) => this.s.setOnion(key, v);
    stop = (e) => e.stopPropagation();
    key = (props) => this.s.insertKeys(props);
  }

  function array(...xs) {
    return xs;
  }
</script>

<script>
  let args = $props();
  const self = new StudioAnimPanel(args);
  onDestroy(() => destroy(self));
</script>

<section class="st-section st-clips">
  <h3 class="st-h"><Icon name="clapperboard" size={13} />Clips</h3>
  <ul class="st-clip-list">
    {#each args.s?.clips ?? [] as c (c?.id)}
      <li>
        <button
          type="button"
          class="st-clip {truthy(eq(c?.id, args.s?.doc?.activeClip))
            ? 'active'
            : ''}"
          onclick={(..._r) => args.s?.setActiveClip(c?.id, ..._r)}
        >
          <Icon name="film" size={11} />{c?.name}<span class="st-layer-meta"
            >{c?.start}–{c?.end}</span
          >
        </button>
      </li>
    {/each}
  </ul>
  <div class="st-btns">
    <button
      type="button"
      class="st-btn st-new-clip"
      onclick={(..._r) => args.s?.addClip(undefined, ..._r)}
      ><Icon name="plus" size={13} />New</button
    >
    <button
      type="button"
      class="st-btn"
      disabled={not(self.c)}
      onclick={args.s?.duplicateClip}
      ><Icon name="copy" size={13} />Duplicate</button
    >
    <button
      type="button"
      class="st-btn st-danger"
      disabled={not(self.c)}
      onclick={(..._r) => args.s?.deleteClip(undefined, ..._r)}
      ><Icon name="trash-2" size={13} />Delete</button
    >
  </div>
  {#if truthy(self.c)}
    <input
      type="text"
      class="st-inline-name"
      {@attach prop('value', () => self.c?.name)}
      aria-label="Clip name"
      {@attach on('keydown', self.stop)}
      onchange={args.s?.renameClip}
    />
    <div class="st-row-fields">
      <StNum
        label="Start"
        value={self.c?.start}
        step={1}
        int={true}
        onChange={(..._r) => self.clipNum('start', ..._r)}
      />
      <StNum
        label="End"
        value={self.c?.end}
        step={1}
        int={true}
        onChange={(..._r) => self.clipNum('end', ..._r)}
      />
    </div>
    <div class="st-row-fields">
      <StNum
        label="FPS"
        value={args.s?.doc?.fps}
        min={1}
        max={240}
        step={1}
        int={true}
        onChange={args.s?.setFps}
      />
      <StNum
        label="Clip speed"
        value={self.c?.speed}
        min={0.05}
        max={10}
        step={0.05}
        onChange={(..._r) => self.clipNum('speed', ..._r)}
      />
    </div>
    <label class="st-check"
      ><input
        type="checkbox"
        {@attach prop('checked', () => self.c?.loop)}
        onchange={self.clipLoop}
      /><span>Loop</span></label
    >
    <label class="st-field"
      ><span>Preview speed</span>
      <select onchange={self.speed}>
        {#each self.speeds ?? [] as sp}<option
            value={sp}
            {@attach prop('selected', () => eq(sp, args.s?.anim?.speed))}
            >{sp}×</option
          >{/each}
      </select>
    </label>
  {/if}
</section>

<section class="st-section">
  <h3 class="st-h"><Icon name="diamond" size={13} />Keys</h3>
  <label class="st-check"
    ><input
      type="checkbox"
      {@attach prop('checked', () => args.s?.autoKey)}
      onchange={args.s?.toggleAutoKey}
    /><span>Auto key (moving something keys it)</span></label
  >
  <div class="st-btns">
    <button
      type="button"
      class="st-btn st-key-all"
      onclick={(..._r) => self.key(undefined, ..._r)}
      ><Icon name="diamond" size={13} />Key all (I)</button
    >
    <button
      type="button"
      class="st-btn"
      onclick={(..._r) => self.key(array('pos'), ..._r)}>Location</button
    >
    <button
      type="button"
      class="st-btn"
      onclick={(..._r) => self.key(array('rot'), ..._r)}>Rotation</button
    >
    <button
      type="button"
      class="st-btn"
      onclick={(..._r) => self.key(array('scl'), ..._r)}>Scale</button
    >
    {#if truthy(args.s?.obj)}
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.keyVisibility(args.s?.active, ..._r)}
        ><Icon name="eye" size={13} />Visibility</button
      >
    {/if}
  </div>
  <p class="st-note"
    >Materials keyframe from the Material tab; IK/FK from a bone's constraint.</p
  >
  {#if truthy(args.s?.anim?.keySel?.size)}
    <h4 class="st-h4">{args.s?.anim?.keySel?.size} key(s) selected</h4>
    <div class="st-chips" role="group" aria-label="Interpolation">
      {#each self.interps ?? [] as i}<button
          type="button"
          class="st-chip"
          onclick={(..._r) => args.s?.setKeyInterp(i?.value, ..._r)}
          >{i?.label}</button
        >{/each}
    </div>
    <div class="st-chips" role="group" aria-label="Easing">
      {#each self.eases ?? [] as e}<button
          type="button"
          class="st-chip"
          onclick={(..._r) => args.s?.setKeyEase(e?.value, ..._r)}
          >{e?.label}</button
        >{/each}
    </div>
    <div class="st-btns">
      <button type="button" class="st-btn" onclick={args.s?.copyKeys}
        ><Icon name="copy" size={13} />Copy</button
      >
      <button type="button" class="st-btn" onclick={args.s?.pasteKeys}
        ><Icon name="clipboard-paste" size={13} />Paste at playhead</button
      >
      <button
        type="button"
        class="st-btn st-danger"
        onclick={args.s?.deleteKeys}
        ><Icon name="trash-2" size={13} />Delete</button
      >
    </div>
  {/if}
</section>

<section class="st-section">
  <h3 class="st-h"><Icon name="ghost" size={13} />Onion skin</h3>
  <label class="st-check"
    ><input
      type="checkbox"
      {@attach prop('checked', () => args.s?.anim?.onion?.on)}
      onchange={args.s?.toggleOnion}
    /><span>Show poses before and after</span></label
  >
  {#if truthy(args.s?.anim?.onion?.on)}
    <div class="st-row-fields">
      <StNum
        label="Before"
        value={args.s?.anim?.onion?.before}
        min={0}
        max={6}
        step={1}
        int={true}
        onChange={(..._r) => self.onion('before', ..._r)}
      />
      <StNum
        label="After"
        value={args.s?.anim?.onion?.after}
        min={0}
        max={6}
        step={1}
        int={true}
        onChange={(..._r) => self.onion('after', ..._r)}
      />
    </div>
    <StNum
      label="Every (frames)"
      value={args.s?.anim?.onion?.step}
      min={1}
      max={30}
      step={1}
      int={true}
      onChange={(..._r) => self.onion('step', ..._r)}
    />
  {/if}
</section>

<section class="st-section">
  <h3 class="st-h"><Icon name="person-standing" size={13} />Poses</h3>
  <div class="st-btns">
    <button type="button" class="st-btn" onclick={args.s?.copyPose}
      ><Icon name="copy" size={13} />Copy pose</button
    >
    <button
      type="button"
      class="st-btn"
      onclick={(..._r) => args.s?.pastePose(false, ..._r)}
      ><Icon name="clipboard-paste" size={13} />Paste</button
    >
    <button
      type="button"
      class="st-btn"
      onclick={(..._r) => args.s?.pastePose(true, ..._r)}
      ><Icon name="flip-horizontal-2" size={13} />Paste mirrored</button
    >
    <button type="button" class="st-btn" onclick={args.s?.savePose}
      ><Icon name="plus" size={13} />Save to library</button
    >
  </div>
  <ul class="st-poses">
    {#each args.s?.poseLibrary ?? [] as p (p?.id)}
      <li class="st-pose">
        {#if truthy(p?.thumb)}<img src={p?.thumb} alt="" />{/if}
        <span class="st-layer-name">{p?.name}</span>
        <button
          type="button"
          class="st-mini"
          title="Apply"
          aria-label="Apply {p?.name}"
          onclick={(..._r) => args.s?.applyLibraryPose(p?.id, false, ..._r)}
          ><Icon name="check" size={11} /></button
        >
        <button
          type="button"
          class="st-mini"
          title="Apply mirrored"
          aria-label="Apply {p?.name} mirrored"
          onclick={(..._r) => args.s?.applyLibraryPose(p?.id, true, ..._r)}
          ><Icon name="flip-horizontal-2" size={11} /></button
        >
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="st-btn st-wide st-retarget"
    onclick={args.s?.openRetarget}
    ><Icon name="arrow-right-left" size={13} />Retarget to another rig…</button
  >
</section>
