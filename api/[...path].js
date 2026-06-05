// Vercel serverless proxy for Hermes WebUI API requests.
//
// Vercel external rewrites can corrupt POSTs to the Tailscale Funnel subpath
// (the upstream sees a bogus HTTP method like '{"password":...}POST').  Proxy
// API requests through a function instead so the raw body and Set-Cookie headers
// are forwarded correctly.

const https = require('https');

const DEFAULT_UPSTREAM = 'https://dias-mac-studio.tail4f36cb.ts.net/hermes-webui';

function upstreamBase() {
  return (process.env.HERMES_WEBUI_UPSTREAM || DEFAULT_UPSTREAM).replace(/\/+$/, '');
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function copyRequestHeaders(req, bodyLength) {
  const out = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    const lower = name.toLowerCase();
    // These are specific to the browser -> Vercel hop. Forwarding them to the
    // upstream would make Hermes see a cross-origin browser request even though
    // Vercel is now the same-origin edge proxy.
    if (['host', 'origin', 'referer', 'connection', 'content-length'].includes(lower)) continue;
    out[name] = value;
  }
  if (bodyLength > 0) out['Content-Length'] = String(bodyLength);
  return out;
}

module.exports = async function handler(req, res) {
  const body = await rawBody(req);
  const target = new URL(req.url, upstreamBase());
  const headers = copyRequestHeaders(req, body.length);

  const proxyReq = https.request(target, {
    method: req.method,
    headers,
  }, proxyRes => {
    res.statusCode = proxyRes.statusCode || 502;
    for (const [name, value] of Object.entries(proxyRes.headers || {})) {
      if (typeof value === 'undefined') continue;
      // Let Vercel manage connection framing for the client response.
      if (['connection', 'transfer-encoding'].includes(name.toLowerCase())) continue;
      res.setHeader(name, value);
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'WebUI upstream unavailable', detail: err.message }));
  });

  if (body.length > 0) proxyReq.write(body);
  proxyReq.end();
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
