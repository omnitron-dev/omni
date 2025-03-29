#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

$omnitron kill
rm /tmp/.toto.pid

########### Override OMNITRON pid path
OMNITRON_PID_FILE_PATH=/tmp/.toto.pid $omnitron ls

sleep 2
test -f /tmp/.toto.pid

spec 'should have picked the omnitron pid path'
