// `npm run dev` is plain Vite, which knows nothing about the Worker, so every
// /api/* request used to fall through to the SPA's index.html. This runs the
// real worker/index.js inside the dev server instead: the request is turned
// into a standard Request, handed to the Worker's fetch(), and its Response
// is written back. Endpoints that need Cloudflare bindings (TURN keys, KV,
// Durable Objects) still won't work locally; the ones that only call other
// sites (OSINT, grammar, translate, Roblox, the Video Downloader) do.
//
// The Video Downloader's optional backend is read from the shell, so
// `COBALT_API_URL=http://localhost:9000/ npm start` tries it locally.
const devEnv = () => ({
  COBALT_API_URL: process.env.COBALT_API_URL,
  COBALT_API_KEY: process.env.COBALT_API_KEY,
});

export default function devApi() {
  return {
    name: 'woogi-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const worker = (await server.ssrLoadModule('/worker/index.js'))
            .default;
          const url = new URL(req.url, `http://${req.headers.host}`);
          const hasBody = !['GET', 'HEAD'].includes(req.method);
          const body = hasBody ? await readBody(req) : undefined;
          // eslint-disable-next-line n/no-unsupported-features/node-builtins -- global since Node 18
          const request = new Request(url, {
            method: req.method,
            headers: Object.entries(req.headers).filter(
              ([k, v]) => typeof v === 'string' && !k.startsWith(':'),
            ),
            body,
          });
          const response = await worker.fetch(request, devEnv());
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(`[dev-api] ${error.stack ?? error}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(error.message ?? error) }));
        }
      });
    },
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
