// Serves images uploaded through the admin (stored in Netlify Blobs, store "media").
// Keys are content hashes, so responses are cached forever by the CDN and browsers.
const { connectLambda, getStore } = require('@netlify/blobs');

const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

exports.handler = async (event) => {
  // On a rewrite (/img/<key> → this function) Netlify passes the ORIGINAL path and query,
  // so take the key from ?k= if present, otherwise from the last path segment.
  const fromPath = (s) => String(s || '').split('?')[0].split('/').filter(Boolean).pop() || '';
  const RE = /^([a-f0-9]{24})\.(webp|png|jpg|woff2|woff|ttf|otf)$/;
  const k = [(event.queryStringParameters || {}).k, fromPath(event.path), fromPath(event.rawUrl)].map((x) => String(x || '')).find((x) => RE.test(x)) || '';
  const m = RE.exec(k);
  if (!m) return { statusCode: 404, body: 'not found' };
  connectLambda(event);
  const data = await getStore('media').get(k, { type: 'arrayBuffer' });
  if (!data) return { statusCode: 404, body: 'not found' };
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': TYPES[m[2]],
      'cache-control': 'public, max-age=31536000, immutable',
      'netlify-cdn-cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
    body: Buffer.from(data).toString('base64'),
  };
};
