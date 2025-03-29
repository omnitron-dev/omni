const OMNITRON = require('../../..').default;

const omnitron = new OMNITRON.custom({
  cwd: __dirname,
});

OMNITRON.restart('echo', function (err, app) {
  if (err) throw err;
});
