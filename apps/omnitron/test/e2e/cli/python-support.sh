#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path/extra-lang

#
# Config file
#

$omnitron start app-python.config.js --only 'echo-python-1'
should 'should mode be fork' 'fork_mode' 1
should 'should have started 1 apps' 'online' 1

$omnitron delete all

# Check with multi instances
$omnitron start app-python.config.js --only 'echo-python-max'
should 'should mode be fork' 'fork_mode' 4
should 'should have started 4 apps' 'online' 4

# Should keep same params on restart
$omnitron restart all
should 'should have restarted processes' 'restart_time: 1' 4
should 'should mode be fork' 'fork_mode' 4

$omnitron delete all

#
# CLI
#

$omnitron start echo.py
should 'should mode be fork' 'fork_mode' 1
should 'should have started 1 apps' 'online' 1

$omnitron delete all

$omnitron start echo.py -i 4
should 'should mode be fork' 'fork_mode' 4
should 'should have started 4 apps' 'online' 4

$omnitron restart all
should 'should have restarted processes' 'restart_time: 1' 4
should 'should mode be fork' 'fork_mode' 4
