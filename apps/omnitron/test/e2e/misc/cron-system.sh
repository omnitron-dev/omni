#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

OMNITRON_WORKER_INTERVAL=1000 $omnitron update
$omnitron delete all

#
# Cron wrong format detection
#
$omnitron start cron.js -c "* * * asdasd"
ispec "Cron should throw error when pattern invalid"

#
# Cron restart in fork mode
#
$omnitron start cron.js -c "*/2 * * * * *" --no-vizion
spec "Should cron restart echo.js"
sleep 2
should 'should app been restarted' 'restart_time: 0' 0

$omnitron restart cron
$omnitron reset all
sleep 4
should 'should app been restarted after restart' 'restart_time: 0' 0

$omnitron reset cron
$omnitron stop cron
sleep 4
should 'should app be started again' 'online' 1

$omnitron delete cron
sleep 4
should 'should app not be started again' 'stopped' 0
should 'should app not be started again' 'online' 0

$omnitron delete all

#
# Cron restart in cluster mode
#
$omnitron start cron.js -i 1 -c "*/2 * * * * *"
spec "Should start app"
sleep 2
should 'should app been restarted' 'restart_time: 0' 0
$omnitron reset all
sleep 3
should 'should app been restarted a second time' 'restart_time: 0' 0

$omnitron delete all

#
# Cron after resurect
#
$omnitron start cron.js -i 1 -c "*/2 * * * * *"
spec "Should start app"
sleep 2
should 'should app been restarted' 'restart_time: 0' 0

$omnitron update
$omnitron reset all
sleep 4
should 'should app been restarted' 'restart_time: 0' 0

$omnitron delete all

#
# Cron every sec
#
$omnitron start cron.js -c "* * * * * *"
sleep 4
should 'should app been restarted' 'restart_time: 0' 0

#
# Delete cron
#
$omnitron restart cron --cron-restart 0
$omnitron reset all
sleep 2
should 'app stop be restarted' 'restart_time: 0' 1

$omnitron delete all
