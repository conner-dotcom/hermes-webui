// Stable Vercel API proxy endpoint. vercel.json routes /api/* here and
// passes the original API suffix as ?path=... so multi-segment API paths work.
module.exports = require('./[...path].js');
module.exports.config = module.exports.config || {
  api: {
    bodyParser: false,
  },
};
