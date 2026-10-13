// Serves images uploaded through the admin (stored in Netlify Blobs, store "media").
// Keys are content hashes, so responses are cached forever by the CDN and browsers.
const { connectLambda, getStore } = require('@netlify/blobs');

const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

exports.handler = async (event) => {
  const k = String((event.queryStringParameters || {}).k || '');
  const m = /^([a-f0-9]{24})\.(webp|png|jpg)$/.exec(k);
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
