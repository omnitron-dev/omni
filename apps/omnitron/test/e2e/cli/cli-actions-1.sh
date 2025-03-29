#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

# Determine wget / curl
which wget > /dev/null
if [ $? -eq 0 ]
then
    http_get="wget"
else
    echo -e "\033[31mYou need wget to run this test \033[0m";
    exit 1;
fi

#
# Different way to stop process
#
$omnitron start echo.js
$omnitron start echo.js -f
$omnitron start echo.js -f

sleep 0.5

should 'should have started 3 apps' 'online' 3

$omnitron stop 12412
$omnitron stop 0

should 'should have stopped 1 apps' 'stopped' 1

$omnitron stop asdsdaecho.js

$omnitron stop echo

should 'should have stopped 3 apps' 'stopped' 3


#
# Describe process
#
$omnitron describe 0
spec "should describe stopped process"

$omnitron restart 1

$omnitron describe 1
spec "should describe online process"

$omnitron describe asdsa
ispec "should exit with right exit code when no process found"

#
# Update omnitron
#
$omnitron updateOMNITRON
spec "should update omnitron"



#
# Verify PID
#
$omnitron kill

$omnitron start echo.js -p echo.pid

sleep 0.5
ls echo-0.pid
spec "should pid file exists"

$omnitron stop all

sleep 1

ls echo-0.pid
ispec "should pid file be deleted once stopped"

$omnitron kill

$omnitron start echo.js -p echo.pid -i 1

sleep 1

ls echo-0.pid
spec "should pid file exists"

$omnitron stop all

sleep 1

ls echo-0.pid
ispec "should pid file be deleted once stopped"

$omnitron kill






#
# Main tests
#
$omnitron kill
spec "kill daemon"

$omnitron start eyayimfake
ispec "should fail if script doesnt exist"

$omnitron
ispec "No argument"

$omnitron list

$omnitron start cluster-omnitron.json
spec "Should start well formated json with name for file prefix"

$omnitron list
spec "Should list processes successfully"


$omnitron start multi-echo.json
spec "Should start multiple applications"

$omnitron init echo
spec "Should init echo sample json"

$omnitron start echo-omnitron.json -f
spec "Should start echo service"

$omnitron list

# Not consistent on travis :(
# OUT=`$omnitron logs --nostream --lines 10 OMNITRON | wc -l`
# [ $OUT -gt 10 ] || fail "Error : omnitron logs ouput showed $OUT lines but min is 10"
# success "should only print logs"

# OUT=`$omnitron logs --nostream --lines 100 OMNITRON | wc -l`
# [ $OUT -gt 100 ] || fail "Error : omnitron logs ouput showed $OUT  lines but min is 100"
# success "should only print logs: "

# sleep 1

# kill $!
# spec "Should kill logs"

# $omnitron logs echo &
# spec "Should display logs"
# TMPPID=$!

# sleep 1

# kill $!
# spec "Should kill logs"


# $omnitron web
# spec "Should start web interface"

# sleep 1

# JSON_FILE='/tmp/web-json'

# $http_get -q http://localhost:9615/ -O $JSON_FILE
# cat $JSON_FILE | grep "HttpInterface.js" > /dev/null
# spec "Should get the right JSON with HttpInterface file launched"

# $omnitron flush
# spec "Should clean logs"

# # cat ~/.omnitron/logs/echo-out.log | wc -l
# # spec "File Log should be cleaned"

# sleep 1
# $http_get -q http://localhost:9615/ -O $JSON_FILE
# cat $JSON_FILE | grep "restart_time\":0" > /dev/null
# spec "Should get the right JSON with HttpInterface file launched"

# #
# # Restart only one process
# #
# $omnitron restart 1
# should 'should has restarted process' 'restart_time: 1' 1

# #
# # Restart all processes
# #
# $omnitron restart all
# spec "Should restart all processes"

# sleep 1
# $http_get -q http://localhost:9615/ -O $JSON_FILE
# OUT=`cat $JSON_FILE | grep -o "restart_time\":1" | wc -l`

# [ $OUT -eq 7 ] || fail "Error while wgeting data via web interface"
# success "Got data from interface"


$omnitron start echo-env.js

$omnitron list

$omnitron dump
spec "Should dump current processes"

$omnitron save
spec "Should save (dump alias) current processes"


ls ~/.omnitron/dump.omnitron
spec "Dump file should be present"

$omnitron stop all
spec "Should stop all processes"

sleep 0.5
should 'should have stopped 8 apps' 'stopped' 8


$omnitron kill

#
# Issue #71
#

PROC_NAME='ECHONEST'
# Launch a script with name option
$omnitron start echo.js --name $PROC_NAME -f
should 'should have started app with name' 'ECHONEST' 7

# Restart a process by name
$omnitron restart $PROC_NAME
should 'should have restarted app by name' 'restart_time: 1' 1



$omnitron kill

$omnitron resurrect
spec "Should resurrect all apps"

sleep 0.5
should 'should have resurrected all processes' 'restart_time' 8



$omnitron delete all
spec "Should delete all processes"

sleep 0.5
should 'should have deleted process' 'restart_time' 0

$omnitron kill
spec "Should kill daemon"
