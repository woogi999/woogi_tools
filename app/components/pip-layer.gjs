import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { TOOLS } from '../tools';
import { PIP_LAYOUT_WIDTH } from '../services/pip';

const toolFor = (route) =>
  TOOLS.find((t) => t.route === route) ?? { label: route, icon: 'layers' };

const windowStyle = (session) =>
  htmlSafe(
    `left: ${session.x}px; top: ${session.y}px; width: ${session.width}px; height: ${session.height}px; --pip-zoom: ${(session.width / PIP_LAYOUT_WIDTH).toFixed(4)}; --pip-layout-width: ${PIP_LAYOUT_WIDTH}px`,
  );

// Renders every live tool (into its session's own element, wherever that
// currently sits) plus the floating windows and minimized pills around them.
// Lives after the router outlet in the application template, so a page's slot
// has already asked for its session by the time this reads the list.
export default class PipLayer extends Component {
  @service pip;

  get floating() {
    return this.pip.sessions.filter((s) => s.mode === 'floating');
  }

  get minimized() {
    return this.pip.sessions.filter((s) => s.mode === 'minimized');
  }

  frame = modifier((element, [session]) => {
    this.pip.bindFrame(session, element);
    return () => this.pip.unbindFrame(session, element);
  });

  parking = modifier((element) => {
    this.pip.bindParking(element);
  });

  // Drags the window by its title bar; clicks on the bar's buttons pass through.
  drag = modifier((bar, [session]) => {
    let start = null;
    const down = (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      bar.setPointerCapture?.(event.pointerId);
      start = {
        id: event.pointerId,
        x: event.clientX - session.x,
        y: event.clientY - session.y,
      };
    };
    const move = (event) => {
      if (start?.id !== event.pointerId) return;
      this.pip.moveTo(
        session,
        event.clientX - start.x,
        event.clientY - start.y,
      );
    };
    const up = () => (start = null);
    bar.addEventListener('pointerdown', down);
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
    return () => {
      bar.removeEventListener('pointerdown', down);
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
  });

  resize = modifier((handle, [session]) => {
    let start = null;
    const down = (event) => {
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      start = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        width: session.width,
        height: session.height,
      };
    };
    const move = (event) => {
      if (start?.id !== event.pointerId) return;
      this.pip.resizeTo(
        session,
        start.width + event.clientX - start.x,
        start.height + event.clientY - start.y,
      );
    };
    const up = () => (start = null);
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
  });

  <template>
    {{#each this.pip.sessions key="id" as |session|}}
      {{#in-element session.element insertBefore=null}}
        <session.component />
      {{/in-element}}
    {{/each}}

    {{#each this.floating key="id" as |session|}}
      {{#let (toolFor session.route) as |tool|}}
        <section
          class="pip-window pop-in"
          style={{windowStyle session}}
          aria-label="{{tool.label}}, picture-in-picture"
        >
          <header class="pip-bar" {{this.drag session}}>
            <Icon @name={{tool.icon}} @size={{14}} />
            <span class="pip-title">{{tool.label}}</span>
            <button
              type="button"
              class="pip-btn"
              aria-label="Open {{tool.label}} full size"
              title="Back to its page"
              {{on "click" (fn this.pip.expand session)}}
            ><Icon @name="maximize" @size={{13}} /></button>
            <button
              type="button"
              class="pip-btn"
              aria-label="Minimise"
              title="Minimise"
              {{on "click" (fn this.pip.minimize session)}}
            ><Icon @name="minus" @size={{13}} /></button>
            <button
              type="button"
              class="pip-btn is-close"
              aria-label="Close {{tool.label}}"
              title="Close"
              {{on "click" (fn this.pip.close session)}}
            ><Icon @name="x" @size={{13}} /></button>
          </header>
          <div class="pip-body" {{this.frame session}}></div>
          <span
            class="pip-resize"
            aria-hidden="true"
            {{this.resize session}}
          ></span>
        </section>
      {{/let}}
    {{/each}}

    {{#if this.minimized.length}}
      <div class="pip-pills">
        {{#each this.minimized key="id" as |session|}}
          {{#let (toolFor session.route) as |tool|}}
            <div class="pip-pill pop-in">
              <button
                type="button"
                class="pip-pill-open"
                aria-label="Show {{tool.label}}"
                {{on "click" (fn this.pip.float session)}}
              >
                <Icon @name={{tool.icon}} @size={{14}} />
                <span>{{tool.label}}</span>
              </button>
              <button
                type="button"
                class="pip-btn is-close"
                aria-label="Close {{tool.label}}"
                {{on "click" (fn this.pip.close session)}}
              ><Icon @name="x" @size={{12}} /></button>
            </div>
          {{/let}}
        {{/each}}
      </div>
    {{/if}}

    {{! Minimised tools keep running in here, out of sight. }}
    <div class="pip-parking" aria-hidden="true" {{this.parking}}></div>
  </template>
}
