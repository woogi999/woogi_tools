<script>
  import { prop } from '../core/helpers.js';
  // Public or private, and an optional password, for the host of a game room.
  let { room } = $props();

  const setListed = (listed) => room.setAccess({ listed });
  const setPassword = (event) =>
    room.setAccess({ password: event.target.value });
</script>

<div class="lobby-access">
  <div class="math-tabs" role="group" aria-label="Who can find the room">
    <button
      type="button"
      class="qr-tab {room.listed ? 'active' : ''}"
      aria-pressed={room.listed ? 'true' : 'false'}
      onclick={() => setListed(true)}>Public</button
    >
    <button
      type="button"
      class="qr-tab {room.listed ? '' : 'active'}"
      aria-pressed={room.listed ? 'false' : 'true'}
      onclick={() => setListed(false)}>Private</button
    >
  </div>
  <input
    type="password"
    class="fs-code-input lobby-password"
    placeholder="Password (optional)"
    aria-label="Room password"
    maxlength="32"
    autocomplete="new-password"
    {@attach prop('value', () => room.password)}
    oninput={setPassword}
  />
</div>
