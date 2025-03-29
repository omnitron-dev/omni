const OMNITRON = require('../../..').default;

const omnitron = new OMNITRON.custom({
  cwd: __dirname,
});

OMNITRON.start('./echo.js', function (err, app) {
  if (err) throw err;
});
