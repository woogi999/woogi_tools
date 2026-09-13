// Packs PNG images into a multi-size .ico file. Modern Windows (Vista+)
// reads PNG-compressed frames directly, so no BMP re-encoding is needed.
export function buildIco(images) {
  const count = images.length;
  const header = new Uint8Array(6 + count * 16);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, count, true);

  let offset = header.length;
  const parts = [header];
  images.forEach((img, i) => {
    const entry = 6 + i * 16;
    header[entry] = img.width >= 256 ? 0 : img.width;
    header[entry + 1] = img.height >= 256 ? 0 : img.height;
    view.setUint16(entry + 4, 1, true); // planes
    view.setUint16(entry + 6, 32, true); // bit count
    view.setUint32(entry + 8, img.bytes.length, true);
    view.setUint32(entry + 12, offset, true);
    offset += img.bytes.length;
    parts.push(img.bytes);
  });

  return new Blob(parts, { type: 'image/x-icon' });
}
