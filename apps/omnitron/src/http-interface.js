const os = require('os');
const urlT = require('url');
const http = require('http');

const omnitron = require('.');
const cst = require('./constants').default;

// Default, attach to default local OMNITRON

omnitron.connect(function () {
  startWebServer(omnitron);
});

function startWebServer(omnitron) {
  http
    .createServer(function (req, res) {
      // Add CORS headers to allow browsers to fetch data directly
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET');

      // We always send json
      res.setHeader('Content-Type', 'application/json');

      var path = urlT.parse(req.url).pathname;

      if (path == '/') {
        // Main monit route
        omnitron.list(function (err, list) {
          if (err) {
            return res.send(err);
          }
          var data = {
            system_info: {
              hostname: os.hostname(),
              uptime: os.uptime(),
            },
            monit: {
              loadavg: os.loadavg(),
              total_mem: os.totalmem(),
              free_mem: os.freemem(),
              cpu: os.cpus(),
              interfaces: os.networkInterfaces(),
            },
            processes: list,
          };

          if (cst.WEB_STRIP_ENV_VARS === true) {
            for (var i = data.processes.length - 1; i >= 0; i--) {
              var proc = data.processes[i];

              // Strip important environment variables
              if (typeof proc.omnitron_env === 'undefined' && typeof proc.omnitron_env.env === 'undefined') return;

              delete proc.omnitron_env.env;
            }
          }

          res.statusCode = 200;
          res.write(JSON.stringify(data));
          return res.end();
        });
      } else {
        // 404
        res.statusCode = 404;
        res.write(JSON.stringify({ err: '404' }));
        return res.end();
      }
    })
    .listen(process.env.OMNITRON_WEB_PORT || cst.WEB_PORT, cst.WEB_IPADDR, function () {
      console.log('Web interface listening on  %s:%s', cst.WEB_IPADDR, cst.WEB_PORT);
    });
}
