const OMNITRON = require('../../..').default;

const omnitron = new OMNITRON.custom({
  cwd: __dirname,
});

OMNITRON.reload('echo', function (err, app) {
  if (err) throw err;
});
