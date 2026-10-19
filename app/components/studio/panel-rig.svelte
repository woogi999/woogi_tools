<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';

  // The Rig workspace's panel: skeletons, bones and their constraints,
  // controllers, skin weights and poses.

  const eq = (a, b) => a === b;
  const not = (x) => !x;
  const at = (list, i) => list?.[i];
  const AXES = [0, 1, 2];
  const AXIS = ['x', 'y', 'z'];

  const CONSTRAINTS = [
    { value: 'ik', label: 'IK' },
    { value: 'copyRotation', label: 'Copy rotation' },
    { value: 'track', label: 'Track to' },
  ];

  class StudioRigPanel extends Component {
    axes = AXES;
    axisName = AXIS;
    constraintTypes = CONSTRAINTS;
    section = $state.raw('bones');

    get s() {
      return this.args.s;
    }

    get arm() {
      return this.s.armature;
    }

    get b() {
      return this.s.bone;
    }

    get parentChoices() {
      const arm = this.arm;
      const b = this.b;
      if (!arm || !b) return [];
      return arm.bones
        .filter((x) => x.id !== b.id)
        .map((x) => ({ value: x.id, label: x.name }));
    }

    get constraintRows() {
      return (this.b?.constraints ?? []).map((c, index) => ({
        c,
        index,
        label: CONSTRAINTS.find((x) => x.value === c.type)?.label ?? c.type,
      }));
    }

    get falloffs() {
      return ['smooth', 'linear', 'sharp', 'soft', 'constant'];
    }

    setSection = (s) => (this.section = s);
    boneName = (e) => this.s.setBone('name', e.target.value, true);
    boneParent = (e) => this.s.setBone('parent', e.target.value || null, true);
    boneVec = (key, axis, v, final) => this.s.setBoneVec(key, axis, v, final);
    boneRoll = (v, final) => this.s.setBone('roll', v, final);
    boneDeform = (e) => this.s.setBone('deform', e.target.checked, true);
    addConstraint = (e) => {
      if (e.target.value) this.s.addConstraint(e.target.value);
      e.target.value = '';
    };
    cTarget = (i, key, e) =>
      this.s.setConstraint(i, key, e.target.value || null, true);
    cNum = (i, key, v, final) => this.s.setConstraint(i, key, v, final);
    cOn = (i, e) => this.s.setConstraint(i, 'on', e.target.checked, true);
    w = (key, v) => this.s.setBrush('weight', key, v);
    wFalloff = (e) => this.s.setBrush('weight', 'falloff', e.target.value);
    wNormalize = (e) =>
      this.s.setBrush('weight', 'autoNormalize', e.target.checked);
    stop = (e) => e.stopPropagation();
  }
</script>

<script>
  let args = $props();
  const self = new StudioRigPanel(args);
  onDestroy(() => destroy(self));
</script>

<div class="st-subtabs" role="tablist">
  <button
    type="button"
    role="tab"
    class={truthy(eq(self.section, 'bones')) ? 'active' : ''}
    onclick={(..._r) => self.setSection('bones', ..._r)}>Bones</button
  >
  <button
    type="button"
    role="tab"
    class="st-weights-tab {truthy(eq(self.section, 'weights')) ? 'active' : ''}"
    onclick={(..._r) => self.setSection('weights', ..._r)}>Weights</button
  >
  <button
    type="button"
    role="tab"
    class="st-pose-tab {truthy(eq(self.section, 'pose')) ? 'active' : ''}"
    onclick={(..._r) => self.setSection('pose', ..._r)}>Pose</button
  >
</div>

{#if truthy(eq(self.section, 'bones'))}
  <section class="st-section">
    <h3 class="st-h"><Icon name="person-standing" size={13} />Rig templates</h3>
    <p class="st-note"
      >Select the mesh first: the rig is fitted to it and bound with automatic
      weights, with controllers for hands, feet, elbows, knees, head, spine and
      hips.</p
    >
    <div class="st-row-fields">
      <select aria-label="Template" onchange={args.s?.setTemplate}>
        {#each args.s?.templates ?? [] as t}<option
            value={t?.value}
            {@attach prop('selected', () =>
              eq(t?.value, args.s?.rig?.template),
            )}>{t?.label}</option
          >{/each}
      </select>
      <button
        type="button"
        class="st-btn st-generate-rig"
        onclick={(..._r) => args.s?.generateRig(undefined, ..._r)}
        ><Icon name="wand-sparkles" size={13} />Generate</button
      >
    </div>
  </section>

  {#if truthy(self.arm)}
    <section class="st-section">
      <h3 class="st-h"><Icon name="bone" size={13} />{self.arm?.name}</h3>
      <div class="st-btns">
        <button type="button" class="st-btn" onclick={args.s?.addBone}
          ><Icon name="plus" size={13} />Bone</button
        >
        <button
          type="button"
          class="st-btn"
          title="Continue the chain from the selected bone (E)"
          onclick={args.s?.extrudeBone}
          ><Icon name="arrow-up-from-line" size={13} />Extrude</button
        >
        <button
          type="button"
          class="st-btn"
          title="Mirror Left/Right bones to the other side"
          onclick={args.s?.symmetrizeBones}
          ><Icon name="flip-horizontal-2" size={13} />Symmetrize</button
        >
        <button
          type="button"
          class="st-btn st-danger"
          onclick={args.s?.deleteBone}
          ><Icon name="trash-2" size={13} />Delete</button
        >
      </div>
      {#if truthy(eq(args.s?.mode, 'bones'))}
        <div class="st-chips" role="group" aria-label="What the gizmo moves">
          <button
            type="button"
            class="st-chip {truthy(eq(args.s?.boneEnd, 'both')) ? 'on' : ''}"
            onclick={(..._r) => args.s?.setBoneEnd('both', ..._r)}
            >Whole bone</button
          >
          <button
            type="button"
            class="st-chip {truthy(eq(args.s?.boneEnd, 'head')) ? 'on' : ''}"
            onclick={(..._r) => args.s?.setBoneEnd('head', ..._r)}>Head</button
          >
          <button
            type="button"
            class="st-chip {truthy(eq(args.s?.boneEnd, 'tail')) ? 'on' : ''}"
            onclick={(..._r) => args.s?.setBoneEnd('tail', ..._r)}>Tail</button
          >
        </div>
      {/if}
      <ul class="st-bones">
        {#each args.s?.boneRows ?? [] as row (row?.bone?.id)}
          <li>
            <button
              type="button"
              class="st-bone
                    {truthy(row?.active) ? 'active' : ''}
                    {truthy(row?.selected) ? 'selected' : ''}"
              style={row?.indent}
              onclick={(..._r) => args.s?.selectBone(row?.bone?.id, ..._r)}
            >
              <Icon name="bone" size={11} />{row?.bone?.name}
              {#if truthy(row?.bone?.constraints?.length)}<span class="st-tag"
                  >IK</span
                >{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>

    {#if truthy(self.b)}
      <section class="st-section st-bone-props">
        <input
          type="text"
          class="st-inline-name"
          {@attach prop('value', () => self.b?.name)}
          aria-label="Bone name"
          {@attach on('keydown', self.stop)}
          onchange={self.boneName}
        />
        <label class="st-field"
          ><span>Parent</span>
          <select onchange={self.boneParent}>
            <option value="">None</option>
            {#each self.parentChoices ?? [] as p}<option
                value={p?.value}
                {@attach prop('selected', () => eq(p?.value, self.b?.parent))}
                >{p?.label}</option
              >{/each}
          </select>
        </label>
        <div class="st-vec"
          ><span class="st-label">Head</span>
          {#each self.axes ?? [] as a}<StNum
              axis={at(self.axisName, a)}
              value={at(self.b?.head, a)}
              step={0.01}
              onChange={(..._r) => self.boneVec('head', a, ..._r)}
            />{/each}
        </div>
        <div class="st-vec"
          ><span class="st-label">Tail</span>
          {#each self.axes ?? [] as a}<StNum
              axis={at(self.axisName, a)}
              value={at(self.b?.tail, a)}
              step={0.01}
              onChange={(..._r) => self.boneVec('tail', a, ..._r)}
            />{/each}
        </div>
        <StNum
          label="Roll"
          value={self.b?.roll}
          step={1}
          onChange={self.boneRoll}
        />
        <label class="st-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => not(eq(self.b?.deform, false)))}
            onchange={self.boneDeform}
          /><span>Deforms the mesh</span></label
        >
      </section>

      <section class="st-section st-constraints">
        <h3 class="st-h"
          ><Icon name="link" size={13} />Constraints and controls</h3
        >
        <div class="st-btns">
          <button
            type="button"
            class="st-btn st-add-ik"
            title="An IK target at this bone's tip, and a pole"
            onclick={args.s?.addIK}
            ><Icon name="target" size={13} />Add IK controls</button
          >
          <button type="button" class="st-btn" onclick={args.s?.addFKControl}
            ><Icon name="circle" size={13} />Add FK control</button
          >
        </div>
        {#each self.constraintRows ?? [] as row}
          <div class="st-mod">
            <div class="st-mod-head">
              <input
                type="checkbox"
                {@attach prop('checked', () => not(eq(row?.c?.on, false)))}
                aria-label="On"
                onchange={(..._r) => self.cOn(row?.index, ..._r)}
              />
              <span class="st-mod-name">{row?.label}</span>
              <button
                type="button"
                class="st-mini"
                title="Remove"
                aria-label="Remove constraint"
                onclick={(..._r) => args.s?.removeConstraint(row?.index, ..._r)}
                ><Icon name="x" size={11} /></button
              >
            </div>
            <label class="st-field"
              ><span>Target</span>
              <select
                onchange={(..._r) => self.cTarget(row?.index, 'target', ..._r)}
              >
                <option value="">None</option>
                {#each args.s?.controlChoices ?? [] as c}<option
                    value={c?.value}
                    {@attach prop('selected', () =>
                      eq(c?.value, row?.c?.target),
                    )}>{c?.label}</option
                  >{/each}
              </select>
            </label>
            {#if truthy(eq(row?.c?.type, 'ik'))}
              <label class="st-field"
                ><span>Pole</span>
                <select
                  onchange={(..._r) => self.cTarget(row?.index, 'pole', ..._r)}
                >
                  <option value="">None</option>
                  {#each args.s?.controlChoices ?? [] as c}<option
                      value={c?.value}
                      {@attach prop('selected', () =>
                        eq(c?.value, row?.c?.pole),
                      )}>{c?.label}</option
                    >{/each}
                </select>
              </label>
              <StNum
                label="Chain length"
                value={row?.c?.chain}
                min={1}
                max={16}
                step={1}
                int={true}
                onChange={(..._r) => self.cNum(row?.index, 'chain', ..._r)}
              />
            {/if}
            <div class="st-prop">
              <StNum
                label={truthy(eq(row?.c?.type, 'ik'))
                  ? 'IK ↔ FK (1 = IK)'
                  : 'Influence'}
                value={row?.c?.influence}
                min={0}
                max={1}
                step={0.01}
                onChange={(..._r) => self.cNum(row?.index, 'influence', ..._r)}
              />
              {#if truthy(eq(args.s?.workspace, 'animate'))}
                <button
                  type="button"
                  class="st-key"
                  title="Key IK/FK"
                  aria-label="Key influence"
                  onclick={(..._r) =>
                    args.s?.keyInfluence(self.b?.id, row?.c?.influence, ..._r)}
                  ><Icon name="diamond" size={11} /></button
                >
              {/if}
            </div>
          </div>
        {/each}
        <select aria-label="Add constraint" onchange={self.addConstraint}>
          <option value="">Add constraint…</option>
          {#each self.constraintTypes ?? [] as c}<option value={c?.value}
              >{c?.label}</option
            >{/each}
        </select>
        <button
          type="button"
          class="st-btn st-wide"
          title="Copy what IK is doing into the bones' own rotations"
          onclick={args.s?.ikToFK}
          ><Icon name="refresh-cw" size={13} />Match FK to IK</button
        >
      </section>
    {/if}
  {:else}
    <section class="st-section">
      <p class="st-note"
        >No armature yet. Generate one from a template above, or start with a
        single bone.</p
      >
      <button
        type="button"
        class="st-btn st-wide"
        onclick={(..._r) => args.s?.addObject('armature', ..._r)}
        ><Icon name="bone" size={13} />Add armature</button
      >
    </section>
  {/if}
{/if}

{#if truthy(eq(self.section, 'weights'))}
  <section class="st-section">
    <h3 class="st-h"><Icon name="spray-can" size={13} />Skin</h3>
    {#if truthy(args.s?.skinnedMesh)}
      <p class="st-note"
        >“{args.s?.skinnedMesh?.name}” follows “{args.s?.armature?.name}”.</p
      >
      <div class="st-btns">
        <button
          type="button"
          class="st-btn st-paint-weights
                {truthy(eq(args.s?.mode, 'weight')) ? 'active' : ''}"
          onclick={args.s?.paintWeights}
          ><Icon name="brush" size={13} />Paint weights</button
        >
        <button type="button" class="st-btn" onclick={args.s?.autoWeightsAgain}
          ><Icon name="wand-sparkles" size={13} />Automatic</button
        >
        <button type="button" class="st-btn" onclick={args.s?.normalizeWeights}
          ><Icon name="scale" size={13} />Normalize</button
        >
        <button
          type="button"
          class="st-btn"
          title="Copy +X side to −X"
          onclick={(..._r) => args.s?.mirrorWeights(true, ..._r)}
          ><Icon name="flip-horizontal-2" size={13} />Mirror +X → −X</button
        >
        <button
          type="button"
          class="st-btn"
          onclick={(..._r) => args.s?.mirrorWeights(false, ..._r)}
          ><Icon name="flip-horizontal-2" size={13} />Mirror −X → +X</button
        >
        <button type="button" class="st-btn" onclick={args.s?.smoothWeights}
          ><Icon name="waves" size={13} />Smooth group</button
        >
        <button type="button" class="st-btn" onclick={args.s?.transferWeights}
          ><Icon name="arrow-right-left" size={13} />Transfer</button
        >
        <button type="button" class="st-btn" onclick={args.s?.clearGroup}
          ><Icon name="eraser" size={13} />Clear group</button
        >
        <button
          type="button"
          class="st-btn st-danger"
          onclick={args.s?.unbindSkin}
          ><Icon name="unlink" size={13} />Unbind</button
        >
      </div>
      <h4 class="st-h4">Vertex groups</h4>
      <ul class="st-groups">
        {#each args.s?.weightGroups ?? [] as g}
          <li
            ><button
              type="button"
              class="st-group {truthy(g?.active) ? 'active' : ''}"
              onclick={(..._r) => args.s?.setWeightGroup(g?.name, ..._r)}
              >{g?.name}</button
            ></li
          >
        {/each}
      </ul>
    {:else}
      <p class="st-note"
        >Select a mesh (and the armature, or have just one) to bind it with
        automatic weights.</p
      >
      <button
        type="button"
        class="st-btn st-wide st-bind"
        onclick={args.s?.bindSelected}
        ><Icon name="link" size={13} />Bind to armature</button
      >
    {/if}
  </section>
  {#if truthy(eq(args.s?.mode, 'weight'))}
    <section class="st-section">
      <h3 class="st-h">Weight brush</h3>
      <StNum
        label="Size (px)"
        value={args.s?.weightBrush?.size}
        min={2}
        max={400}
        step={1}
        int={true}
        onChange={(..._r) => self.w('size', ..._r)}
      />
      <StNum
        label="Strength"
        value={args.s?.weightBrush?.strength}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.w('strength', ..._r)}
      />
      <StNum
        label="Weight"
        value={args.s?.weightBrush?.value}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.w('value', ..._r)}
      />
      <StNum
        label="Hardness"
        value={args.s?.weightBrush?.hardness}
        min={0}
        max={0.95}
        step={0.01}
        onChange={(..._r) => self.w('hardness', ..._r)}
      />
      <label class="st-field"
        ><span>Falloff</span>
        <select onchange={self.wFalloff}>
          {#each self.falloffs ?? [] as f}<option
              value={f}
              {@attach prop('selected', () =>
                eq(f, args.s?.weightBrush?.falloff),
              )}>{f}</option
            >{/each}
        </select>
      </label>
      <div class="st-row-btns">
        <span class="st-label">Symmetry</span>
        {#each self.axes ?? [] as a}
          <button
            type="button"
            class="st-axis
                  {at(self.axisName, a)}
                  {truthy(at(args.s?.weightBrush?.symmetry, a)) ? 'on' : ''}"
            onclick={(..._r) => args.s?.toggleSymmetry('weight', a, ..._r)}
            >{at(self.axisName, a)}</button
          >
        {/each}
      </div>
      <label class="st-check"
        ><input
          type="checkbox"
          {@attach prop('checked', () => args.s?.weightBrush?.autoNormalize)}
          onchange={self.wNormalize}
        /><span>Keep weights normalized</span></label
      >
      <div class="st-ramp" aria-hidden="true"></div>
    </section>
  {/if}
{/if}

{#if truthy(eq(self.section, 'pose'))}
  <section class="st-section">
    <h3 class="st-h"><Icon name="person-standing" size={13} />Pose</h3>
    <p class="st-note"
      >Drag the controllers: IK hands and feet, poles for elbows and knees,
      rings for head, spine and hips. Or click a bone and rotate it.</p
    >
    <div class="st-btns">
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.resetPose(false, ..._r)}
        ><Icon name="rotate-ccw" size={13} />Reset selected</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.resetPose(true, ..._r)}
        ><Icon name="rotate-ccw" size={13} />Reset all</button
      >
      <button
        type="button"
        class="st-btn {truthy(args.s?.restPose) ? 'active' : ''}"
        onclick={args.s?.toggleRestPose}
        ><Icon name="person-standing" size={13} />Rest pose</button
      >
      <button type="button" class="st-btn" onclick={args.s?.copyPose}
        ><Icon name="copy" size={13} />Copy</button
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
      <button type="button" class="st-btn" onclick={args.s?.mirrorPose}
        ><Icon name="flip-horizontal-2" size={13} />Mirror</button
      >
    </div>
  </section>
  <section class="st-section">
    <h3 class="st-h"><Icon name="book-open" size={13} />Pose library</h3>
    <button
      type="button"
      class="st-btn st-wide st-save-pose"
      onclick={args.s?.savePose}
      ><Icon name="plus" size={13} />Save current pose</button
    >
    <ul class="st-poses">
      {#each args.s?.poseLibrary ?? [] as p (p?.id)}
        <li class="st-pose">
          {#if truthy(p?.thumb)}<img src={p?.thumb} alt="" />{/if}
          <input
            type="text"
            class="st-inline-name"
            {@attach prop('value', () => p?.name)}
            aria-label="Pose name"
            {@attach on('keydown', self.stop)}
            onchange={(..._r) => args.s?.renamePose(p?.id, ..._r)}
          />
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
          <button
            type="button"
            class="st-mini"
            title="Delete"
            aria-label="Delete {p?.name}"
            onclick={(..._r) => args.s?.deletePose(p?.id, ..._r)}
            ><Icon name="x" size={11} /></button
          >
        </li>
      {:else}
        <li class="st-empty"
          >Saved poses go here, ready to reuse (or mirror) on any rig with the
          same bone names.</li
        >
      {/each}
    </ul>
  </section>
{/if}
