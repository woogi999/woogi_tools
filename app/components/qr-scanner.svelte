<script>
  import Icon from './icon.svelte';

  // Reads QR codes from the camera, where the browser can (Chrome and Edge on Android, mostly).
  let { hint, onScan, onClose } = $props();

  let error = $state('');

  function camera(video) {
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
            if (found?.rawValue && !stopped) onScan(found.rawValue);
          } catch {
            // frame not ready yet
          }
        }, 350);
      })
      .catch(
        () => (error = 'Couldn’t open the camera. Type the code in instead.'),
      );
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }
</script>

<div class="nearby-scan">
  {#if hint}<p class="tool-hint">{hint}</p>{/if}
  {#if error}
    <p class="tool-error">{error}</p>
  {:else}
    <video class="nearby-video" muted playsinline {@attach camera}></video>
  {/if}
  <button type="button" class="btn" onclick={onClose}
    ><Icon name="keyboard" size={13} />
    Type it in instead</button
  >
</div>
