<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import QRCodeStyling from 'qr-code-styling';
  import Icon from './icon.svelte';
  import QrScanner from './qr-scanner.svelte';
  import CopyButton from './copy-button.svelte';

  const eq = (a, b) => a === b;
  const not = (a) => !a;
  const canScan = () =>
    typeof window.BarcodeDetector === 'function' &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const canShare = () => typeof navigator.share === 'function';

  // Draws a code as a QR image.
  const qr = modifier((element, [data]) => {
    element.replaceChildren();
    if (!data) return;
    const code = new QRCodeStyling({
      type: 'svg',
      width: 220,
      height: 220,
      margin: 6,
      data,
      qrOptions: { errorCorrectionLevel: 'L' },
      dotsOptions: { type: 'square', color: '#141414' },
      backgroundOptions: { color: '#ffffff' },
    });
    code.append(element);
  });

  // Playing with no internet. A browser tab can't broadcast on the network or
  // listen for connections the way a game console does (no raw sockets, no
  // listening server, which is a security boundary all browsers share), so this
  // is the closest thing: two devices on the same Wi-Fi or hotspot pair up
  // directly over WebRTC. The only manual step left is trading two small codes,
  // which happens by camera automatically wherever it can.
  class NearbyPanel extends Component {
    canScan = canScan();
    canShare = canShare();

    wantsToJoin = $state.raw(false);
    invite = $state.raw(null);
    inviteState = $state.raw('');
    reply = $state.raw('');
    manualGuestSide = $state.raw(false);
    hostCode = $state.raw('');
    replyCode = $state.raw('');
    manualHostSide = $state.raw(false);
    error = $state.raw('');
    working = $state.raw(false);

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
      return (
        this.room.players.length + this.room.lanInvites.length >=
        this.room.maxPlayers
      );
    }

    run = async (task) => {
      this.error = '';
      this.working = true;
      try {
        await task();
      } catch (error) {
        this.error =
          error?.message || 'That didn’t work. Check the code and try again.';
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
      if (this.invite && !this.inviteConnected)
        this.room.cancelInvite(this.invite);
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
      navigator
        .share({ title: 'Woogi nearby game code', text: code })
        .catch(() => {});
    };
  }

  function or(a, b) {
    return a || b;
  }
</script>

<script>
  let args = $props();
  const self = new NearbyPanel(args);
  onDestroy(() => destroy(self));
</script>

<div class="nearby">
  {#if truthy(eq(self.room?.status, 'joined'))}
    <p class="fs-status is-connected"
      ><Icon name="check" size={14} />
      Connected to the nearby host.</p
    >
  {:else if truthy(self.hosting)}
    <p class="tool-hint"
      >Show your code below. A nearby player scans it, and you're connected as
      soon as your camera catches their reply. A fresh code lines up
      automatically for the next one.</p
    >

    {#if truthy(self.invite)}
      <div class="nearby-live">
        <div class="nearby-code">
          <div class="nearby-qr" {@attach qr([self.invite?.code])}></div>
          <div class="fs-code-row">
            <span class="fs-link">{self.invite?.code}</span>
            <CopyButton value={self.invite?.code} />
            {#if truthy(self.canShare)}
              <button
                type="button"
                class="btn"
                aria-label="Share this code"
                title="Share this code"
                onclick={(..._r) => self.share(self.invite?.code, ..._r)}
                ><Icon name="share-2" size={13} /></button
              >
            {/if}
          </div>
        </div>

        {#if truthy(self.canScan)}
          {#if !truthy(self.manualGuestSide)}
            <QrScanner
              hint="Now hold your camera up to their reply"
              onScan={self.scanned}
              onClose={self.useManualGuestSide}
            />
          {/if}
        {/if}

        {#if truthy(or(self.manualGuestSide, not(self.canScan)))}
          <textarea
            class="nearby-input"
            rows="3"
            placeholder="Paste their reply code"
            aria-label="Reply code"
            {@attach prop('value', () => self.reply)}
            oninput={self.setReply}></textarea>
          <div class="nearby-actions">
            {#if truthy(self.canScan)}<button
                type="button"
                class="btn"
                onclick={self.useCameraGuestSide}
                ><Icon name="qr-code" size={13} />
                Scan instead</button
              >{/if}
            <button
              type="button"
              class="btn active"
              disabled={truthy(self.reply) ? false : true}
              onclick={(..._r) => self.acceptReply(undefined, ..._r)}
              >Connect</button
            >
          </div>
        {/if}

        {#if truthy(self.inviteState)}<p class="fs-status">{self.inviteState}</p
          >{/if}
      </div>
    {/if}

    {#if truthy(self.roomFull)}
      <p class="fs-status is-connected"
        ><Icon name="check" size={14} />
        The game's full.</p
      >
    {:else}
      <button
        type="button"
        class="btn"
        disabled={self.working}
        onclick={self.newInvite}
        ><Icon name="rotate-cw" size={13} /> Fresh code</button
      >
    {/if}
  {:else if truthy(eq(self.room?.status, 'joining'))}
    <p class="tool-hint"
      >Show this to the host, however you like; it connects the moment they get
      it.</p
    >
    <div class="nearby-code">
      <div class="nearby-qr" {@attach qr([self.replyCode])}></div>
      <div class="fs-code-row">
        <span class="fs-link">{self.replyCode}</span>
        <CopyButton value={self.replyCode} />
        {#if truthy(self.canShare)}
          <button
            type="button"
            class="btn"
            aria-label="Share this code"
            title="Share this code"
            onclick={(..._r) => self.share(self.replyCode, ..._r)}
            ><Icon name="share-2" size={13} /></button
          >
        {/if}
      </div>
    </div>
    <p class="fs-status"
      ><Icon name="radio-tower" size={14} />
      Waiting for the host…</p
    >
  {:else if truthy(self.wantsToJoin)}
    {#if truthy(self.canScan)}
      {#if !truthy(self.manualHostSide)}
        <QrScanner
          hint="Point your camera at the host's code"
          onScan={self.scanned}
          onClose={self.useManualHostSide}
        />
      {/if}
    {/if}
    {#if truthy(or(self.manualHostSide, not(self.canScan)))}
      <textarea
        class="nearby-input"
        rows="3"
        placeholder="Paste the host's invite code"
        aria-label="Invite code"
        {@attach prop('value', () => self.hostCode)}
        oninput={self.setHostCode}></textarea>
      <div class="nearby-actions">
        {#if truthy(self.canScan)}<button
            type="button"
            class="btn"
            onclick={self.useCameraHostSide}
            ><Icon name="qr-code" size={13} />
            Scan instead</button
          >{/if}
        <button
          type="button"
          class="btn active"
          disabled={self.joinDisabled}
          onclick={(..._r) => self.makeReply(undefined, ..._r)}>Join</button
        >
      </div>
    {/if}
    <button type="button" class="btn" onclick={self.cancelJoining}
      ><Icon name="arrow-left" size={13} /> Back</button
    >
  {:else}
    <p class="tool-hint"
      >No internet? Get everyone on the same Wi-Fi or hotspot. One person hosts,
      everyone else joins, and a phone camera does the rest.</p
    >
    <div class="nearby-actions">
      <button type="button" class="btn active" onclick={self.hostNearby}
        ><Icon name="radio-tower" size={13} /> Host nearby game</button
      >
      <button type="button" class="btn" onclick={self.startJoining}
        ><Icon name="qr-code" size={13} /> Join a nearby game</button
      >
    </div>
  {/if}
  {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
</div>
