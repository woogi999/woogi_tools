import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import { parseUserAgent } from '../utils/user-agent';
import { keepState } from '../utils/tool-state';

export default class UserAgentParserPage extends Component {
  @tracked ua = navigator.userAgent;

  get result() {
    return parseUserAgent(this.ua);
  }

  setUa = (e) => (this.ua = e.target.value);

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'user-agent-parser', ['ua']);
  }
  useMine = () => (this.ua = navigator.userAgent);
  clear = () => (this.ua = '');

  <template>
    <ToolPage
      @route="user-agent-parser"
      @subtitle="Paste a user agent string and we’ll tell you the browser, engine, OS and device hiding inside it."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <div class="field-head">
            <label class="field-label" for="ua-input">User agent string</label>
            <div class="settings-actions">
              <button type="button" class="btn" {{on "click" this.useMine}}>Use
                mine</button>
              <button
                type="button"
                class="btn"
                {{on "click" this.clear}}
              >Clear</button>
            </div>
          </div>
          <textarea
            id="ua-input"
            class="textarea"
            spellcheck="false"
            value={{this.ua}}
            {{on "input" this.setUa}}
          ></textarea>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Parsed</h3>
          {{#if this.result}}
            <div class="math-stats">
              <div class="math-stat"><span>Browser</span><strong>{{if
                    this.result.browser
                    this.result.browser.name
                    "Unknown"
                  }}{{#if this.result.browser.version}}
                    {{this.result.browser.version}}{{/if}}</strong></div>
              <div class="math-stat"><span>Engine</span><strong>{{if
                    this.result.engine
                    this.result.engine.name
                    "Unknown"
                  }}</strong></div>
              <div class="math-stat"><span>Operating system</span><strong>{{if
                    this.result.os
                    this.result.os.name
                    "Unknown"
                  }}{{#if this.result.os.version}}
                    {{this.result.os.version}}{{/if}}</strong></div>
              <div class="math-stat"><span>Device type</span><strong
                >{{this.result.deviceType}}</strong></div>
              {{#if this.result.bits}}<div class="math-stat"><span
                  >Architecture</span><strong
                  >{{this.result.bits}}</strong></div>{{/if}}
              {{#if this.result.isBot}}<div class="math-stat"><span
                  >Bot</span><strong>Looks like a crawler</strong></div>{{/if}}
            </div>
          {{else}}
            <p class="tool-hint">Paste a user agent string above to break it
              down.</p>
          {{/if}}
          <p class="tool-hint">Everything here is guessed from the text of the
            string; sites that spoof their user agent will fool this too.</p>
        </section>
      </div>
    </ToolPage>
  </template>
}
