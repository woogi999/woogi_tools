import { deflateSync, strToU8 } from 'fflate';

const sdp = `v=0
o=- 7866476258306123608 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:3921751657 1 udp 2113937151 75c1685a-259e-4c9f-adec-bce37a31787f.local 63636 typ host generation 0 network-cost 999
a=candidate:3730180436 1 udp 2113932031 902de809-940c-4830-974c-e489f8baad43.local 63637 typ host generation 0 network-cost 999
a=ice-ufrag:k+jK
a=ice-pwd:1xtgeK5q7pGfkDo8UB+D1d9e
a=ice-options:trickle
a=fingerprint:sha-256 60:4D:30:DE:1D:7C:F0:99:51:09:17:88:C8:D7:71:C5:BA:93:79:F5:1B:11:60:0D:DC:9C:D1:37:E2:8D:56:EB
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`;

function encode(payload) {
  const bytes = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'WOOGI1' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const payload = { t: 'offer', id: 'lan-AB12CD34', sdp };
const code = encode(payload);
console.log('payload json length:', JSON.stringify(payload).length);
console.log('final code:', code);
console.log('final code length:', code.length);
