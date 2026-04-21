const TARGETS = {
  'wcs.grudge-studio.com':   'https://gruda-wars.vercel.app',
  'dev.grudge-studio.com':   'https://grudgedot-launcher.vercel.app',
  'apps.grudge-studio.com':  'https://grudge-platform.vercel.app',
  'dcq.grudge-studio.com':   'https://dungeon-crawler-quest.vercel.app',
  'armada.grudge-studio.com':'https://grim-armada-web.vercel.app',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = TARGETS[url.hostname];
    if (!target) return new Response('Not found', { status: 404 });

    const targetUrl = new URL(url.pathname + url.search, target);
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.hostname);

    return fetch(new Request(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow',
    }));
  }
};
