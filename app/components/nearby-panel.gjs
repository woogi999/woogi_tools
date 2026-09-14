import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import QRCodeStyling from 'qr-code-styling';
import Icon from './icon';
import CopyButton from './copy-button';

const eq = (a, b) => a === b;
const canScan = () => typeof window.BarcodeDetector === 'function' && Boolean(navigator.mediaDevices?.getUserMedia);

// Draws a code as a QR image.
const qr = modifier((element, [data]) => {
  element.replaceChildren();
  if (!data) return;
  const code = new QRCodeStyling({ type: 'svg', width: 220, height: 220, margin: 6, data, qrOptions: { errorCorrectionLevel: 'L' }, dotsOptions: { type: 'square', color: '#141414' }, backgroundOptions: { color: '#ffffff' } });
  code.append(element);
});

// Reads QR codes from the camera, where the browser can (Chrome and Edge on Android, mostly).
class QrScanner extends Component {
  @tracked error = '';

  camera = modifier((video) => {
    let stream = null;
    let timer = null;
    let stopped = false;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.srcObject = s;
        video.play();
        timer = setInterval(async () => {
          try {
            const [found] = await detector.detect(video);
            if (found?.rawValue && !stopped) this.args.onScan(found.rawValue);
          } catch {
            // frame not ready yet
          }
        }, 350);
      })
      .catch(() => (this.error = 'Couldn’t open the camera. Paste the code instead.'));
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  });

  <template>
    <div class="nearby-scan">
      {{#if this.error}}
        <p class="tool-error">{{this.error}}</p>
      {{else}}
        <video class="nearby-video" muted playsinline {{this.camera}}></video>
      {{/if}}
      <button type="button" class="btn" {{on "click" @onClose}}><Icon @name="x" @size={{13}} /> Stop scanning</button>
    </div>
  </template>
}

// Playing with no internet: devices on the same Wi-Fi or hotspot connect
// directly by swapping two codes, shown as QR codes or copied across.
export default class NearbyPanel extends Component {
  canScan = canScan();

  @tracked invite = null;
  @tracked inviteState = '';
  @tracked reply = '';
  @tracked scanning = false;
  @tracked hostCode = '';
  @tracked replyCode = '';
  @tracked error = '';
  @tracked working = false;

  get room() {
    return this.args.room;
  }

  get hosting() {
    return this.room.status === 'open';
  }

  get joinDisabled() {
    return !this.hostCode.trim() || this.working;
  }

  get inviteConnected() {
    return this.invite && !this.room.lanInvites.includes(this.invite);
  }

  run = async (task) => {
    this.error = '';
    this.working = true;
    try {
      await task();
    } catch (error) {
      this.error = error?.message || 'That didn’t work. Check the code and try again.';
    } finally {
      this.working = false;
    }
  };

  hostNearby = () => this.room.hostNearby();

  newInvite = () =>
    this.run(async () => {
      if (this.invite && !this.inviteConnected) this.room.cancelInvite(this.invite);
      this.reply = '';
      this.inviteState = '';
      this.invite = await this.room.inviteNearby();
    });

  setReply = (event) => (this.reply = event.target.value);
  setHostCode = (event) => (this.hostCode = event.target.value);

  acceptReply = (code = this.reply) =>
    this.run(async () => {
      await this.room.acceptNearbyReply(this.invite, code);
      this.inviteState = 'Connecting…';
    });

  makeReply = (code = this.hostCode) =>
    this.run(async () => {
      this.replyCode = await this.room.joinNearby(code);
    });

  toggleScan = () => (this.scanning = !this.scanning);

  scanned = (text) => {
    this.scanning = false;
    if (this.hosting) {
      this.reply = text;
      this.acceptReply(text);
    } else {
      this.hostCode = text;
      this.makeReply(text);
    }
  };

  <template>
    <div class="nearby">
      {{#if (eq this.room.status "joined")}}
        <p class="fs-status is-connected"><Icon @name="check" @size={{14}} /> Connected to the nearby host.</p>
      {{else if this.hosting}}
        <p class="tool-hint">Each nearby player needs their own invite. Show them the QR code (or send the code), then scan or paste the reply their screen shows.</p>
        {{#if this.invite}}
          {{#if this.inviteConnected}}
            <p class="fs-status is-connected"><Icon @name="check" @size={{14}} /> Connected.</p>
          {{else}}
            <div class="nearby-code">
              <div class="nearby-qr" {{qr this.invite.code}}></div>
              <div class="fs-code-row"><span class="fs-link">{{this.invite.code}}</span><CopyButton @value={{this.invite.code}} /></div>
            </div>
            {{#if this.scanning}}
              <QrScanner @onScan={{this.scanned}} @onClose={{this.toggleScan}} />
            {{else}}
              <textarea class="nearby-input" rows="3" placeholder="Paste their reply code" aria-label="Reply code" value={{this.reply}} {{on "input" this.setReply}}></textarea>
              <div class="nearby-actions">
                {{#if this.canScan}}<button type="button" class="btn" {{on "click" this.toggleScan}}><Icon @name="qr-code" @size={{13}} /> Scan reply</button>{{/if}}
                <button type="button" class="btn active" disabled={{if this.reply false true}} {{on "click" (fn this.acceptReply undefined)}}>Connect</button>
              </div>
            {{/if}}
            {{#if this.inviteState}}<p class="fs-status">{{this.inviteState}}</p>{{/if}}
          {{/if}}
        {{/if}}
        <button type="button" class="btn" disabled={{this.working}} {{on "click" this.newInvite}}><Icon @name="user-plus" @size={{13}} /> {{if this.invite "Invite another nearby player" "Invite a nearby player"}}</button>
      {{else if (eq this.room.status "joining")}}
        <p class="tool-hint">Now show this reply to the host, or send it to them. The game connects as soon as they scan or paste it.</p>
        <div class="nearby-code">
          <div class="nearby-qr" {{qr this.replyCode}}></div>
          <div class="fs-code-row"><span class="fs-link">{{this.replyCode}}</span><CopyButton @value={{this.replyCode}} /></div>
        </div>
        <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> Waiting for the host…</p>
      {{else}}
        <p class="tool-hint">No internet? Get everyone on the same Wi-Fi or phone hotspot. One person hosts; everyone else joins with the host's invite.</p>
        <div class="nearby-actions">
          <button type="button" class="btn" {{on "click" this.hostNearby}}><Icon @name="radio-tower" @size={{13}} /> Host nearby game</button>
        </div>
        <span class="qr-label is-muted">Join a nearby game</span>
        {{#if this.scanning}}
          <QrScanner @onScan={{this.scanned}} @onClose={{this.toggleScan}} />
        {{else}}
          <textarea class="nearby-input" rows="3" placeholder="Paste the host's invite code" aria-label="Invite code" value={{this.hostCode}} {{on "input" this.setHostCode}}></textarea>
          <div class="nearby-actions">
            {{#if this.canScan}}<button type="button" class="btn" {{on "click" this.toggleScan}}><Icon @name="qr-code" @size={{13}} /> Scan invite</button>{{/if}}
            <button type="button" class="btn active" disabled={{this.joinDisabled}} {{on "click" (fn this.makeReply undefined)}}>Join</button>
          </div>
        {{/if}}
      {{/if}}
      {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
    </div>
  </template>
}
