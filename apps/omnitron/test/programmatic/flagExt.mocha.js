const should = require('should');
const { make_available_extension } = require('../../dist/api/modules/flag-ext');
const fs = require('fs');

describe('Flag -ext', function () {
  var opts = {};
  var res = [];
  opts.ext = 'js,json';

  it('should return not empty result', function () {
    make_available_extension(opts, res);
    should(res).be.not.empty();
  });
  it('should not crash', function () {
    make_available_extension(res);
    make_available_extension(opts);
  });
  it('should give different results', function () {
    var tmp_res = [];
    make_available_extension(opts, res);
    opts.ext = 'sh,py';
    make_available_extension(opts, tmp_res);
    should(res).not.equal(tmp_res);
  });
  it('should not crash in case, when no access for file or directory by permissions', function () {
    var dir = fs.mkdirSync('noAccessDir', 0o777);
    opts.ext = 'txt';
    var fileStream = fs.createWriteStream('noAccessDir/checkPermissions.txt');
    fileStream.write("It's a temporary file for testing flag --ext in OMNITRON");
    fileStream.end();
    fs.chmodSync('noAccessDir/checkPermissions.txt', 0o0);
    fs.chmodSync('noAccessDir', 0o0);
    make_available_extension(opts, []);
    make_available_extension(opts, []);
    fs.chmodSync('noAccessDir', 0o777);
    fs.chmodSync('noAccessDir/checkPermissions.txt', 0o777);
    fs.unlinkSync('noAccessDir/checkPermissions.txt');
    fs.rmdirSync('noAccessDir/');
  });
});
