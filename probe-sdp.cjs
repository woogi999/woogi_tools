const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const result = await page.evaluate(async () => {
    /* global RTCPeerConnection -- this callback runs inside the page */
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('woogi', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') resolve();
      });
      setTimeout(resolve, 4000);
    });
    return {
      sdp: pc.localDescription.sdp,
      len: pc.localDescription.sdp.length,
    };
  });
  console.log('=== RAW SDP ===');
  console.log(result.sdp);
  console.log('=== length ===', result.len);
  await browser.close();
})();
