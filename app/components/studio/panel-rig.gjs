import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';
import StNum from './num';

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

export default class StudioRigPanel extends Component {
  axes = AXES;
  axisName = AXIS;
  constraintTypes = CONSTRAINTS;
  @tracked section = 'bones';

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

  <template>
    <div class="st-subtabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="{{if (eq this.section 'bones') 'active'}}"
        {{on "click" (fn this.setSection "bones")}}
      >Bones</button>
      <button
        type="button"
        role="tab"
        class="st-weights-tab {{if (eq this.section 'weights') 'active'}}"
        {{on "click" (fn this.setSection "weights")}}
      >Weights</button>
      <button
        type="button"
        role="tab"
        class="st-pose-tab {{if (eq this.section 'pose') 'active'}}"
        {{on "click" (fn this.setSection "pose")}}
      >Pose</button>
    </div>

    {{#if (eq this.section "bones")}}
      <section class="st-section">
        <h3 class="st-h"><Icon @name="person-standing" @size={{13}} />Rig
          templates</h3>
        <p class="st-note">Select the mesh first: the rig is fitted to it and
          bound with automatic weights, with controllers for hands, feet,
          elbows, knees, head, spine and hips.</p>
        <div class="st-row-fields">
          <select aria-label="Template" {{on "change" @s.setTemplate}}>
            {{#each @s.templates as |t|}}<option
                value={{t.value}}
                selected={{eq t.value @s.rig.template}}
              >{{t.label}}</option>{{/each}}
          </select>
          <button
            type="button"
            class="st-btn st-generate-rig"
            {{on "click" (fn @s.generateRig undefined)}}
          ><Icon @name="wand-sparkles" @size={{13}} />Generate</button>
        </div>
      </section>

      {{#if this.arm}}
        <section class="st-section">
          <h3 class="st-h"><Icon
              @name="bone"
              @size={{13}}
            />{{this.arm.name}}</h3>
          <div class="st-btns">
            <button type="button" class="st-btn" {{on "click" @s.addBone}}><Icon
                @name="plus"
                @size={{13}}
              />Bone</button>
            <button
              type="button"
              class="st-btn"
              title="Continue the chain from the selected bone (E)"
              {{on "click" @s.extrudeBone}}
            ><Icon @name="arrow-up-from-line" @size={{13}} />Extrude</button>
            <button
              type="button"
              class="st-btn"
              title="Mirror Left/Right bones to the other side"
              {{on "click" @s.symmetrizeBones}}
            ><Icon @name="flip-horizontal-2" @size={{13}} />Symmetrize</button>
            <button
              type="button"
              class="st-btn st-danger"
              {{on "click" @s.deleteBone}}
            ><Icon @name="trash-2" @size={{13}} />Delete</button>
          </div>
          {{#if (eq @s.mode "bones")}}
            <div
              class="st-chips"
              role="group"
              aria-label="What the gizmo moves"
            >
              <button
                type="button"
                class="st-chip {{if (eq @s.boneEnd 'both') 'on'}}"
                {{on "click" (fn @s.setBoneEnd "both")}}
              >Whole bone</button>
              <button
                type="button"
                class="st-chip {{if (eq @s.boneEnd 'head') 'on'}}"
                {{on "click" (fn @s.setBoneEnd "head")}}
              >Head</button>
              <button
                type="button"
                class="st-chip {{if (eq @s.boneEnd 'tail') 'on'}}"
                {{on "click" (fn @s.setBoneEnd "tail")}}
              >Tail</button>
            </div>
          {{/if}}
          <ul class="st-bones">
            {{#each @s.boneRows key="bone.id" as |row|}}
              <li>
                <button
                  type="button"
                  class="st-bone
                    {{if row.active 'active'}}
                    {{if row.selected 'selected'}}"
                  style={{row.indent}}
                  {{on "click" (fn @s.selectBone row.bone.id)}}
                >
                  <Icon @name="bone" @size={{11}} />{{row.bone.name}}
                  {{#if row.bone.constraints.length}}<span
                      class="st-tag"
                    >IK</span>{{/if}}
                </button>
              </li>
            {{/each}}
          </ul>
        </section>

        {{#if this.b}}
          <section class="st-section st-bone-props">
            <input
              type="text"
              class="st-inline-name"
              value={{this.b.name}}
              aria-label="Bone name"
              {{on "change" this.boneName}}
              {{on "keydown" this.stop}}
            />
            <label class="st-field"><span>Parent</span>
              <select {{on "change" this.boneParent}}>
                <option value="">None</option>
                {{#each this.parentChoices as |p|}}<option
                    value={{p.value}}
                    selected={{eq p.value this.b.parent}}
                  >{{p.label}}</option>{{/each}}
              </select>
            </label>
            <div class="st-vec"><span class="st-label">Head</span>
              {{#each this.axes as |a|}}<StNum
                  @axis={{at this.axisName a}}
                  @value={{at this.b.head a}}
                  @step={{0.01}}
                  @onChange={{fn this.boneVec "head" a}}
                />{{/each}}
            </div>
            <div class="st-vec"><span class="st-label">Tail</span>
              {{#each this.axes as |a|}}<StNum
                  @axis={{at this.axisName a}}
                  @value={{at this.b.tail a}}
                  @step={{0.01}}
                  @onChange={{fn this.boneVec "tail" a}}
                />{{/each}}
            </div>
            <StNum
              @label="Roll"
              @value={{this.b.roll}}
              @step={{1}}
              @onChange={{this.boneRoll}}
            />
            <label class="st-check"><input
                type="checkbox"
                checked={{not (eq this.b.deform false)}}
                {{on "change" this.boneDeform}}
              /><span>Deforms the mesh</span></label>
          </section>

          <section class="st-section st-constraints">
            <h3 class="st-h"><Icon @name="link" @size={{13}} />Constraints and
              controls</h3>
            <div class="st-btns">
              <button
                type="button"
                class="st-btn st-add-ik"
                title="An IK target at this bone's tip, and a pole"
                {{on "click" @s.addIK}}
              ><Icon @name="target" @size={{13}} />Add IK controls</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" @s.addFKControl}}
              ><Icon @name="circle" @size={{13}} />Add FK control</button>
            </div>
            {{#each this.constraintRows as |row|}}
              <div class="st-mod">
                <div class="st-mod-head">
                  <input
                    type="checkbox"
                    checked={{not (eq row.c.on false)}}
                    aria-label="On"
                    {{on "change" (fn this.cOn row.index)}}
                  />
                  <span class="st-mod-name">{{row.label}}</span>
                  <button
                    type="button"
                    class="st-mini"
                    title="Remove"
                    aria-label="Remove constraint"
                    {{on "click" (fn @s.removeConstraint row.index)}}
                  ><Icon @name="x" @size={{11}} /></button>
                </div>
                <label class="st-field"><span>Target</span>
                  <select {{on "change" (fn this.cTarget row.index "target")}}>
                    <option value="">None</option>
                    {{#each @s.controlChoices as |c|}}<option
                        value={{c.value}}
                        selected={{eq c.value row.c.target}}
                      >{{c.label}}</option>{{/each}}
                  </select>
                </label>
                {{#if (eq row.c.type "ik")}}
                  <label class="st-field"><span>Pole</span>
                    <select {{on "change" (fn this.cTarget row.index "pole")}}>
                      <option value="">None</option>
                      {{#each @s.controlChoices as |c|}}<option
                          value={{c.value}}
                          selected={{eq c.value row.c.pole}}
                        >{{c.label}}</option>{{/each}}
                    </select>
                  </label>
                  <StNum
                    @label="Chain length"
                    @value={{row.c.chain}}
                    @min={{1}}
                    @max={{16}}
                    @step={{1}}
                    @int={{true}}
                    @onChange={{fn this.cNum row.index "chain"}}
                  />
                {{/if}}
                <div class="st-prop">
                  <StNum
                    @label={{if
                      (eq row.c.type "ik")
                      "IK ↔ FK (1 = IK)"
                      "Influence"
                    }}
                    @value={{row.c.influence}}
                    @min={{0}}
                    @max={{1}}
                    @step={{0.01}}
                    @onChange={{fn this.cNum row.index "influence"}}
                  />
                  {{#if (eq @s.workspace "animate")}}
                    <button
                      type="button"
                      class="st-key"
                      title="Key IK/FK"
                      aria-label="Key influence"
                      {{on
                        "click"
                        (fn @s.keyInfluence this.b.id row.c.influence)
                      }}
                    ><Icon @name="diamond" @size={{11}} /></button>
                  {{/if}}
                </div>
              </div>
            {{/each}}
            <select
              aria-label="Add constraint"
              {{on "change" this.addConstraint}}
            >
              <option value="">Add constraint…</option>
              {{#each this.constraintTypes as |c|}}<option
                  value={{c.value}}
                >{{c.label}}</option>{{/each}}
            </select>
            <button
              type="button"
              class="st-btn st-wide"
              title="Copy what IK is doing into the bones' own rotations"
              {{on "click" @s.ikToFK}}
            ><Icon @name="refresh-cw" @size={{13}} />Match FK to IK</button>
          </section>
        {{/if}}
      {{else}}
        <section class="st-section">
          <p class="st-note">No armature yet. Generate one from a template
            above, or start with a single bone.</p>
          <button
            type="button"
            class="st-btn st-wide"
            {{on "click" (fn @s.addObject "armature")}}
          ><Icon @name="bone" @size={{13}} />Add armature</button>
        </section>
      {{/if}}
    {{/if}}

    {{#if (eq this.section "weights")}}
      <section class="st-section">
        <h3 class="st-h"><Icon @name="spray-can" @size={{13}} />Skin</h3>
        {{#if @s.skinnedMesh}}
          <p class="st-note">“{{@s.skinnedMesh.name}}” follows “{{@s.armature.name}}”.</p>
          <div class="st-btns">
            <button
              type="button"
              class="st-btn st-paint-weights
                {{if (eq @s.mode 'weight') 'active'}}"
              {{on "click" @s.paintWeights}}
            ><Icon @name="brush" @size={{13}} />Paint weights</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.autoWeightsAgain}}
            ><Icon @name="wand-sparkles" @size={{13}} />Automatic</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.normalizeWeights}}
            ><Icon @name="scale" @size={{13}} />Normalize</button>
            <button
              type="button"
              class="st-btn"
              title="Copy +X side to −X"
              {{on "click" (fn @s.mirrorWeights true)}}
            ><Icon @name="flip-horizontal-2" @size={{13}} />Mirror +X → −X</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" (fn @s.mirrorWeights false)}}
            ><Icon @name="flip-horizontal-2" @size={{13}} />Mirror −X → +X</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.smoothWeights}}
            ><Icon @name="waves" @size={{13}} />Smooth group</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.transferWeights}}
            ><Icon @name="arrow-right-left" @size={{13}} />Transfer</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.clearGroup}}
            ><Icon @name="eraser" @size={{13}} />Clear group</button>
            <button
              type="button"
              class="st-btn st-danger"
              {{on "click" @s.unbindSkin}}
            ><Icon @name="unlink" @size={{13}} />Unbind</button>
          </div>
          <h4 class="st-h4">Vertex groups</h4>
          <ul class="st-groups">
            {{#each @s.weightGroups as |g|}}
              <li><button
                  type="button"
                  class="st-group {{if g.active 'active'}}"
                  {{on "click" (fn @s.setWeightGroup g.name)}}
                >{{g.name}}</button></li>
            {{/each}}
          </ul>
        {{else}}
          <p class="st-note">Select a mesh (and the armature, or have just one)
            to bind it with automatic weights.</p>
          <button
            type="button"
            class="st-btn st-wide st-bind"
            {{on "click" @s.bindSelected}}
          ><Icon @name="link" @size={{13}} />Bind to armature</button>
        {{/if}}
      </section>
      {{#if (eq @s.mode "weight")}}
        <section class="st-section">
          <h3 class="st-h">Weight brush</h3>
          <StNum
            @label="Size (px)"
            @value={{@s.weightBrush.size}}
            @min={{2}}
            @max={{400}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.w "size"}}
          />
          <StNum
            @label="Strength"
            @value={{@s.weightBrush.strength}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.w "strength"}}
          />
          <StNum
            @label="Weight"
            @value={{@s.weightBrush.value}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.w "value"}}
          />
          <StNum
            @label="Hardness"
            @value={{@s.weightBrush.hardness}}
            @min={{0}}
            @max={{0.95}}
            @step={{0.01}}
            @onChange={{fn this.w "hardness"}}
          />
          <label class="st-field"><span>Falloff</span>
            <select {{on "change" this.wFalloff}}>
              {{#each this.falloffs as |f|}}<option
                  value={{f}}
                  selected={{eq f @s.weightBrush.falloff}}
                >{{f}}</option>{{/each}}
            </select>
          </label>
          <div class="st-row-btns">
            <span class="st-label">Symmetry</span>
            {{#each this.axes as |a|}}
              <button
                type="button"
                class="st-axis
                  {{at this.axisName a}}
                  {{if (at @s.weightBrush.symmetry a) 'on'}}"
                {{on "click" (fn @s.toggleSymmetry "weight" a)}}
              >{{at this.axisName a}}</button>
            {{/each}}
          </div>
          <label class="st-check"><input
              type="checkbox"
              checked={{@s.weightBrush.autoNormalize}}
              {{on "change" this.wNormalize}}
            /><span>Keep weights normalized</span></label>
          <div class="st-ramp" aria-hidden="true"></div>
        </section>
      {{/if}}
    {{/if}}

    {{#if (eq this.section "pose")}}
      <section class="st-section">
        <h3 class="st-h"><Icon @name="person-standing" @size={{13}} />Pose</h3>
        <p class="st-note">Drag the controllers: IK hands and feet, poles for
          elbows and knees, rings for head, spine and hips. Or click a bone and
          rotate it.</p>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.resetPose false)}}
          ><Icon @name="rotate-ccw" @size={{13}} />Reset selected</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.resetPose true)}}
          ><Icon @name="rotate-ccw" @size={{13}} />Reset all</button>
          <button
            type="button"
            class="st-btn {{if @s.restPose 'active'}}"
            {{on "click" @s.toggleRestPose}}
          ><Icon @name="person-standing" @size={{13}} />Rest pose</button>
          <button type="button" class="st-btn" {{on "click" @s.copyPose}}><Icon
              @name="copy"
              @size={{13}}
            />Copy</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.pastePose false)}}
          ><Icon @name="clipboard-paste" @size={{13}} />Paste</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.pastePose true)}}
          ><Icon @name="flip-horizontal-2" @size={{13}} />Paste mirrored</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" @s.mirrorPose}}
          ><Icon @name="flip-horizontal-2" @size={{13}} />Mirror</button>
        </div>
      </section>
      <section class="st-section">
        <h3 class="st-h"><Icon @name="book-open" @size={{13}} />Pose library</h3>
        <button
          type="button"
          class="st-btn st-wide st-save-pose"
          {{on "click" @s.savePose}}
        ><Icon @name="plus" @size={{13}} />Save current pose</button>
        <ul class="st-poses">
          {{#each @s.poseLibrary key="id" as |p|}}
            <li class="st-pose">
              {{#if p.thumb}}<img src={{p.thumb}} alt="" />{{/if}}
              <input
                type="text"
                class="st-inline-name"
                value={{p.name}}
                aria-label="Pose name"
                {{on "change" (fn @s.renamePose p.id)}}
                {{on "keydown" this.stop}}
              />
              <button
                type="button"
                class="st-mini"
                title="Apply"
                aria-label="Apply {{p.name}}"
                {{on "click" (fn @s.applyLibraryPose p.id false)}}
              ><Icon @name="check" @size={{11}} /></button>
              <button
                type="button"
                class="st-mini"
                title="Apply mirrored"
                aria-label="Apply {{p.name}} mirrored"
                {{on "click" (fn @s.applyLibraryPose p.id true)}}
              ><Icon @name="flip-horizontal-2" @size={{11}} /></button>
              <button
                type="button"
                class="st-mini"
                title="Delete"
                aria-label="Delete {{p.name}}"
                {{on "click" (fn @s.deletePose p.id)}}
              ><Icon @name="x" @size={{11}} /></button>
            </li>
          {{else}}
            <li class="st-empty">Saved poses go here, ready to reuse (or mirror)
              on any rig with the same bone names.</li>
          {{/each}}
        </ul>
      </section>
    {{/if}}
  </template>
}
