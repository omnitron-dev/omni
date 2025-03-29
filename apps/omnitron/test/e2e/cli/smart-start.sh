
#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

#
# Test for SMART start
#

$omnitron start echo.js
should 'process should have been started' 'restart_time: 0' 1
should 'process should have been started' 'online' 1

$omnitron stop echo
should 'process should have been started' 'stopped' 1

$omnitron start echo
should 'process should have been started' 'online' 1

$omnitron start echo
should 'process should have been started' 'restart_time: 1' 1
should 'process should have been started' 'online' 1

$omnitron start 0
should 'process should have been started' 'restart_time: 2' 1
should 'process should have been started' 'online' 1

# $omnitron stop echo
# should 'process should have been started' 'stopped' 1

# $omnitron start all
# should 'process should have been started' 'restart_time: 2' 1
# should 'process should have been started' 'online' 1
