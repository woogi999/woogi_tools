import { tracked } from '@glimmer/tracking';

// Voice calls, video calls and screen sharing for Messages.
//
// A call is a mesh, not a conference: every device in the call holds a direct
// WebRTC media connection to every other device in it, so there is no server
// mixing anything and no host whose leaving ends the call. Small groups are
// what this is for; a mesh sends your own camera once per person, so four or
// five people is comfortable and twenty is not.
//
// Whose job it is to dial: when two devices are both in the call, the one
// with the lower device id places the media connection. Without that rule
// both sides ring each other at the same moment and the call comes up twice.
//
// Where the media goes: the same route the chat itself takes (see
// mesh-chat.js). Direct between the two networks wherever they allow it, and
// through the Open Relay Project's free public relay when they don't, never
// through this site's own Cloudflare relay.

const AUDIO = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export default class MeshCall {
  // '' (no call) | 'ringing' (we started it, nobody in yet) | 'incoming' | 'in'
  @tracked state = '';
  @tracked chatId = '';
  // 'audio' | 'video'
  @tracked mode = 'audio';
  @tracked micOn = true;
  @tracked camOn = false;
  @tracked sharing = false;
  @tracked error = '';
  // { chatId, from, name, mode } while someone is ringing this device.
  @tracked incoming = null;
  // [{ device, name, stream }], the other people in the call.
  @tracked participants = [];
  @tracked localStream = null;

  media = new Map(); // device id -> PeerJS MediaConnection
  streams = new Map(); // device id -> MediaStream
  cameraTrack = null;
  screenTrack = null;

  constructor(mesh) {
    this.mesh = mesh;
    this.detach = mesh.addSignalHandler({
      onCallSignal: (chatId, from, payload) =>
        this.onSignal(chatId, from, payload),
      onMediaCall: (incoming) => this.onMediaCall(incoming),
      onPeerGone: (device) => this.removeParticipant(device),
    });
  }

  destroy() {
    this.detach?.();
    this.hangUp();
  }

  get active() {
    return this.state === 'ringing' || this.state === 'in';
  }

  get canShare() {
    return typeof navigator?.mediaDevices?.getDisplayMedia === 'function';
  }

  nameOf(device) {
    const view = this.mesh.views.get(this.chatId || this.mesh.activeId);
    return view?.members.get(device)?.name ?? 'Someone';
  }

  // ─── Starting, joining, leaving ──────────────────────────────────────

  async start(chatId, mode = 'audio') {
    if (this.active || !chatId) return;
    this.error = '';
    try {
      await this.openLocal(mode === 'video');
    } catch (error) {
      this.error = deviceError(error);
      return;
    }
    this.chatId = chatId;
    this.mode = mode;
    this.state = 'ringing';
    this.mesh.broadcast(chatId, { t: 'call', action: 'ring', mode });
    // A call that happened is worth a line in the history, so someone who was
    // away can see they missed one.
    this.mesh.note(chatId, mode === 'video' ? 'video' : 'voice');
  }

  async accept() {
    const call = this.incoming;
    if (!call) return;
    this.incoming = null;
    this.error = '';
    try {
      await this.openLocal(call.mode === 'video');
    } catch (error) {
      this.error = deviceError(error);
      this.mesh.broadcast(call.chatId, { t: 'call', action: 'leave' });
      return;
    }
    this.chatId = call.chatId;
    this.mode = call.mode;
    this.state = 'in';
    // Everyone already in the call finds out there is someone new to dial.
    this.mesh.broadcast(call.chatId, {
      t: 'call',
      action: 'join',
      mode: call.mode,
    });
  }

  decline() {
    const call = this.incoming;
    this.incoming = null;
    if (call)
      this.mesh.broadcast(call.chatId, { t: 'call', action: 'decline' });
  }

  hangUp() {
    const chatId = this.chatId;
    for (const connection of this.media.values()) connection.close();
    this.media.clear();
    this.streams.clear();
    this.participants = [];
    this.stopLocal();
    this.state = '';
    this.chatId = '';
    this.sharing = false;
    this.camOn = false;
    this.micOn = true;
    if (chatId) this.mesh.broadcast(chatId, { t: 'call', action: 'leave' });
  }

  // ─── Signals from the other devices ──────────────────────────────────

  onSignal(chatId, from, payload) {
    const action = payload?.action;
    if (action === 'ring') {
      // Already in this call: their ring is as good as a join.
      if (this.active && this.chatId === chatId) {
        this.dialIfOurs(from);
        return;
      }
      if (this.active || this.incoming) return; // busy elsewhere
      this.incoming = {
        chatId,
        from,
        name: this.mesh.views.get(chatId)?.members.get(from)?.name ?? 'Someone',
        mode: payload.mode === 'video' ? 'video' : 'audio',
      };
      return;
    }
    if (action === 'join' && this.active && this.chatId === chatId) {
      if (this.state === 'ringing') this.state = 'in';
      this.dialIfOurs(from);
      return;
    }
    if (action === 'leave' || action === 'decline') {
      if (this.incoming?.from === from) this.incoming = null;
      this.removeParticipant(from);
      // The last person leaving a two-person call ends it rather than leaving
      // you sitting in an empty room.
      if (this.state === 'in' && !this.participants.length) this.hangUp();
    }
  }

  dialIfOurs(device) {
    if (this.media.has(device)) return;
    if (this.mesh.selfId > device) return; // they dial us
    this.place(device);
  }

  async place(device) {
    const peerId = await this.mesh.peerIdOf(device);
    const peer = this.mesh.peer;
    if (!peer || !this.localStream) return;
    const connection = peer.call(peerId, this.localStream, {
      metadata: { chat: this.chatId, from: this.mesh.selfId, mode: this.mode },
    });
    if (connection) this.hold(device, connection);
  }

  onMediaCall(incoming) {
    const meta = incoming.metadata ?? {};
    const from = typeof meta.from === 'string' ? meta.from : '';
    // Only a device we already hold an authenticated chat connection to may
    // ring this one, so knowing a peer id isn't enough to be answered.
    const allowed =
      from &&
      this.active &&
      meta.chat === this.chatId &&
      this.mesh.onlineInChat(this.chatId).includes(from);
    if (!allowed || !this.localStream) {
      incoming.close();
      return;
    }
    incoming.answer(this.localStream);
    if (this.state === 'ringing') this.state = 'in';
    this.hold(from, incoming);
  }

  hold(device, connection) {
    // A connection placed again (see replaceConnections) replaces the old one
    // rather than leaving it open and unwatched.
    const previous = this.media.get(device);
    if (previous && previous !== connection) previous.close();
    this.media.set(device, connection);
    connection.on('stream', (stream) => {
      this.streams.set(device, stream);
      this.refreshParticipants();
    });
    connection.on('close', () => this.removeParticipant(device));
    connection.on('error', () => this.removeParticipant(device));
  }

  removeParticipant(device) {
    const connection = this.media.get(device);
    if (connection) connection.close();
    this.media.delete(device);
    this.streams.delete(device);
    this.refreshParticipants();
  }

  refreshParticipants() {
    this.participants = [...this.streams].map(([device, stream]) => ({
      device,
      name: this.nameOf(device),
      stream,
    }));
  }

  // ─── The local camera, microphone and screen ─────────────────────────

  async openLocal(withVideo) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO,
      video: withVideo
        ? { width: { ideal: 1280 }, height: { ideal: 720 } }
        : false,
    });
    this.localStream = stream;
    this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    this.micOn = true;
    this.camOn = Boolean(this.cameraTrack);
  }

  stopLocal() {
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.screenTrack?.stop();
    this.localStream = null;
    this.cameraTrack = null;
    this.screenTrack = null;
  }

  toggleMic = () => {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.micOn = track.enabled;
  };

  toggleCam = async () => {
    if (this.sharing) return; // the screen is using the video slot
    if (this.cameraTrack) {
      // A camera that is only disabled still shows as in use, so it is
      // stopped outright and asked for again when it is wanted back.
      this.cameraTrack.stop();
      this.localStream.removeTrack(this.cameraTrack);
      this.cameraTrack = null;
      this.camOn = false;
      await this.sendVideo(null);
      return;
    }
    try {
      const extra = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const track = extra.getVideoTracks()[0];
      this.cameraTrack = track;
      this.localStream.addTrack(track);
      this.camOn = true;
      await this.sendVideo(track);
    } catch (error) {
      this.error = deviceError(error);
    }
  };

  toggleShare = async () => {
    if (this.sharing) {
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.sharing = false;
      // Back to the camera if it was on before the screen took the slot.
      await this.sendVideo(this.camOn ? this.cameraTrack : null);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const track = display.getVideoTracks()[0];
      this.screenTrack = track;
      this.sharing = true;
      // Stopping from the browser's own "stop sharing" bar counts too.
      track.addEventListener('ended', () => {
        if (this.sharing) this.toggleShare();
      });
      await this.sendVideo(track);
    } catch (error) {
      // Cancelling the picker is not an error worth showing.
      if (error?.name !== 'NotAllowedError') this.error = deviceError(error);
    }
  };

  // Swaps what everyone in the call sees. Where a video track is already
  // flowing this is a straight replacement and nobody notices; going from no
  // video at all to some (a voice call that starts sharing a screen) needs
  // the connection placed again, since there is no video slot to swap into.
  async sendVideo(track) {
    let redial = false;
    for (const connection of this.media.values()) {
      const videoSender = connection.peerConnection
        ?.getSenders()
        .find((sender) => sender.track?.kind === 'video');
      if (videoSender) {
        try {
          await videoSender.replaceTrack(track);
        } catch {
          redial = true;
        }
      } else if (track) {
        redial = true;
      }
    }
    if (redial) this.replaceConnections();
  }

  // The blunt instrument: drop every media connection and let them come back
  // up with the stream as it is now. A second of silence, and then everyone
  // sees the right thing.
  replaceConnections() {
    const stream = new MediaStream();
    for (const track of this.localStream?.getAudioTracks() ?? [])
      stream.addTrack(track);
    const video = this.sharing
      ? this.screenTrack
      : this.camOn
        ? this.cameraTrack
        : null;
    if (video) stream.addTrack(video);
    this.localStream = stream;
    const devices = [...this.media.keys()];
    for (const [device, connection] of this.media) {
      connection.close();
      this.streams.delete(device);
    }
    this.media.clear();
    this.refreshParticipants();
    // Both sides have to place their half again by the usual rule: the ones we
    // dial, we dial now, and saying "I'm in" again is what makes the devices
    // that dial us do the same.
    for (const device of devices) this.dialIfOurs(device);
    this.mesh.broadcast(this.chatId, {
      t: 'call',
      action: 'join',
      mode: this.mode,
    });
  }
}

function deviceError(error) {
  if (error?.name === 'NotAllowedError')
    return 'Your browser blocked the microphone or camera. Allow it in the address bar and try again.';
  if (error?.name === 'NotFoundError')
    return "This device doesn't seem to have a microphone or camera.";
  if (error?.name === 'NotReadableError')
    return 'Something else is using the microphone or camera right now.';
  return "Couldn't start the call on this device.";
}
