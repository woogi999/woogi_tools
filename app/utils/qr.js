// Payload builders for the QR generator. Formats follow the de-facto
// ZXing WIFI: scheme and vCard 3.0 (RFC 2426).

const escapeWifi = (s) => s.replace(/([\\;,:"])/g, '\\$1');
const escapeVcard = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([;,])/g, '\\$1');

export function wifiPayload({ ssid, password, securityType, isHidden }) {
  if (!ssid.trim()) return '';
  if (securityType !== 'nopass' && !password) return '';
  let out = `WIFI:T:${securityType};S:${escapeWifi(ssid)};`;
  if (securityType !== 'nopass') out += `P:${escapeWifi(password)};`;
  if (isHidden) out += 'H:true;';
  return `${out};`;
}

export function vcardPayload(v) {
  const first = v.firstName.trim();
  const last = v.lastName.trim();
  if (!first && !last) return '';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeVcard(last)};${escapeVcard(first)};;;`, `FN:${escapeVcard(`${first} ${last}`.trim())}`];
  const optional = [
    ['ORG', v.organization],
    ['TITLE', v.title],
    ['EMAIL', v.email],
    ['TEL', v.phone],
    ['URL', v.website],
  ];
  for (const [key, value] of optional) if (value.trim()) lines.push(`${key}:${escapeVcard(value.trim())}`);
  if (v.address.trim()) lines.push(`ADR:;;${escapeVcard(v.address.trim())};;;;`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

// qr-code-styling's bundled encoder maps each char code to one byte (Latin-1),
// so hand it UTF-8 bytes disguised as a binary string.
export function utf8Binary(text) {
  return Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
}

export function looksLikeUrl(text) {
  return /^(https?:\/\/|www\.)/i.test(text.trim());
}

export function isValidUrl(text) {
  if (/\s/.test(text.trim())) return false; // Chrome's URL parser tolerates spaces in hosts
  try {
    const url = new URL(/^www\./i.test(text.trim()) ? `https://${text.trim()}` : text.trim());
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.');
  } catch {
    return false;
  }
}
