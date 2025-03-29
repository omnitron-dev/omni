process.chdir(__dirname);

var OMNITRON = require('../..').default;
var should = require('should');

describe('NAMESPACE app management', function () {
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures',
  });

  before(function (done) {
    omnitron.delete('all', function () {
      done();
    });
  });

  after(function (done) {
    omnitron.kill(done);
  });

  it('should start 2 app in NS1', (done) => {
    omnitron.start(
      {
        script: './echo.js',
        name: 'echo1-ns1',
        namespace: 'NS1',
      },
      (err, procs) => {
        should(err).be.null();
        procs[0].omnitron_env.namespace.should.eql('NS1');
        omnitron.start(
          {
            script: './echo.js',
            namespace: 'NS1',
            name: 'echo2-ns1',
          },
          (err, procs) => {
            should(err).be.null();
            procs[0].omnitron_env.namespace.should.eql('NS1');
            done();
          }
        );
      }
    );
  });

  it('should start 2 app in NS2', (done) => {
    omnitron.start(
      {
        script: './echo.js',
        name: 'echo1-ns2',
        namespace: 'NS2',
      },
      (err, procs) => {
        should(err).be.null();
        procs[0].omnitron_env.namespace.should.eql('NS2');
        omnitron.start(
          {
            script: './echo.js',
            name: 'echo2-ns2',
            namespace: 'NS2',
          },
          (err, procs) => {
            should(err).be.null();
            procs[0].omnitron_env.namespace.should.eql('NS2');
            done();
          }
        );
      }
    );
  });

  it('should restart only app in NS1', function (done) {
    omnitron.restart('NS1', () => {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(4);
        list.forEach((l) => {
          if (l.name == 'echo1-ns1') should(l.omnitron_env.restart_time).eql(1);
          if (l.name == 'echo2-ns1') should(l.omnitron_env.restart_time).eql(1);
          if (l.name == 'echo1-ns2') should(l.omnitron_env.restart_time).eql(0);
          if (l.name == 'echo2-ns2') should(l.omnitron_env.restart_time).eql(0);
        });
        done();
      });
    });
  });

  it('should restart all', function (done) {
    omnitron.restart('all', () => {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(4);
        list.forEach((l) => {
          if (l.name == 'echo1-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo2-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo1-ns2') should(l.omnitron_env.restart_time).eql(1);
          if (l.name == 'echo2-ns2') should(l.omnitron_env.restart_time).eql(1);
        });
        done();
      });
    });
  });

  it('should restart NS2', function (done) {
    omnitron.restart('NS2', () => {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(4);
        list.forEach((l) => {
          if (l.name == 'echo1-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo2-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo1-ns2') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo2-ns2') should(l.omnitron_env.restart_time).eql(2);
        });
        done();
      });
    });
  });

  it('should stop NS2', function (done) {
    omnitron.stop('NS2', () => {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(4);
        list.forEach((l) => {
          if (l.name == 'echo1-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo2-ns1') should(l.omnitron_env.restart_time).eql(2);
          if (l.name == 'echo1-ns2') should(l.omnitron_env.status).eql('stopped');
          if (l.name == 'echo2-ns2') should(l.omnitron_env.status).eql('stopped');
        });
        done();
      });
    });
  });

  it('should delete NS2', function (done) {
    omnitron.delete('NS2', () => {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(2);
        done();
      });
    });
  });
});
