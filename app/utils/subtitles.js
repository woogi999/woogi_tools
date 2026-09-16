// Turning Whisper's timed chunks into subtitle files: SRT, WebVTT or plain text.

const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');

function stamp(seconds, comma) {
  const s = Math.max(0, seconds || 0);
  const ms = Math.round((s % 1) * 1000);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${comma ? ',' : '.'}${pad(ms, 3)}`;
}

// Whisper hands back chunks with a start and end; long ones are split so a line
// isn't on screen for half a minute.
export function toCues(chunks, { maxChars = 84, maxSeconds = 7 } = {}) {
  const cues = [];
  for (const chunk of chunks) {
    const [start, end] = chunk.timestamp ?? [chunk.start, chunk.end];
    const text = (chunk.text ?? '').trim();
    if (!text || start == null) continue;
    const finish = end ?? start + 2;
    const span = finish - start;
    if (text.length <= maxChars && span <= maxSeconds) {
      cues.push({ start, end: finish, text });
      continue;
    }
    // Split on sentence ends where there are any, otherwise on words.
    const parts = text.match(/[^.!?]+[.!?]*/g) ?? [text];
    const pieces = [];
    for (const part of parts) {
      if (part.length <= maxChars) pieces.push(part.trim());
      else {
        let line = '';
        for (const word of part.split(/\s+/)) {
          if ((line + ' ' + word).trim().length > maxChars) {
            pieces.push(line.trim());
            line = word;
          } else line = `${line} ${word}`;
        }
        if (line.trim()) pieces.push(line.trim());
      }
    }
    // Time is shared out by how long each piece is.
    const total = pieces.reduce((sum, p) => sum + p.length, 0) || 1;
    let at = start;
    for (const piece of pieces) {
      const length = (piece.length / total) * span;
      cues.push({ start: at, end: at + length, text: piece });
      at += length;
    }
  }
  return cues.filter((c) => c.text);
}

export function toSrt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.start, true)} --> ${stamp(cue.end, true)}\n${cue.text}\n`).join('\n');
}

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, false)} --> ${stamp(cue.end, false)}\n${cue.text}\n`).join('\n')}`;
}

export const toPlainText = (cues) => cues.map((c) => c.text).join(' ').replaceAll(/\s+/g, ' ').trim();

export const FORMATS = [
  { id: 'srt', label: 'SubRip (.srt)', ext: 'srt', type: 'text/plain', make: toSrt },
  { id: 'vtt', label: 'WebVTT (.vtt)', ext: 'vtt', type: 'text/vtt', make: toVtt },
  { id: 'txt', label: 'Just the words (.txt)', ext: 'txt', type: 'text/plain', make: toPlainText },
];

export const clock = (seconds) => `${pad((seconds || 0) / 60)}:${pad((seconds || 0) % 60)}`;
