// What each page is called and how it describes itself, shared by the browser
// tab title (app/templates/application.gjs) and the link-preview tags the
// Worker writes into the HTML for Facebook, Discord, X and the rest
// (worker/index.js), since those crawlers never run the app's JavaScript.
import { TOOLS } from '../tools.js';

export const SITE_NAME = 'Woogi Tools';
export const SITE_DESCRIPTION = 'Small, fun, single-purpose web tools.';

// Pages that aren't tools, so aren't described in app/tools.js.
const PAGES = {
  index: { description: SITE_DESCRIPTION },
  settings: {
    label: 'Settings',
    description: 'Theme, motion, offline use and your saved data.',
  },
  updates: {
    label: 'Updates',
    description: "What's new on Woogi Tools, release by release.",
  },
  privacy: {
    label: 'Privacy Policy',
    description: 'What Woogi Tools does, and does not do, with your data.',
  },
  terms: {
    label: 'Terms of Service',
    description: 'The terms for using Woogi Tools.',
  },
  'not-found': { label: 'Page not found', description: SITE_DESCRIPTION },
};

// Old routes that forward to a renamed or merged tool (see app/routes/).
const ALIASES = {
  uno: 'woono',
  'recon-sweep': 'domain-lookup',
  'subdomain-finder': 'domain-lookup',
};

const BY_ROUTE = new Map(TOOLS.filter((t) => t.route).map((t) => [t.route, t]));

// { title, label, description } for a route name. Anything unknown is the
// not-found page, which is also how the router treats it.
export function pageMeta(route) {
  route = ALIASES[route] || route;
  if (!PAGES[route] && !BY_ROUTE.has(route)) route = 'not-found';
  const meta = { ...BY_ROUTE.get(route), ...PAGES[route] };
  const label = route === 'index' ? null : meta.label;
  return {
    label,
    title: label ? `${label} | ${SITE_NAME}` : SITE_NAME,
    description: meta.description || SITE_DESCRIPTION,
  };
}
