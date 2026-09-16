import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import QRCodeStyling from 'qr-code-styling';
import Icon from './icon';
import CopyButton from './copy-button';

const eq = (a, b) => a === b;
const not = (a) => !a;
const canScan = () => typeof window.BarcodeDetector === 'function' && Boolean(navigator.mediaDevices?.getUserMedia);
const canShare = () => typeof navigator.share === 'function';

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
      .catch(() => (this.error = 'Couldn’t open the camera. Type the code in instead.'));
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  });

  <template>
    <div class="nearby-scan">
      {{#if @hint}}<p class="tool-hint">{{@hint}}</p>{{/if}}
      {{#if this.error}}
        <p class="tool-error">{{this.error}}</p>
      {{else}}
        <video class="nearby-video" muted playsinline {{this.camera}}></video>
      {{/if}}
      <button type="button" class="btn" {{on "click" @onClose}}><Icon @name="keyboard" @size={{13}} /> Type it in instead</button>
    </div>
  </template>
}

// Playing with no internet. A browser tab can't broadcast on the network or
// listen for connections the way a game console does (no raw sockets, no
// listening server — that's a security boundary all browsers share), so this
// is the closest thing: two devices on the same Wi-Fi or hotspot pair up
// directly over WebRTC. The only manual step left is trading two small codes,
// which happens by camera automatically wherever it can.
export default class NearbyPanel extends Component {
  canScan = canScan();
  canShare = canShare();

  @tracked wantsToJoin = false;
  @tracked invite = null;
  @tracked inviteState = '';
  @tracked reply = '';
  @tracked manualGuestSide = false;
  @tracked hostCode = '';
  @tracked replyCode = '';
  @tracked manualHostSide = false;
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

  // A rough count of seats spoken for: everyone already in, plus invites still pending an answer.
  get roomFull() {
    return this.room.members.length + this.room.lanInvites.length >= this.room.maxPlayers;
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

  hostNearby = () =>
    this.run(async () => {
      this.room.hostNearby();
      await this.createInvite();
    });

  // One invite, ready to be scanned. Called again automatically once someone joins.
  async createInvite() {
    if (this.invite && !this.inviteConnected) this.room.cancelInvite(this.invite);
    this.reply = '';
    this.inviteState = '';
    this.manualGuestSide = false;
    const invite = await this.room.inviteNearby();
    if (!invite) throw new Error('Couldn’t start hosting. Try again.');
    this.invite = invite;
    invite.connection.on('open', () => this.guestJoined());
  }

  newInvite = () => this.run(() => this.createInvite());

  // A guest just connected: say so for a moment, then line up the next code, unattended.
  guestJoined() {
    if (this.isDestroyed) return;
    this.inviteState = 'Connected!';
    if (this.roomFull) return;
    setTimeout(() => {
      if (!this.isDestroyed) this.run(() => this.createInvite());
    }, 900);
  }

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

  startJoining = () => (this.wantsToJoin = true);
  cancelJoining = () => {
    this.wantsToJoin = false;
    this.hostCode = '';
    this.error = '';
  };

  useManualGuestSide = () => (this.manualGuestSide = true);
  useCameraGuestSide = () => (this.manualGuestSide = false);
  useManualHostSide = () => (this.manualHostSide = true);
  useCameraHostSide = () => (this.manualHostSide = false);

  // Scanned while hosting, it's the guest's reply; scanned while joining, it's the host's invite.
  scanned = (text) => {
    if (this.hosting) this.acceptReply(text);
    else this.makeReply(text);
  };

  share = (code) => {
    navigator.share({ title: 'Woogi nearby game code', text: code }).catch(() => {});
  };

  <template>
    <div class="nearby">
      {{#if (eq this.room.status "joined")}}
        <p class="fs-status is-connected"><Icon @name="check" @size={{14}} /> Connected to the nearby host.</p>

      {{else if this.hosting}}
        <p class="tool-hint">Show your code below — a nearby player scans it, and you're connected as soon as your camera catches their reply. A fresh code lines up automatically for the next one.</p>

        {{#if this.invite}}
          <div class="nearby-live">
            <div class="nearby-code">
              <div class="nearby-qr" {{qr this.invite.code}}></div>
              <div class="fs-code-row">
                <span class="fs-link">{{this.invite.code}}</span>
                <CopyButton @value={{this.invite.code}} />
                {{#if this.canShare}}
                  <button type="button" class="btn" aria-label="Share this code" title="Share this code" {{on "click" (fn this.share this.invite.code)}}><Icon @name="share-2" @size={{13}} /></button>
                {{/if}}
              </div>
            </div>

            {{#if this.canScan}}
              {{#unless this.manualGuestSide}}
                <QrScanner @hint="Now hold your camera up to their reply" @onScan={{this.scanned}} @onClose={{this.useManualGuestSide}} />
              {{/unless}}
            {{/if}}

            {{#if (or this.manualGuestSide (not this.canScan))}}
              <textarea class="nearby-input" rows="3" placeholder="Paste their reply code" aria-label="Reply code" value={{this.reply}} {{on "input" this.setReply}}></textarea>
              <div class="nearby-actions">
                {{#if this.canScan}}<button type="button" class="btn" {{on "click" this.useCameraGuestSide}}><Icon @name="qr-code" @size={{13}} /> Scan instead</button>{{/if}}
                <button type="button" class="btn active" disabled={{if this.reply false true}} {{on "click" (fn this.acceptReply undefined)}}>Connect</button>
              </div>
            {{/if}}

            {{#if this.inviteState}}<p class="fs-status">{{this.inviteState}}</p>{{/if}}
          </div>
        {{/if}}

        {{#if this.roomFull}}
          <p class="fs-status is-connected"><Icon @name="check" @size={{14}} /> The game's full.</p>
        {{else}}
          <button type="button" class="btn" disabled={{this.working}} {{on "click" this.newInvite}}><Icon @name="rotate-cw" @size={{13}} /> Fresh code</button>
        {{/if}}

      {{else if (eq this.room.status "joining")}}
        <p class="tool-hint">Show this to the host, however you like — it connects the moment they get it.</p>
        <div class="nearby-code">
          <div class="nearby-qr" {{qr this.replyCode}}></div>
          <div class="fs-code-row">
            <span class="fs-link">{{this.replyCode}}</span>
            <CopyButton @value={{this.replyCode}} />
            {{#if this.canShare}}
              <button type="button" class="btn" aria-label="Share this code" title="Share this code" {{on "click" (fn this.share this.replyCode)}}><Icon @name="share-2" @size={{13}} /></button>
            {{/if}}
          </div>
        </div>
        <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> Waiting for the host…</p>

      {{else if this.wantsToJoin}}
        {{#if this.canScan}}
          {{#unless this.manualHostSide}}
            <QrScanner @hint="Point your camera at the host's code" @onScan={{this.scanned}} @onClose={{this.useManualHostSide}} />
          {{/unless}}
        {{/if}}
        {{#if (or this.manualHostSide (not this.canScan))}}
          <textarea class="nearby-input" rows="3" placeholder="Paste the host's invite code" aria-label="Invite code" value={{this.hostCode}} {{on "input" this.setHostCode}}></textarea>
          <div class="nearby-actions">
            {{#if this.canScan}}<button type="button" class="btn" {{on "click" this.useCameraHostSide}}><Icon @name="qr-code" @size={{13}} /> Scan instead</button>{{/if}}
            <button type="button" class="btn active" disabled={{this.joinDisabled}} {{on "click" (fn this.makeReply undefined)}}>Join</button>
          </div>
        {{/if}}
        <button type="button" class="btn" {{on "click" this.cancelJoining}}><Icon @name="arrow-left" @size={{13}} /> Back</button>

      {{else}}
        <p class="tool-hint">No internet? Get everyone on the same Wi-Fi or hotspot. One person hosts, everyone else joins — a phone camera does the rest.</p>
        <div class="nearby-actions">
          <button type="button" class="btn active" {{on "click" this.hostNearby}}><Icon @name="radio-tower" @size={{13}} /> Host nearby game</button>
          <button type="button" class="btn" {{on "click" this.startJoining}}><Icon @name="qr-code" @size={{13}} /> Join a nearby game</button>
        </div>
      {{/if}}
      {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
    </div>
  </template>
}

function or(a, b) {
  return a || b;
}
