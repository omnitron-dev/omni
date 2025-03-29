#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"


omnitron_path=`pwd`/bin/omnitron-dev

if [ ! -f $omnitron_path ];
then
    omnitron_path=`pwd`/../bin/omnitron-dev
    if [ ! -f $omnitron_path ];
    then
        omnitron_path=`pwd`/../../bin/omnitron-dev
    fi
fi

omnitrondev="$omnitron_path"

export OMNITRON_HOME=$HOME'/.omnitron-dev'

cd $file_path/omnitron-dev

# Test with js
$omnitrondev app.js  &
sleep 2
$omnitron ls
should 'should have started 1 apps' 'online' 1
should 'should watch be true' 'watch: true' 1
pkill -f Daemon
$omnitron kill

echo "THEN"
# Test with json and args
$omnitrondev start app.json --test-mode
$omnitron ls
should 'should have started 1 apps' 'online' 1
$omnitron prettylist | grep "watch: \[ 'server', 'client' \]"
spec "Should application have two watch arguments"
$omnitron prettylist | grep "ignore_watch: \[ 'node_modules', 'client/img' \]"
spec "Should application have two ignore_watch arguments"
$omnitron kill
