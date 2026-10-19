<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import ReadyButton from './ready-button.svelte';
  import AccessControls from './access-controls.svelte';
  import CopyButton from './copy-button.svelte';
  import AvatarPortrait from './avatar-portrait.svelte';
  import AvatarPicker from './avatar-picker.svelte';
  import GameChat from './game-chat.svelte';
  import NearbyPanel from './nearby-panel.svelte';
  import GameSettings from './game-settings.svelte';
  import GameRoom from '../utils/game-room.svelte.js';
  import { askConfirm } from '../utils/confirm.svelte.js';

  // The lobby every game shares. Everyone gathers here before a game starts:
  // the host adds computer players, sets the rules and presses Start; friends
  // join through a room code or invite link and see the same seats and rules.
  //
  // Args:
  //   @game         the game's id ('snake', 'mines', 'chess', 'woono'), which
  //                 puts that game's settings button in the lobby header
  //   @room         the page's GameRoom
  //   @seats        [{ id, name, avatar, kind: 'human' | 'bot', isHost, isYou }]
  //   @maxSeats     seat limit, for the counter and the Add button
  //   @onAddBot     when given, the host can add computer players
  //   @onRemoveBot  (seatId) removes one
  //   @levelEditor  this game has custom levels, so the lobby links to the editor
  //   @spectatable  the game can show a spectator its game, so the lobby offers
  //                 watching instead of playing
  //   @botLevels        { [seatId]: level }, with @botLevelOptions and
  //   @botLevelOptions  [{ id, label }]       @onSetBotLevel, each computer
  //   @onSetBotLevel    (seatId, level)       player gets its own difficulty
  //   @onStart      host only
  //   @startLabel   defaults to "Start game"
  //   @blocker      why the game can't start yet, or null
  // Blocks:
  //   <:rules as |canEdit|>  the game's own rules; guests get a read-only copy
  //   <:profile>             extra per-player settings (Chess's board options)
  class GameLobby extends Component {
    joinInput = $state.raw('');
    joinPassword = $state.raw('');
    rooms = $state.raw(null);
    browsing = $state.raw(false);
    pickingAvatar = $state.raw(false);
    presetName = $state.raw('');

    constructor(args) {
      super(args);
      // Coming back from the Avatar Editor or Settings: use the profile saved there.
      queueMicrotask(() => {
        if (!this.isDestroying) this.room.reloadProfile();
      });
    }

    get room() {
      return this.args.room;
    }

    get canEdit() {
      return this.room.isHost;
    }

    get seatCount() {
      return this.args.seats.length;
    }

    // Each computer player carries its own difficulty, so a lobby can mix an easy
    // one in for a newcomer with a hard one for everybody else. The host picks
    // them; a guest just sees what was picked.
    levelOf(seat) {
      return (
        this.args.botLevels?.[seat.id] ??
        this.args.botLevelOptions?.[0]?.id ??
        null
      );
    }

    showBotLevels = (seat) =>
      Boolean(
        seat.kind === 'bot' &&
        this.canEdit &&
        this.args.onSetBotLevel &&
        this.args.botLevelOptions?.length,
      );

    isBotLevel = (seat, level) => this.levelOf(seat) === level;

    // What a guest sees in place of the buttons.
    botLevelLabel = (seat) => {
      if (
        seat.kind !== 'bot' ||
        this.canEdit ||
        !this.args.botLevelOptions?.length
      )
        return null;
      return (
        this.args.botLevelOptions.find((l) => l.id === this.levelOf(seat))
          ?.label ?? null
      );
    };

    // ─── Spectators ────────────────────────────────────────────────────
    // Watching instead of playing. Anyone can choose it for themselves before the
    // game starts; the host can also move a guest either way.

    get spectators() {
      return this.room.spectators;
    }

    get iAmSpectating() {
      return this.room.iAmSpectating;
    }

    // The host can't watch their own game alone, and nobody can leave the game
    // with nobody in it.
    get canSpectate() {
      // Only games that can actually show a spectator something offer it.
      if (!this.args.spectatable) return false;
      // Anyone can watch, the host included: sitting out to watch the computer
      // players go at each other is a reasonable thing to want. The only rule is
      // that somebody has to be left on the field, and a computer player counts,
      // so a lone host can drop out as long as they have added one.
      // Coming back needs a free seat, or the room would be over its limit.
      if (this.iAmSpectating) return !this.room.seatsFull;
      return this.seatCount > 1;
    }

    toggleSpectating = () => this.room.setSpectating(!this.iAmSpectating);
    unspectate = (id) => this.room.setSpectatingFor(id, false);

    get canAddBot() {
      return (
        this.args.onAddBot &&
        this.canEdit &&
        this.seatCount < this.args.maxSeats
      );
    }

    get statusLabel() {
      switch (this.room.status) {
        case 'opening':
          return 'Opening room…';
        case 'open':
          return `Room ${this.room.code}`;
        case 'joining':
          return `Joining ${this.room.code}…`;
        case 'joined':
          return `In room ${this.room.code}`;
        default:
          return 'Local lobby';
      }
    }

    pickAvatar = (look) => this.room.setProfile(look);
    toggleAvatarPicker = () => (this.pickingAvatar = !this.pickingAvatar);

    // Saved rule sets.
    setPresetName = (event) => (this.presetName = event.target.value);
    savePreset = (event) => {
      event.preventDefault();
      this.room.savePreset(this.presetName);
      this.presetName = '';
    };
    applyPreset = (event) => {
      if (event.target.value) this.room.applyPreset(event.target.value);
      event.target.value = '';
    };
    deletePreset = async (id) => {
      const preset = this.room.presets.find((p) => p.id === id);
      if (
        !(await askConfirm({
          title: `Delete “${preset?.name ?? 'these rules'}”?`,
          message:
            'The saved rule set will be removed. The rules you’re using now stay as they are.',
          confirmLabel: 'Hold to delete',
          cancelLabel: 'Cancel',
          holdMs: 1500,
        }))
      )
        return;
      this.room.deletePreset(id);
    };
    resetRules = () => this.room.resetSettings();
    setName = (event) => this.room.setProfile({ name: event.target.value });
    setJoinInput = (event) => (this.joinInput = event.target.value);
    setJoinPassword = (event) => (this.joinPassword = event.target.value);

    // The password box shows up once a room has asked for one.
    get showJoinPassword() {
      return Boolean(this.room.needsPassword) || Boolean(this.joinPassword);
    }

    // Connecting over the internet; nearby links show their progress in their own panel.
    get onlineBusy() {
      return this.room.isBusy && !this.room.lan;
    }

    // Joined someone's room online: nothing nearby to set up.
    get hideNearby() {
      return (
        (this.room.status === 'joined' ||
          this.room.status === 'joining' ||
          this.room.status === 'opening') &&
        !this.room.lan
      );
    }

    join = (event) => {
      event.preventDefault();
      if (this.room.needsPassword && !this.joinInput)
        this.joinInput = this.room.needsPassword;
      this.room.join(
        this.joinInput || this.room.needsPassword,
        this.joinPassword,
      );
    };

    browse = async () => {
      this.browsing = true;
      try {
        this.rooms = await GameRoom.browse(this.room.game);
      } catch {
        this.rooms = [];
      } finally {
        this.browsing = false;
      }
    };

    joinListed = (listed) => {
      this.joinInput = listed.code;
      if (listed.password && !this.joinPassword) {
        // Ask for the password first; the box appears next to the code.
        this.room.needsPassword = listed.code;
        return;
      }
      this.room.join(listed.code, this.joinPassword);
    };

    host = () => this.room.host();
    kick = (id) => this.room.kick(id);

    // Closing a room with people in it, or leaving one you've joined, asks first.
    leaveRoom = async () => {
      const hosting = this.room.status === 'open' && this.room.guests.length;
      const joined = this.room.status === 'joined';
      if (hosting || joined) {
        const ok = await askConfirm(
          hosting
            ? {
                title: 'Close the room?',
                message: 'Everyone in it will be disconnected.',
                confirmLabel: 'Hold to close',
                cancelLabel: 'Keep it open',
                holdMs: 1500,
              }
            : {
                title: 'Leave the room?',
                message: 'You’ll need the code or link to join again.',
                confirmLabel: 'Hold to leave',
                cancelLabel: 'Stay',
                holdMs: 1500,
              },
        );
        if (!ok) return;
      }
      this.room.close();
    };

    get hasGuests() {
      return this.room.status === 'open' && this.room.guests.length > 0;
    }

    get startDisabled() {
      return (
        Boolean(this.args.blocker) || this.room.isBusy || !this.room.allReady
      );
    }

    readyCheck = () => this.room.callReadyCheck();
  }

  function full(room) {
    return room.players >= room.max;
  }

  function isBot(seat) {
    return seat.kind === 'bot';
  }

  function eq(a, b) {
    return a === b;
  }
</script>

<script>
  let args = $props();
  const self = new GameLobby(args);
  onDestroy(() => destroy(self));
</script>

<div class="game-lobby pop-in">
  <header class="lobby-head">
    <h2 class="lobby-heading">Lobby</h2>
    <span class="lobby-count"
      ><Icon name="users" size={13} />
      {self.seatCount}/{args.maxSeats}</span
    >
    {#if truthy(args.onLevelEditor)}
      <button
        type="button"
        class="qr-icon-btn lobby-editor-btn"
        title="Level Editor: draw your own map for this game"
        aria-label="Level Editor"
        onclick={args.onLevelEditor}><Icon name="grid-3x3" size={15} /></button
      >
    {/if}
    {#if truthy(args.game)}
      <GameSettings game={args.game} compact={true} />
    {/if}
  </header>

  <div class="lobby-grid">
    <section class="lobby-panel lobby-players" aria-label="Players">
      <h3 class="lobby-panel-title"
        ><Icon name="users" size={14} />
        Players</h3
      >
      <ul class="lobby-seats">
        {#each args.seats ?? [] as seat (seat?.id)}
          <li class="lobby-seat {truthy(seat?.isYou) ? 'is-you' : ''} pop-in">
            {#if truthy(seat?.avatar)}
              <AvatarPortrait
                avatar={seat?.avatar}
                pose={seat?.pose}
                size={40}
              />
            {:else}
              <span class="lobby-seat-bot"><Icon name="bot" size={20} /></span>
            {/if}
            <span class="lobby-seat-text">
              <span class="lobby-seat-name">{seat?.name}</span>
              <span class="lobby-seat-tags">
                {#if truthy(seat?.isYou)}<span class="lobby-tag">You</span>{/if}
                {#if truthy(seat?.isHost)}<span class="lobby-tag is-host"
                    ><Icon name="crown" size={10} />
                    Host</span
                  >{/if}
                {#if truthy(isBot(seat))}<span class="lobby-tag">Computer</span
                  >{/if}
                {#if truthy(self.room?.isOnline)}
                  {#if !truthy(isBot(seat))}
                    {#if !truthy(seat?.isHost)}
                      <span
                        class="lobby-tag lobby-ready-tag
                              {truthy(seat?.ready) ? 'is-ready' : ''}"
                        ><Icon
                          name={truthy(seat?.ready) ? 'check' : 'clock'}
                          size={10}
                        />
                        {truthy(seat?.ready) ? 'Ready' : 'Not ready'}</span
                      >
                    {/if}
                  {/if}
                {/if}
              </span>
              {#if truthy(self.showBotLevels(seat))}
                <span
                  class="lobby-seat-levels"
                  role="group"
                  aria-label="{seat?.name} difficulty"
                >
                  {#each args.botLevelOptions ?? [] as l (l?.id)}
                    <button
                      type="button"
                      class="lobby-level
                            {truthy(self.isBotLevel(seat, l?.id))
                        ? 'active'
                        : ''}"
                      aria-pressed={truthy(self.isBotLevel(seat, l?.id))
                        ? 'true'
                        : 'false'}
                      title="{seat?.name}: {l?.label}"
                      onclick={(..._r) =>
                        args.onSetBotLevel(seat?.id, l?.id, ..._r)}
                      >{l?.label}</button
                    >
                  {/each}
                </span>
              {:else if truthy(self.botLevelLabel(seat))}
                <span class="lobby-seat-tags"
                  ><span class="lobby-tag">{self.botLevelLabel(seat)}</span
                  ></span
                >
              {/if}
            </span>
            {#if truthy(self.canEdit)}
              {#if truthy(isBot(seat))}
                {#if truthy(args.onRemoveBot)}
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="Remove {seat?.name}"
                    onclick={(..._r) => args.onRemoveBot(seat?.id, ..._r)}
                    ><Icon name="x" size={14} /></button
                  >
                {/if}
              {:else}
                {#if !truthy(seat?.isYou)}
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="Remove {seat?.name} from the room"
                    title="Remove from room"
                    onclick={(..._r) => self.kick(seat?.id, ..._r)}
                    ><Icon name="log-out" size={14} /></button
                  >
                {/if}
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
      {#if truthy(self.canSpectate)}
        <button
          type="button"
          class="lobby-add {truthy(self.iAmSpectating) ? 'active' : ''}"
          aria-pressed={truthy(self.iAmSpectating) ? 'true' : 'false'}
          onclick={self.toggleSpectating}
          ><Icon name="eye" size={14} />
          {truthy(self.iAmSpectating)
            ? 'Join the game'
            : 'Watch instead of playing'}</button
        >
      {/if}

      {#if truthy(self.spectators?.length)}
        <h3 class="lobby-panel-title lobby-spectator-title"
          ><Icon name="eye" size={14} />
          Watching ({self.spectators?.length})</h3
        >
        <ul class="lobby-seats lobby-spectators">
          {#each self.spectators ?? [] as seat (seat?.id)}
            <li class="lobby-seat is-spectator pop-in">
              {#if truthy(seat?.avatar)}
                <AvatarPortrait
                  avatar={seat?.avatar}
                  pose={seat?.pose}
                  size={28}
                />
              {:else}
                <span class="lobby-seat-bot"><Icon name="eye" size={14} /></span
                >
              {/if}
              <span class="lobby-seat-text">
                <span class="lobby-seat-name">{seat?.name}</span>
                {#if truthy(seat?.isYou)}<span class="lobby-seat-tags"
                    ><span class="lobby-tag">You</span></span
                  >{/if}
              </span>
              {#if truthy(self.canEdit)}
                {#if !truthy(seat?.isYou)}
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="Put {seat?.name} back in the game"
                    title={truthy(self.room?.seatsFull)
                      ? 'No free seat'
                      : 'Back in the game'}
                    disabled={self.room?.seatsFull}
                    onclick={(..._r) => self.unspectate(seat?.id, ..._r)}
                    ><Icon name="users" size={14} /></button
                  >
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if truthy(self.canAddBot)}
        <button type="button" class="lobby-add" onclick={args.onAddBot}
          ><Icon name="plus" size={14} /> Add computer player</button
        >
      {/if}

      <div class="lobby-invite">
        {#if truthy(eq(self.room?.status, 'open'))}
          {#if truthy(self.room?.lan)}
            <p class="fs-status is-connected"
              ><Icon name="radio-tower" size={14} />
              Nearby game open. No internet needed.</p
            >
          {:else}
            <div class="fs-code-block">
              <span class="qr-label is-muted">Room code</span>
              <div class="fs-code-row">
                <span class="fs-code">{self.room?.code}</span>
                <CopyButton value={self.room?.code} />
              </div>
            </div>
            <div class="fs-code-block">
              <span class="qr-label is-muted">Invite link</span>
              <div class="fs-code-row">
                <span class="fs-link">{self.room?.shareUrl}</span>
                <CopyButton value={self.room?.shareUrl} />
              </div>
            </div>
            <AccessControls room={self.room} />
            <p class="fs-status is-connected">
              <Icon
                name={truthy(self.room?.listed) ? 'users' : 'lock'}
                size={14}
              />
              {#if truthy(self.room?.listed)}
                {truthy(self.room?.listing)
                  ? 'Public: listed for anyone browsing rooms.'
                  : 'Public: getting listed…'}
              {:else}
                Private: only people with the code or link can join.
              {/if}
              {#if truthy(self.room?.password)}
                Password needed.{/if}
            </p>
          {/if}
          <button type="button" class="fs-reset" onclick={self.leaveRoom}
            ><Icon name="x" size={13} /> Close room</button
          >
        {:else if truthy(self.onlineBusy)}
          <p class="fs-status"
            ><Icon name="radio-tower" size={14} />
            {self.statusLabel}</p
          >
          {#if truthy(self.room?.slow)}
            <p class="tool-hint"
              >Still looking. Keep this tab open. If it never connects, one of
              the networks (often mobile data, work or school Wi-Fi) is blocking
              direct browser-to-browser connections; try both devices on the
              same Wi-Fi, or play nearby below.</p
            >
          {/if}
          <button type="button" class="fs-reset" onclick={self.leaveRoom}
            ><Icon name="x" size={13} /> Cancel</button
          >
        {:else if truthy(eq(self.room?.status, 'joined'))}
          <p class="fs-status is-connected"
            ><Icon name="radio-tower" size={14} />
            Connected to the host.</p
          >
          <button type="button" class="fs-reset" onclick={self.leaveRoom}
            ><Icon name="log-out" size={13} /> Leave room</button
          >
        {:else if truthy(eq(self.room?.status, 'idle'))}
          <span class="qr-label is-muted">Play with friends online</span>
          <AccessControls room={self.room} />
          <button type="button" class="btn lobby-open-btn" onclick={self.host}
            ><Icon
              name={truthy(self.room?.listed) ? 'radio-tower' : 'lock'}
              size={13}
            />
            {truthy(self.room?.listed)
              ? 'Open public room'
              : 'Open private room'}</button
          >
          <form class="fs-join" onsubmit={self.join}>
            <input
              type="text"
              class="fs-code-input"
              placeholder="Room code"
              aria-label="Room code"
              maxlength="8"
              {@attach prop('value', () => self.joinInput)}
              oninput={self.setJoinInput}
            />
            {#if truthy(self.showJoinPassword)}
              <input
                type="password"
                class="fs-code-input lobby-password"
                placeholder="Password"
                aria-label="Room password"
                maxlength="32"
                {@attach prop('value', () => self.joinPassword)}
                oninput={self.setJoinPassword}
              />
            {/if}
            <button type="submit" class="btn">Join</button>
          </form>
          <div class="lobby-browse">
            <button
              type="button"
              class="btn"
              disabled={self.browsing}
              onclick={self.browse}
              ><Icon name="search" size={13} />
              {truthy(self.browsing)
                ? 'Looking for rooms…'
                : 'Browse public rooms'}</button
            >
            {#if truthy(self.rooms)}
              {#if truthy(self.rooms?.length)}
                <ul class="lobby-rooms">
                  {#each self.rooms ?? [] as r}
                    <li class="lobby-room">
                      <span class="lobby-room-text"
                        ><strong>{r?.host}’s room</strong>
                        <span class="lobby-tag">{r?.players}/{r?.max}</span
                        >{#if truthy(r?.password)}
                          <Icon
                            name="lock"
                            size={12}
                          />{/if}{#if truthy(r?.locked)}
                          <span class="lobby-tag">Playing</span>{/if}</span
                      >
                      <button
                        type="button"
                        class="btn"
                        disabled={truthy(r?.locked) ? true : full(r)}
                        onclick={(..._r) => self.joinListed(r, ..._r)}
                        >Join</button
                      >
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="tool-hint"
                  >No public rooms right now. Open one and your friends will see
                  it here.</p
                >
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      {#if !truthy(self.hideNearby)}
        <details class="lobby-nearby" open={self.room?.lan}>
          <summary
            ><Icon name="wifi" size={14} />
            Play nearby without internet (Wi-Fi or hotspot)</summary
          >
          <NearbyPanel room={self.room} />
        </details>
      {/if}
    </section>

    <section class="lobby-panel lobby-rules" aria-label="Rules">
      <h3 class="lobby-panel-title">
        <Icon name="sliders-horizontal" size={14} />
        Rules
        {#if !truthy(self.canEdit)}<span class="lobby-tag">Set by the host</span
          >{/if}
      </h3>
      {#if truthy(self.canEdit)}
        <div class="lobby-presets">
          <p class="tool-hint lobby-presets-note"
            ><Icon name="save" size={12} />
            Your rules are remembered for next time.</p
          >
          <div class="lobby-presets-row">
            {#if truthy(self.room?.presets?.length)}
              <select
                class="lobby-preset-select"
                aria-label="Load saved rules"
                onchange={self.applyPreset}
              >
                <option value="">Load saved rules…</option>
                {#each self.room?.presets ?? [] as p (p?.id)}
                  <option value={p?.id}>{p?.name}</option>
                {/each}
              </select>
            {/if}
            <form class="lobby-preset-save" onsubmit={self.savePreset}>
              <input
                type="text"
                maxlength="32"
                placeholder="Name these rules"
                aria-label="Name for these rules"
                {@attach prop('value', () => self.presetName)}
                oninput={self.setPresetName}
              />
              <button type="submit" class="btn"
                ><Icon name="save" size={13} />
                Save</button
              >
            </form>
            <button
              type="button"
              class="btn"
              title="Back to the default rules"
              onclick={self.resetRules}
              ><Icon name="rotate-ccw" size={13} /> Defaults</button
            >
          </div>
          {#if truthy(self.room?.presets?.length)}
            <ul class="lobby-preset-chips" aria-label="Saved rules">
              {#each self.room?.presets ?? [] as p (p?.id)}
                <li class="lobby-tag lobby-preset-chip"
                  >{p?.name}<button
                    type="button"
                    class="lobby-preset-remove"
                    aria-label="Delete saved rules {p?.name}"
                    onclick={(..._r) => self.deletePreset(p?.id, ..._r)}
                    ><Icon name="x" size={10} /></button
                  ></li
                >
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      <fieldset
        class="lobby-rules-body"
        disabled={truthy(self.canEdit) ? false : true}
      >
        {@render args.rules?.(self.canEdit)}
      </fieldset>
    </section>
  </div>

  <div class="lobby-grid">
    <section class="lobby-panel lobby-profile" aria-label="Your profile">
      <h3 class="lobby-panel-title"
        ><Icon name="user-round" size={14} />
        You</h3
      >
      <div class="lobby-profile-row">
        <AvatarPortrait
          avatar={self.room?.profile?.avatar}
          pose={self.room?.profile?.pose}
          size={52}
        />
        <label class="lobby-name">
          <span class="qr-label is-muted">Name</span>
          <input
            type="text"
            maxlength="20"
            {@attach prop('value', () => self.room?.profile?.name)}
            oninput={self.setName}
          />
        </label>
        <button
          type="button"
          class="btn lobby-avatar-toggle {truthy(self.pickingAvatar)
            ? 'active'
            : ''}"
          aria-expanded={truthy(self.pickingAvatar) ? 'true' : 'false'}
          onclick={self.toggleAvatarPicker}
        >
          <Icon name="shirt" size={13} />
          {truthy(self.pickingAvatar) ? 'Done' : 'Change avatar'}
        </button>
      </div>
      {#if truthy(self.pickingAvatar)}
        <AvatarPicker profile={self.room?.profile} onPick={self.pickAvatar} />
      {/if}
      {@render args.profile?.()}
    </section>

    <GameChat room={self.room} class="lobby-panel lobby-chat" />
  </div>

  <footer class="lobby-foot">
    {#if truthy(self.room?.error)}
      <p class="tool-error">{self.room?.error}</p>
    {:else if truthy(args.blocker)}
      <p class="tool-hint">{args.blocker}</p>
    {:else if truthy(self.canEdit)}
      {#if truthy(self.room?.allReady)}
        <p class="tool-hint">Everyone’s ready. Start when you are.</p>
      {:else}
        <p class="tool-hint"
          >Waiting for everyone to press Ready ({self.room?.readyCount}/{self
            .room?.players?.length}).</p
        >
      {/if}
    {:else if truthy(self.room?.iAmReady)}
      <p class="tool-hint"
        >You’re ready. Waiting for the host to start the game…</p
      >
    {:else}
      <p
        class="tool-hint {truthy(self.room?.readyCheckAt)
          ? 'lobby-ready-nudge'
          : ''}"
        >{truthy(self.room?.readyCheckAt)
          ? 'The host is asking if you’re ready!'
          : 'Press Ready when you’re set to play.'}</p
      >
    {/if}
    {#if truthy(self.canEdit)}
      {#if truthy(self.hasGuests)}
        <button
          type="button"
          class="btn"
          disabled={self.room?.allReady}
          title="Ask everyone to press Ready"
          onclick={self.readyCheck}
          ><Icon name="bell-ring" size={14} /> Ready check</button
        >
      {/if}
      <button
        type="button"
        class="btn active lobby-start"
        disabled={self.startDisabled}
        onclick={args.onStart}
      >
        <Icon name="play" size={14} />
        {truthy(args.startLabel) ? args.startLabel : 'Start game'}
      </button>
    {:else if truthy(self.room?.isOnline)}
      <ReadyButton room={self.room} />
    {/if}
  </footer>
</div>
