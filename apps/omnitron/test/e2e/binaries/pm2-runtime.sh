#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"


omnitron_path=`pwd`/bin/omnitron-runtime

if [ ! -f $omnitron_path ];
then
    omnitron_path=`pwd`/../bin/omnitron-runtime
    if [ ! -f $omnitron_path ];
    then
        omnitron_path=`pwd`/../../bin/omnitron-runtime
    fi
fi

omnitron_runtime="$omnitron_path"

export OMNITRON_RUNTIME_DEBUG='true'

cd $file_path/omnitron-dev

#
# Simple start with 4 apps
#
$omnitron kill
pkill -f OMNITRON

$omnitron_runtime app.js -i 4
should 'should have started 4 apps' 'online' 4

$omnitron kill

#
# Test with json and args
#
$omnitron_runtime app.json
should 'should have started 1 apps' 'online' 1
$omnitron prettylist | grep "watch: \[ 'server', 'client' \]"
spec "Should application have two watch arguments"
$omnitron prettylist | grep "ignore_watch: \[ 'node_modules', 'client/img' \]"
spec "Should application have two ignore_watch arguments"
$omnitron kill

# Restore default behavior for exit checks
unset OMNITRON_RUNTIME_DEBUG

#
# --no-autorestart checks
#
# $omnitron_runtime app.js --no-autorestart
# PID_OMNITRON=$!
# $omnitron pid app
# echo "OK"
# PID=`cat /tmp/pid`
# echo $PID
# kill $PID
# sleep 3
# pgrep "OMNITRON"
# ispec "OMNITRON runtime should be killed because no app is running"

#
# Auto Exit Worker
#
$omnitron_runtime exited_app.js 2> /dev/null
sleep 1
pgrep "OMNITRON"
ispec "OMNITRON runtime should be killed because no app is running"
