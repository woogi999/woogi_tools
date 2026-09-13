// A small, hand-written UA parser covering the common desktop and mobile
// browsers/OSes. It favours clarity over covering every historical UA string.

const BROWSERS = [
  { name: 'Edge', re: /Edg(?:A|iOS)?\/([\d.]+)/ },
  { name: 'Opera', re: /(?:OPR|Opera)\/([\d.]+)/ },
  { name: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/ },
  { name: 'Vivaldi', re: /Vivaldi\/([\d.]+)/ },
  { name: 'Brave', re: /Brave\/([\d.]+)/ },
  { name: 'Firefox', re: /Firefox\/([\d.]+)/ },
  { name: 'Chrome', re: /(?:Chrome|CriOS)\/([\d.]+)/ },
  { name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
  { name: 'Internet Explorer', re: /(?:MSIE |Trident.*rv:)([\d.]+)/ },
];

const OS_LIST = [
  { name: 'iOS', re: /(?:iPhone|iPad|iPod).*OS ([\d_]+)/, format: (v) => v.replace(/_/g, '.') },
  { name: 'Android', re: /Android ([\d.]+)/ },
  { name: 'Windows', re: /Windows NT ([\d.]+)/ },
  { name: 'macOS', re: /Mac OS X ([\d_]+)/, format: (v) => v.replace(/_/g, '.') },
  { name: 'Chrome OS', re: /CrOS [^ ]+ ([\d.]+)/ },
  { name: 'Linux', re: /Linux/, exact: true },
];

const WINDOWS_NAMES = { '10.0': 'Windows 10 / 11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' };

const ENGINES = [
  { name: 'Blink', re: /Chrome|CriOS|Edg|OPR/ },
  { name: 'Gecko', re: /Firefox/ },
  { name: 'WebKit', re: /Safari/ },
  { name: 'Trident', re: /Trident/ },
];

function detect(ua, list) {
  for (const item of list) {
    if (item.exact) {
      if (item.guard ? item.guard(ua) : item.re.test(ua)) return { name: item.name, version: null };
      continue;
    }
    const match = ua.match(item.re);
    if (match) return { name: item.name, version: item.format ? item.format(match[1]) : match[1] };
  }
  return null;
}

export function parseUserAgent(ua) {
  if (!ua || !ua.trim()) return null;

  const browser = detect(ua, BROWSERS);
  let os = detect(ua, OS_LIST);
  if (os?.name === 'Windows' && WINDOWS_NAMES[os.version]) os = { name: WINDOWS_NAMES[os.version], version: os.version };
  const engine = detect(ua, ENGINES);

  const isMobile = /Mobi|Android|iPhone|iPod/.test(ua) && !/iPad/.test(ua);
  const isTablet = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';

  const bits = /WOW64|Win64|x64|x86_64|arm64|aarch64/i.test(ua) ? '64-bit' : /Windows NT|Intel|Linux/i.test(ua) ? '32-bit (or unspecified)' : null;

  return { browser, os, engine, deviceType, bits, isBot: /bot|crawl|spider|slurp/i.test(ua) };
}
