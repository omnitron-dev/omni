#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path
$omnitron start delayed_exit.js -i 2
should 'should start processes' 'online' 2
should 'should app be in cluster mode' "exec_mode: 'cluster_mode'" 2
OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`
> $OUT_LOG

$omnitron reload delayed_exit

sleep 1

OUT=`grep "SIGINT" "$OUT_LOG" | wc -l`
[ $OUT -eq 1 ] || fail "Signal not received by the process name"
success "Processes sucessfully receives the SIGINT signal"

$omnitron kill

$omnitron start delayed_exit.js
should 'should start processes' 'online' 1
$omnitron stop delayed_exit.js
sleep 3
should 'should stop processes' 'stopped' 1
$omnitron restart delayed_exit.js
should 'should restart processes' 'restart_time: 0' 1
$omnitron restart delayed_exit.js
sleep 3
should 'should restart processes' 'restart_time: 1' 1
$omnitron kill

# $omnitron start delayed_exit.js -i 2
# should 'should start processes' 'online' 2
# $omnitron stop delayed_exit.js
# sleep 3
# should 'should stop processes' 'stopped' 2
# $omnitron restart delayed_exit.js
# should 'should restart processes' 'restart_time: 0' 2
# $omnitron restart delayed_exit.js
# should 'should restart processes' 'restart_time: 1' 2
# $omnitron reload delayed_exit.js
# should 'should restart processes' 'restart_time: 2' 2
# $omnitron gracefulReload delayed_exit.js
# should 'should restart processes' 'restart_time: 3' 2
# $omnitron kill

$omnitron start child.js -i 4
sleep 0.5
should 'should start processes' 'online' 4
$omnitron restart all
should 'should restarted be one for all' 'restart_time' 4
$omnitron restart child.js
should 'should restart a second time (BY SCRIPT NAME)' 'restart_time: 2' 4

$omnitron restart child
should 'should restart a third time (BY NAME)' 'restart_time: 3' 4
sleep 0.5
$omnitron reload all
sleep 0.5
should 'should RELOAD a fourth time' 'restart_time: 4' 4

############### CLUSTER STUFF
$omnitron kill


$omnitron start child.js -i 4
should 'should start processes' 'online' 4

$omnitron start network.js -i 4
should 'should has 8 online apps' 'online' 8

should 'should has 4 api online' 'network.js' 4
should 'should has 4 child.js online' 'child.js' 4

$omnitron reload all
should 'should reload all' 'restart_time' 8

$omnitron reload child.js
should 'should reload only child.js' 'restart_time: 2' 4

$omnitron reload network.js
should 'should reload network.js' 'restart_time: 2' 8

############### BLOCKING STUFF

# this is not a networked application
$omnitron start echo.js
should 'should has 8 online apps' 'online' 9

$omnitron reload echo
should 'should not hang and fallback to restart behaviour' 'restart_time' 9


############### NO-AUTORESTART
$omnitron kill

$omnitron start killtoofast.js --no-autorestart
should 'should not restart' 'restart_time: 0' 1

$omnitron delete all
$omnitron start no-restart.json
should 'should not restart' 'restart_time: 0' 1

############### STOP EXIT CODES
$omnitron kill

$omnitron start exitcode42.js --stop-exit-codes 42
sleep 2
should 'should not restart' 'restart_time: 0' 1

$omnitron delete all
$omnitron start exitcode42.js --stop-exit-codes 34
sleep 1
shouldnot 'should restart' 'restart_time: 0' 1
$omnitron kill

$omnitron start exitcode42.js --stop-exit-codes 3
sleep 1
shouldnot 'should restart processes' 'restart_time: 0' 1
$omnitron kill

$omnitron delete all
$omnitron start stop-exit-codes.json
sleep 0.5
should 'should not restart' 'restart_time: 0' 1


############### Via ENV: SEND() instead of KILL()
$omnitron kill
export OMNITRON_KILL_USE_MESSAGE='true'

$omnitron start signal-send.js
should 'should start processes' 'online' 1

OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`
> $OUT_LOG

$omnitron reload signal-send.js
sleep 1

OUT=`grep "shutdown" "$OUT_LOG" | wc -l`
[ $OUT -eq 1 ] || fail "Signal not received by the process name"
success "Processes sucessfully receives the signal"

unset OMNITRON_KILL_USE_MESSAGE

############### VIA --shutdown-with-message
$omnitron kill

$omnitron start signal-send.js --shutdown-with-message
should 'should start processes' 'online' 1

OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`
> $OUT_LOG

$omnitron reload signal-send.js
sleep 1

OUT=`grep "shutdown" "$OUT_LOG" | wc -l`
[ $OUT -eq 1 ] || fail "Signal not received by the process name"
success "Processes sucessfully receives the signal"
