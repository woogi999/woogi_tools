// Looks an IP address (or a hostname) up and says where it is and who runs it.
//
// The lookup goes straight from the browser to a free public geolocation
// service, never through this site's Worker: nothing about who you looked up
// is worth putting on our bill or in our logs. ipwho.is is asked first, and
// ipapi.co is the fallback for when it is rate limited or unreachable, so the
// tool keeps working when one of the two is having a bad day.

const looksLikeIpv6 = (value) =>
  /^[0-9a-f:]+$/i.test(value) && value.includes(':');

// "1.1.1.1", "one.one.one.one", "https://example.com/path" and
// "example.com:8080" all mean the same lookup, so they are all accepted.
export function parseTarget(value) {
  let query = String(value ?? '').trim();
  if (!query) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(query)) {
    try {
      query = new URL(query).hostname;
    } catch {
      // not a URL after all; fall through and treat it as typed
    }
  }
  // Bare IPv6 in brackets, as URLs write it.
  query = query.replace(/^\[(.+)]$/, '$1');
  if (!looksLikeIpv6(query)) query = query.split('/')[0].split(':')[0];
  return query.replace(/\.$/, '').toLowerCase();
}

// Two decimal places is about a kilometre, which is as precise as any of this
// ever really is, and coordinates to six places only look authoritative.
const coord = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const text = (value) => (value == null || value === '' ? '' : String(value));

// A country code turns into its flag by shifting each letter into the
// regional indicator block, so no flag images are shipped.
export function flagFor(code) {
  const cc = text(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function fromIpWhoIs(data) {
  return {
    ip: text(data.ip),
    type: data.type === 'IPv6' ? 'IPv6' : data.type === 'IPv4' ? 'IPv4' : '',
    city: text(data.city),
    region: text(data.region),
    regionCode: text(data.region_code),
    country: text(data.country),
    countryCode: text(data.country_code),
    continent: text(data.continent),
    capital: text(data.capital),
    postal: text(data.postal),
    latitude: coord(data.latitude),
    longitude: coord(data.longitude),
    isEu: Boolean(data.is_eu),
    callingCode: text(data.calling_code),
    timezone: text(data.timezone?.id),
    utcOffset: text(data.timezone?.utc),
    currency: text(data.currency?.code),
    currencyName: text(data.currency?.name),
    asn: data.connection?.asn ? `AS${data.connection.asn}` : '',
    isp: text(data.connection?.isp),
    org: text(data.connection?.org),
    domain: text(data.connection?.domain),
    source: 'ipwho.is',
  };
}

function fromIpApiCo(data) {
  return {
    ip: text(data.ip),
    type: text(data.version).startsWith('IPv6') ? 'IPv6' : 'IPv4',
    city: text(data.city),
    region: text(data.region),
    regionCode: text(data.region_code),
    country: text(data.country_name),
    countryCode: text(data.country_code),
    continent: text(data.continent_code),
    capital: text(data.country_capital),
    postal: text(data.postal),
    latitude: coord(data.latitude),
    longitude: coord(data.longitude),
    isEu: Boolean(data.in_eu),
    callingCode: text(data.country_calling_code),
    timezone: text(data.timezone),
    utcOffset: text(data.utc_offset),
    currency: text(data.currency),
    currencyName: text(data.currency_name),
    asn: text(data.asn),
    isp: text(data.org),
    org: text(data.org),
    domain: '',
    source: 'ipapi.co',
  };
}

async function askIpWhoIs(target) {
  const url = target
    ? `https://ipwho.is/${encodeURIComponent(target)}`
    : 'https://ipwho.is/';
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a public geolocation service, not app data
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`ipwho.is ${response.status}`);
  const data = await response.json();
  // It answers 200 with success:false for an address it can't place.
  if (data?.success === false)
    throw new LookupError(
      data.message || "That address couldn't be looked up.",
    );
  return fromIpWhoIs(data);
}

async function askIpApiCo(target) {
  const url = target
    ? `https://ipapi.co/${encodeURIComponent(target)}/json/`
    : 'https://ipapi.co/json/';
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- a public geolocation service, not app data
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`ipapi.co ${response.status}`);
  const data = await response.json();
  if (data?.error)
    throw new LookupError(data.reason || "That address couldn't be looked up.");
  return fromIpApiCo(data);
}

// A service saying "I don't know that address" is the answer, not a fault, so
// it is worth telling apart from a service that simply didn't respond.
export class LookupError extends Error {}

export async function lookup(value) {
  const target = parseTarget(value);
  try {
    return await askIpWhoIs(target);
  } catch (error) {
    if (error instanceof LookupError) throw error;
    try {
      return await askIpApiCo(target);
    } catch (fallbackError) {
      if (fallbackError instanceof LookupError) throw fallbackError;
      throw new Error(
        'Neither lookup service answered. Check your connection, or try again in a minute.',
      );
    }
  }
}

export function placeLine(result) {
  return [result.city, result.region, result.country]
    .filter(Boolean)
    .join(', ');
}

// The map. A same-origin Leaflet map rather than an embedded iframe, so
// scrolling zooms normally (no ctrl+scroll trick an iframe would force) and
// this site's own Ctrl+F still works while the map has focus. Every layer is
// a free tile source that needs no API key: OpenStreetMap for the road map,
// Esri's World Imagery for satellite, that imagery with Esri's boundary and
// place labels drawn over it for hybrid, and OpenTopoMap for terrain.
export const MAP_VIEWS = [
  {
    id: 'road',
    label: 'Map',
    zoom: 11,
    maxZoom: 19,
    layers: [
      {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      },
    ],
  },
  {
    id: 'satellite',
    label: 'Satellite',
    zoom: 13,
    maxZoom: 19,
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics and the GIS User Community',
      },
    ],
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    zoom: 13,
    maxZoom: 19,
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics and the GIS User Community',
      },
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        attribution: '',
      },
    ],
  },
  {
    id: 'terrain',
    label: 'Terrain',
    zoom: 9,
    maxZoom: 17,
    layers: [
      {
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, SRTM &mdash; Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA)',
      },
    ],
  },
];

export function mapView(id) {
  return MAP_VIEWS.find((view) => view.id === id) ?? MAP_VIEWS[0];
}

// A plain link out to a real map site, for opening the address somewhere
// with search, directions and all the rest that a tile layer alone can't do.
export function mapLinkUrl({ latitude, longitude }) {
  if (latitude == null || longitude == null) return '';
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=12/${latitude}/${longitude}`;
}

// The time where the address is, not where you are.
export function localTime(timezone) {
  if (!timezone) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
  } catch {
    return '';
  }
}
