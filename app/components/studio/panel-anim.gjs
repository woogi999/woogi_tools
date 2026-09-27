import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';
import StNum from './num';

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

export default class StudioAnimPanel extends Component {
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

  <template>
    <section class="st-section st-clips">
      <h3 class="st-h"><Icon @name="clapperboard" @size={{13}} />Clips</h3>
      <ul class="st-clip-list">
        {{#each @s.clips key="id" as |c|}}
          <li>
            <button
              type="button"
              class="st-clip {{if (eq c.id @s.doc.activeClip) 'active'}}"
              {{on "click" (fn @s.setActiveClip c.id)}}
            >
              <Icon @name="film" @size={{11}} />{{c.name}}<span
                class="st-layer-meta"
              >{{c.start}}–{{c.end}}</span>
            </button>
          </li>
        {{/each}}
      </ul>
      <div class="st-btns">
        <button
          type="button"
          class="st-btn st-new-clip"
          {{on "click" (fn @s.addClip undefined)}}
        ><Icon @name="plus" @size={{13}} />New</button>
        <button
          type="button"
          class="st-btn"
          disabled={{not this.c}}
          {{on "click" @s.duplicateClip}}
        ><Icon @name="copy" @size={{13}} />Duplicate</button>
        <button
          type="button"
          class="st-btn st-danger"
          disabled={{not this.c}}
          {{on "click" (fn @s.deleteClip undefined)}}
        ><Icon @name="trash-2" @size={{13}} />Delete</button>
      </div>
      {{#if this.c}}
        <input
          type="text"
          class="st-inline-name"
          value={{this.c.name}}
          aria-label="Clip name"
          {{on "change" @s.renameClip}}
          {{on "keydown" this.stop}}
        />
        <div class="st-row-fields">
          <StNum
            @label="Start"
            @value={{this.c.start}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.clipNum "start"}}
          />
          <StNum
            @label="End"
            @value={{this.c.end}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.clipNum "end"}}
          />
        </div>
        <div class="st-row-fields">
          <StNum
            @label="FPS"
            @value={{@s.doc.fps}}
            @min={{1}}
            @max={{240}}
            @step={{1}}
            @int={{true}}
            @onChange={{@s.setFps}}
          />
          <StNum
            @label="Clip speed"
            @value={{this.c.speed}}
            @min={{0.05}}
            @max={{10}}
            @step={{0.05}}
            @onChange={{fn this.clipNum "speed"}}
          />
        </div>
        <label class="st-check"><input
            type="checkbox"
            checked={{this.c.loop}}
            {{on "change" this.clipLoop}}
          /><span>Loop</span></label>
        <label class="st-field"><span>Preview speed</span>
          <select {{on "change" this.speed}}>
            {{#each this.speeds as |sp|}}<option
                value={{sp}}
                selected={{eq sp @s.anim.speed}}
              >{{sp}}×</option>{{/each}}
          </select>
        </label>
      {{/if}}
    </section>

    <section class="st-section">
      <h3 class="st-h"><Icon @name="diamond" @size={{13}} />Keys</h3>
      <label class="st-check"><input
          type="checkbox"
          checked={{@s.autoKey}}
          {{on "change" @s.toggleAutoKey}}
        /><span>Auto key (moving something keys it)</span></label>
      <div class="st-btns">
        <button
          type="button"
          class="st-btn st-key-all"
          {{on "click" (fn this.key undefined)}}
        ><Icon @name="diamond" @size={{13}} />Key all (I)</button>
        <button
          type="button"
          class="st-btn"
          {{on "click" (fn this.key (array "pos"))}}
        >Location</button>
        <button
          type="button"
          class="st-btn"
          {{on "click" (fn this.key (array "rot"))}}
        >Rotation</button>
        <button
          type="button"
          class="st-btn"
          {{on "click" (fn this.key (array "scl"))}}
        >Scale</button>
        {{#if @s.obj}}
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.keyVisibility @s.active)}}
          ><Icon @name="eye" @size={{13}} />Visibility</button>
        {{/if}}
      </div>
      <p class="st-note">Materials keyframe from the Material tab; IK/FK from a
        bone's constraint.</p>
      {{#if @s.anim.keySel.size}}
        <h4 class="st-h4">{{@s.anim.keySel.size}} key(s) selected</h4>
        <div class="st-chips" role="group" aria-label="Interpolation">
          {{#each this.interps as |i|}}<button
              type="button"
              class="st-chip"
              {{on "click" (fn @s.setKeyInterp i.value)}}
            >{{i.label}}</button>{{/each}}
        </div>
        <div class="st-chips" role="group" aria-label="Easing">
          {{#each this.eases as |e|}}<button
              type="button"
              class="st-chip"
              {{on "click" (fn @s.setKeyEase e.value)}}
            >{{e.label}}</button>{{/each}}
        </div>
        <div class="st-btns">
          <button type="button" class="st-btn" {{on "click" @s.copyKeys}}><Icon
              @name="copy"
              @size={{13}}
            />Copy</button>
          <button type="button" class="st-btn" {{on "click" @s.pasteKeys}}><Icon
              @name="clipboard-paste"
              @size={{13}}
            />Paste at playhead</button>
          <button
            type="button"
            class="st-btn st-danger"
            {{on "click" @s.deleteKeys}}
          ><Icon @name="trash-2" @size={{13}} />Delete</button>
        </div>
      {{/if}}
    </section>

    <section class="st-section">
      <h3 class="st-h"><Icon @name="ghost" @size={{13}} />Onion skin</h3>
      <label class="st-check"><input
          type="checkbox"
          checked={{@s.anim.onion.on}}
          {{on "change" @s.toggleOnion}}
        /><span>Show poses before and after</span></label>
      {{#if @s.anim.onion.on}}
        <div class="st-row-fields">
          <StNum
            @label="Before"
            @value={{@s.anim.onion.before}}
            @min={{0}}
            @max={{6}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.onion "before"}}
          />
          <StNum
            @label="After"
            @value={{@s.anim.onion.after}}
            @min={{0}}
            @max={{6}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.onion "after"}}
          />
        </div>
        <StNum
          @label="Every (frames)"
          @value={{@s.anim.onion.step}}
          @min={{1}}
          @max={{30}}
          @step={{1}}
          @int={{true}}
          @onChange={{fn this.onion "step"}}
        />
      {{/if}}
    </section>

    <section class="st-section">
      <h3 class="st-h"><Icon @name="person-standing" @size={{13}} />Poses</h3>
      <div class="st-btns">
        <button type="button" class="st-btn" {{on "click" @s.copyPose}}><Icon
            @name="copy"
            @size={{13}}
          />Copy pose</button>
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
        <button type="button" class="st-btn" {{on "click" @s.savePose}}><Icon
            @name="plus"
            @size={{13}}
          />Save to library</button>
      </div>
      <ul class="st-poses">
        {{#each @s.poseLibrary key="id" as |p|}}
          <li class="st-pose">
            {{#if p.thumb}}<img src={{p.thumb}} alt="" />{{/if}}
            <span class="st-layer-name">{{p.name}}</span>
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
          </li>
        {{/each}}
      </ul>
      <button
        type="button"
        class="st-btn st-wide st-retarget"
        {{on "click" @s.openRetarget}}
      ><Icon @name="arrow-right-left" @size={{13}} />Retarget to another rig…</button>
    </section>
  </template>
}

function array(...xs) {
  return xs;
}
