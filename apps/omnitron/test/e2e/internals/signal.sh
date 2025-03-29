#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

#
# Signal feature
#
$omnitron start signal.js -i 2
# get the log file and the id.
OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`
cat /dev/null > $OUT_LOG

$omnitron sendSignal SIGUSR2 signal
sleep 1

OUT=`grep "SIGUSR2" "$OUT_LOG" | wc -l`
[ $OUT -eq 1 ] || fail "Signal not received by the process name"
success "Processes sucessfully receives the signal"

$omnitron stop signal.js

# Send a process by id
$omnitron start signal.js

sleep 1
# get the log file and the id.
OUT_LOG=`$omnitron prettylist | grep -m 1 -E "pm_out_log_path:" | sed "s/.*'\([^']*\)',/\1/"`
ID=`$omnitron prettylist | grep -E "pm_id:" | sed "s/.*pm_id: \([^,]*\),/\1/"`

cat /dev/null > $OUT_LOG

$omnitron sendSignal SIGUSR2 $ID

OUT=`grep "SIGUSR2" "$OUT_LOG" | wc -l`
[ $OUT -eq 1 ] || fail "Signal not received by the process name"
success "Processes sucessfully receives the signal"
