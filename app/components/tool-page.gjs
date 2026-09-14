import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import FavouriteStar from './favourite-star';
import CreditList from './credit-list';
import Icon from './icon';
import { TOOLS } from '../tools';

const toolFor = (route) => TOOLS.find((t) => t.route === route);

// Args: @route, @subtitle; and for tools that shouldn't just vanish when you
// leave their page, @busy (true while something is running, e.g. a game) and
// @closeWarning (what closing it would interrupt). @landscape turns phones
// sideways in fullscreen, for games laid out wide. @game switches to the
// games layout: edge to edge, with a slim title bar instead of the hero.
export default class ToolPage extends Component {
  @service pip;
  @tracked isFullscreen = false;
  body = null;
  usingApi = false;

  constructor(owner, args) {
    super(owner, args);
    // Read lazily when you leave the page or close its window, never during render.
    registerDestructor(this, this.pip.provide(args.route, () => ({ busy: Boolean(this.args.busy), warning: this.args.closeWarning ?? '' })));
  }

  get tool() {
    return toolFor(this.args.route);
  }

  get session() {
    return this.pip.sessionFor(this.args.route);
  }

  popOut = () => {
    if (this.isFullscreen) this.toggleFullscreen();
    if (this.session) this.pip.float(this.session);
  };

  // Uses the real Fullscreen API where there is one. iPhones only allow it for
  // video, so there the tool body just covers the window instead (.is-fullscreen).
  trackBody = modifier((element) => {
    this.body = element;
    // Leaving real fullscreen from the browser's own controls (Esc, a swipe) ends ours too.
    const onChange = () => {
      if (document.fullscreenElement === element) this.isFullscreen = true;
      else if (this.usingApi) this.isFullscreen = this.usingApi = false;
    };
    const onKey = (event) => {
      if (event.key === 'Escape' && this.isFullscreen && !document.fullscreenElement) this.isFullscreen = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement === element) document.exitFullscreen?.();
      this.body = null;
    };
  });

  toggleFullscreen = async () => {
    const element = this.body;
    if (!element) return;
    if (this.isFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
      this.isFullscreen = false;
      return;
    }
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try {
        this.usingApi = true;
        await element.requestFullscreen({ navigationUI: 'hide' });
        this.isFullscreen = true;
        // Only works in real fullscreen, and only on some phones; elsewhere it's a no-op.
        if (this.args.landscape && window.matchMedia?.('(pointer: coarse)').matches) window.screen?.orientation?.lock?.('landscape').catch(() => {});
        return;
      } catch {
        this.usingApi = false;
        // refused (iframe without permission, etc.): fall back to covering the window
      }
    }
    this.isFullscreen = true;
  };

  <template>
    <div class="container {{if @game 'is-game'}}">
      <section class="hero pop-in">
        <div class="hero-icon"><Icon @name={{this.tool.icon}} @size={{28}} /></div>
        <div class="hero-text">
          <h1 class="hero-title">
            <span>{{this.tool.label}}</span>
            <FavouriteStar @route={{@route}} @size={{20}} />
          </h1>
          <p>{{@subtitle}}</p>
        </div>
        <div class="hero-actions">
          {{#if this.session}}
            <button type="button" class="fullscreen-btn" aria-label="Picture-in-picture" title="Picture-in-picture: keep it running in a small window while you use the rest of the site" {{on "click" this.popOut}}>
              <Icon @name="picture-in-picture" @size={{16}} />
            </button>
          {{/if}}
          <button type="button" class="fullscreen-btn" aria-label="Full screen" title="Full screen" {{on "click" this.toggleFullscreen}}>
            <Icon @name="maximize" @size={{16}} />
          </button>
        </div>
      </section>

      <div class="tool-body {{if this.isFullscreen 'is-fullscreen'}}" {{this.trackBody}}>
        {{#if this.isFullscreen}}
          <button type="button" class="fullscreen-exit" aria-label="Exit full screen" title="Exit full screen (Esc)" {{on "click" this.toggleFullscreen}}>
            <Icon @name="minimize" @size={{16}} />
          </button>
        {{/if}}
        {{yield}}
      </div>

      <section class="made-with pop-in">
        <h2 class="section-title">How it's made</h2>
        <p>{{this.tool.madeWith}}</p>
        {{#if this.tool.credits.length}}
          <h3 class="credit-heading">Libraries</h3>
          <CreditList @credits={{this.tool.credits}} />
        {{/if}}
      </section>
    </div>
  </template>
}
