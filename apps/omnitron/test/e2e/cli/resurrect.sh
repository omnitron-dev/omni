#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"
cd $file_path

$omnitron start echo.js -i 4
spec "should start 4 processes"
should 'should have 4 apps started' 'online' 4

$omnitron save
$omnitron resurrect
spec "should resurrect from dump"
should 'should have still 4 apps started' 'online' 4

$omnitron save
$omnitron delete all
echo "[{" > ~/.omnitron/dump.omnitron
$omnitron resurrect
spec "should resurrect from backup if dump is broken"
ls ~/.omnitron/dump.omnitron
ispec "should delete broken dump"
should 'should have still 4 apps started' 'online' 4

$omnitron delete all
$omnitron resurrect
spec "should resurrect from backup if dump is missing"
should 'should have still 4 apps started' 'online' 4
