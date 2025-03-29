const OMNITRON = require('../..');

/**
 * New gen API
 */
var omnitron = new OMNITRON.custom();

//console.log(process.env);

omnitron.connect(function (err) {
  console.error(' ----------------------');

  omnitron.start(
    './insideOmnitronProcess.js',
    {
      name: 'insideProcess',
      output: './inside-out.log',
      merge_logs: true,
    },
    function (err, proc) {
      if (err) {
        console.log(err);
        return process.exit(1);
      }
    }
  );
});
