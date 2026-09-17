// Passes work from one tool to the next without a round trip through the disk:
// Auto Subtitle hands its cues and video to the Subtitle Baker, for instance.
// Files and blobs can't go in localStorage, so this is plain memory: it lasts
// for the visit and the receiving tool takes it once.

const parcels = new Map();

export function handOff(route, payload) {
  parcels.set(route, payload);
}

export function takeHandoff(route) {
  const payload = parcels.get(route) ?? null;
  parcels.delete(route);
  return payload;
}

export const hasHandoff = (route) => parcels.has(route);
