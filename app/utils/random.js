// Fair randomness for the chance tools (wheel, dice, coin): the platform's
// CSPRNG with rejection sampling, so no face is ever favoured by a modulo bias.

export function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  let n;
  do n = crypto.getRandomValues(new Uint32Array(1))[0];
  while (n >= limit);
  return n % max;
}

export function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
