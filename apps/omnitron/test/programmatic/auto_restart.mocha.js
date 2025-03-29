const omnitron = require('../..').default;
const should = require('should');
const path = require('path');

describe('OMNITRON auto restart on uncaughtexception', function () {
  var test_path = path.join(__dirname, 'fixtures', 'auto-restart');

  after((done) => {
    omnitron.delete('all', () => {
      done();
    });
  });

  before((done) => {
    omnitron.uninstall('all', () => {
      omnitron.delete('all', () => {
        done();
      });
    });
  });

  it('should start a failing app in fork mode', function (done) {
    omnitron.start(
      {
        script: path.join(test_path, 'throw.js'),
      },
      (err, apps) => {
        setTimeout(function () {
          omnitron.list((err, list) => {
            should(list[0].omnitron_env.restart_time).aboveOrEqual(0);
            omnitron.delete('throw', () => {
              done();
            });
          });
        }, 200);
      }
    );
  });

  it('should start a failing app in cluster mode', function (done) {
    omnitron.start(
      {
        script: path.join(test_path, 'throw.js'),
        instances: 2,
      },
      (err, apps) => {
        setTimeout(function () {
          omnitron.list((err, list) => {
            should(list[0].omnitron_env.restart_time).aboveOrEqual(0);
            omnitron.delete('throw', () => {
              done();
            });
          });
        }, 200);
      }
    );
  });
});
