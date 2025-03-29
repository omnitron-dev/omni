#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

## Try to launch an app with `push` as name
$omnitron kill

$omnitron start push.json

$omnitron stop push.json

$omnitron list

#
# Max memory auto restart option
#
# --max-memory-restart option && maxMemoryRestart (via JSON file)
#
$omnitron kill
OMNITRON_WORKER_INTERVAL=1000 $omnitron start big-array.js --max-memory-restart="20M"
sleep 3
$omnitron list
should 'process should have been restarted' 'restart_time: 0' 0

$omnitron delete all

#
# Via JSON
#
$omnitron start json-reload/max-mem.json
sleep 3
$omnitron list
should 'process should been restarted' 'restart_time: 0' 0

$omnitron delete all

$omnitron start env.js

OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`

cat /dev/null > $OUT_LOG

sleep 1

OUT=`cat $OUT_LOG | head -n 1`

if [ $OUT="undefined" ]
then
    success "environment variable not defined"
else
    fail "environment defined ? wtf ?"
fi

$omnitron delete all

$omnitron start env.json

cat /dev/null > $OUT_LOG

sleep 1

OUT=`cat $OUT_LOG | head -n 1`

if [ "$OUT" = "undefined" ]
then
    fail "environment variable hasnt been defined"
else
    success "environment variable successfully defined"
fi


#####################
# Merge logs option #
#####################
$omnitron kill

rm outmerge*

$omnitron start echo.js -i 4 -o outmerge.log

cat outmerge.log > /dev/null
ispec 'file outmerge.log should not exist'

cat outmerge-0.log > /dev/null
spec 'file outmerge-0.log should exist'

rm outmerge*

############ Now with --merge option

$omnitron kill

rm outmerge*

$omnitron start echo.js -i 4 -o outmerge.log --merge-logs
sleep 0.2
cat outmerge.log > /dev/null
spec 'file outmerge.log should exist'

cat outmerge-0.log > /dev/null
ispec 'file outmerge-0.log should not exist'

rm outmerge*
