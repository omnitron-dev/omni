#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"
cd $file_path

$omnitron start echo.js -i 4
spec "should start 4 processes"
should 'should have 4 apps started' 'online' 4

rm -f ~/.omnitron/dump.omnitron ~/.omnitron/dump.omnitron.bak
$omnitron save
spec "should save process list"
ls ~/.omnitron/dump.omnitron
spec "dump file should exist"
ls ~/.omnitron/dump.omnitron.bak
ispec "dump backup file should not exist"

$omnitron save
spec "should save and backup process list"
ls ~/.omnitron/dump.omnitron
spec "dump file should exist"
ls ~/.omnitron/dump.omnitron.bak
spec "dump backup file should exist"
