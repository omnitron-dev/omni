#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

export OMNITRON_GRACEFUL_TIMEOUT=1000
export OMNITRON_GRACEFUL_LISTEN_TIMEOUT=1000

cd $file_path

$omnitron kill

$omnitron start app-config-update/args1.json
$omnitron prettylist | grep "node_args: \[\]"
spec "1 Should application have empty node argument list"

$omnitron restart app-config-update/args2.json
$omnitron prettylist | grep "node_args: \[ '--harmony' \]"
spec "2 Should application have one node argument"

$omnitron delete all

$omnitron start app-config-update/echo.js
$omnitron prettylist | grep "node_args: \[\]"
spec "3 Should application have empty node argument list"

$omnitron restart app-config-update/echo.js --node-args="--harmony"
$omnitron prettylist | grep "node_args: \[ '--harmony' \]"
spec "4 Should application have one node argument"

# Variation with omnitron start that restarts an app
$omnitron start echo --node-args="--harmony"
$omnitron prettylist | grep "node_args: \[ '--harmony' \]"
spec "5 Should application have one node argument"

#
# Rename
#
$omnitron restart 0 --name="new-name"
$omnitron reset all
$omnitron restart new-name
should '6 should restart processes with new name' 'restart_time: 1' 1

$omnitron start 0 --name="new-name-2"
$omnitron reset all
$omnitron restart new-name-2
should '7 should restart processes with new name' 'restart_time: 1' 1

$omnitron delete all

########## RELOAD/CLUSTER MODE #########

$omnitron start app-config-update/echo.js -i 1
$omnitron prettylist | grep "node_args: \[\]"
spec "Should application have empty node argument list"

$omnitron reload app-config-update/echo.js --node-args="--harmony"
$omnitron prettylist | grep "node_args: \[ '--harmony' \]"
spec "Should application have one node argument"

$omnitron prettylist | grep "node_args"
spec "Should have found parameter"
# Now set node-args to null
$omnitron reload app-config-update/echo.js --node-args=null
# Should not find node_args anymore
$omnitron prettylist | grep "node_args"
ispec "Should have deleted cli parameter when passing null"

$omnitron reload echo --name="new-name"
$omnitron reset all
$omnitron restart new-name
should 'should reload processes with new name' 'restart_time: 1' 1
