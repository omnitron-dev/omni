
#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

cd json-reload

#
# Max memory auto restart option
#
# --max-memory-restart option && maxMemoryRestart (via JSON file)
#
$omnitron kill

OMNITRON_WORKER_INTERVAL=1000 $omnitron start max-mem-0.json
sleep 2
$omnitron list
should 'process should has not been restarted' 'restart_time: 0' 1

$omnitron restart max-mem.json

sleep 2
$omnitron list
should 'process should has been restarted' 'restart_time: 0' 0

#
# Date format change
#
$omnitron delete all

CURRENT_YEAR=`date +"%Y"`
>echo-test.log

$omnitron start echo-pre.json
sleep 1
grep $CURRENT_YEAR echo-test.log
spec "Should have written year in log file according to format YYYY"
grep "ok" echo-test.log
spec "Should have written new string depending on ECHO_MSG"

$omnitron restart echo-post.json
>echo-test.log
sleep 1

grep $CURRENT_YEAR echo-test.log
ispec "Should have written year in log file according to format"

grep "YAY" echo-test.log
spec "Should have written new string depending on ECHO_MSG"

# Switch to production environment
$omnitron restart echo-post.json --env production
>echo-test.log
sleep 1
grep "WOW" echo-test.log
spec "Should have written new string depending on ECHO_MSG"

#
# Switch to production environment
#
$omnitron reload echo-post.json --env production
>echo-test.log
sleep 1
grep "WOW" echo-test.log
spec "Should have written new string depending on ECHO_MSG"

#
# Go back to original environment
#
$omnitron restart echo-post.json
sleep 1
grep "YAY" echo-test.log
spec "Should have written new string depending on ECHO_MSG"
