<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { parseUserAgent } from '../utils/user-agent.js';
  import { keepState } from '../utils/tool-state.js';

  class UserAgentParserPage extends Component {
    ua = $state.raw(navigator.userAgent);

    get result() {
      return parseUserAgent(this.ua);
    }

    setUa = (e) => (this.ua = e.target.value);

    constructor(args) {
      super(args);
      keepState(this, 'user-agent-parser', ['ua']);
    }
    useMine = () => (this.ua = navigator.userAgent);
    clear = () => (this.ua = '');
  }
</script>

<script>
  let args = $props();
  const self = new UserAgentParserPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="user-agent-parser"
  subtitle="Paste a user agent string and we’ll tell you the browser, engine, OS and device hiding inside it."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <div class="field-head">
        <label class="field-label" for="ua-input">User agent string</label>
        <div class="settings-actions">
          <button type="button" class="btn" onclick={self.useMine}
            >Use mine</button
          >
          <button type="button" class="btn" onclick={self.clear}>Clear</button>
        </div>
      </div>
      <textarea
        id="ua-input"
        class="textarea"
        spellcheck="false"
        {@attach prop('value', () => self.ua)}
        oninput={self.setUa}></textarea>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Parsed</h3>
      {#if truthy(self.result)}
        <div class="math-stats">
          <div class="math-stat"
            ><span>Browser</span><strong
              >{truthy(self.result?.browser)
                ? self.result?.browser?.name
                : 'Unknown'}{#if truthy(self.result?.browser?.version)}
                {self.result?.browser?.version}{/if}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Engine</span><strong
              >{truthy(self.result?.engine)
                ? self.result?.engine?.name
                : 'Unknown'}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Operating system</span><strong
              >{truthy(self.result?.os)
                ? self.result?.os?.name
                : 'Unknown'}{#if truthy(self.result?.os?.version)}
                {self.result?.os?.version}{/if}</strong
            ></div
          >
          <div class="math-stat"
            ><span>Device type</span><strong>{self.result?.deviceType}</strong
            ></div
          >
          {#if truthy(self.result?.bits)}<div class="math-stat"
              ><span>Architecture</span><strong>{self.result?.bits}</strong
              ></div
            >{/if}
          {#if truthy(self.result?.isBot)}<div class="math-stat"
              ><span>Bot</span><strong>Looks like a crawler</strong></div
            >{/if}
        </div>
      {:else}
        <p class="tool-hint"
          >Paste a user agent string above to break it down.</p
        >
      {/if}
      <p class="tool-hint"
        >Everything here is guessed from the text of the string; sites that
        spoof their user agent will fool this too.</p
      >
    </section>
  </div>
</ToolPage>
