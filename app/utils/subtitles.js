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

// Whisper's chunks break wherever it paused for breath, which leaves lines
// like "and then we" / "went to the shops." Tidying joins the chunks back into
// sentences and cuts them into readable lines again at commas and clause ends,
// sharing each sentence's time out by how many characters each line has.
export function tidyCues(
  cues,
  { maxChars = 42, maxSeconds = 6, minSeconds = 0.8 } = {},
) {
  if (!cues.length) return cues;
  // 1. Glue everything into sentences that keep their own start and end.
  const sentences = [];
  let current = null;
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    if (!current) current = { start: cue.start, end: cue.end, text };
    else {
      current.text = `${current.text} ${text}`;
      current.end = cue.end;
    }
    if (/[.!?…]["')\]]?$/.test(text)) {
      sentences.push(current);
      current = null;
    }
  }
  if (current) sentences.push(current);
  // 2. Break each sentence into lines that fit, preferring clause boundaries.
  const out = [];
  for (const sentence of sentences) {
    const lines = wrapSentence(sentence.text, maxChars);
    const span = Math.max(
      sentence.end - sentence.start,
      minSeconds * lines.length,
    );
    const total = lines.reduce((sum, line) => sum + line.length, 0) || 1;
    let at = sentence.start;
    for (const line of lines) {
      const length = Math.min(
        maxSeconds,
        Math.max(minSeconds, (line.length / total) * span),
      );
      out.push({ start: at, end: at + length, text: line });
      at += length;
    }
  }
  // 3. Nothing may overlap the line after it.
  for (let i = 0; i < out.length - 1; i++)
    out[i].end = Math.min(out[i].end, out[i + 1].start - 0.01);
  return out.filter((cue) => cue.end > cue.start);
}

function wrapSentence(text, maxChars) {
  if (text.length <= maxChars) return [text];
  // Two lines of roughly equal weight read better than one long and one short.
  const clauses = text.split(/(?<=[,;:])\s+/);
  const lines = [];
  let line = '';
  for (const clause of clauses) {
    const words = clause.split(/\s+/);
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    // A clause end is a good place to stop if the line is already most of the way full.
    if (line.length > maxChars * 0.6) {
      lines.push(line);
      line = '';
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Reads an SRT or WebVTT file back into cues, so a subtitle file made
// anywhere can be baked in.
export function parseSubtitles(text) {
  const cues = [];
  const toSeconds = (stamp) => {
    const parts = stamp.trim().replace(',', '.').split(':').map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  const blocks = text
    .replace(/\r/g, '')
    .replace(/^WEBVTT[^\n]*\n/, '')
    .split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at].split('-->');
    const body = lines
      .slice(at + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!body) continue;
    cues.push({
      start: toSeconds(from),
      end: toSeconds(to.split(/\s+/).filter(Boolean)[0] ?? from),
      text: body,
    });
  }
  return cues;
}

export function toSrt(cues) {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${stamp(cue.start, true)} --> ${stamp(cue.end, true)}\n${cue.text}\n`,
    )
    .join('\n');
}

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, false)} --> ${stamp(cue.end, false)}\n${cue.text}\n`).join('\n')}`;
}

export const toPlainText = (cues) =>
  cues
    .map((c) => c.text)
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

export const FORMATS = [
  {
    id: 'srt',
    label: 'SubRip (.srt)',
    ext: 'srt',
    type: 'text/plain',
    make: toSrt,
  },
  {
    id: 'vtt',
    label: 'WebVTT (.vtt)',
    ext: 'vtt',
    type: 'text/vtt',
    make: toVtt,
  },
  {
    id: 'txt',
    label: 'Just the words (.txt)',
    ext: 'txt',
    type: 'text/plain',
    make: toPlainText,
  },
];

export const clock = (seconds) =>
  `${pad((seconds || 0) / 60)}:${pad((seconds || 0) % 60)}`;
