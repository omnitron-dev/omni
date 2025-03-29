#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

########### Fork mode
$omnitron start echo.js -x
should 'should start app in fork mode' 'fork_mode' 1

$omnitron restart echo.js
should 'should has restarted app' 'restart_time: 1' 1

########### Fork mode
$omnitron kill

$omnitron start bashscript.sh
should 'should start app in fork mode' 'fork_mode' 1

########### Auto Detective Interpreter In Fork mode

### Dump resurrect should be ok
$omnitron dump

$omnitron kill

#should 'should has forked app' 'fork' 0

$omnitron resurrect
should 'should has forked app' 'fork_mode' 1

## Delete

$omnitron list

$omnitron delete 0
should 'should has delete process' 'fork_mode' 0
