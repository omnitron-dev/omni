#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron start echo.js --name "echo-3"
$omnitron start echo.js --name "echo-1"
$omnitron start echo.js --name "echo-2"

sleep 0.5

should 'should have started 3 apps' 'online' 3

$omnitron stop /echo-[1,2]/

should 'should have stopped 2 apps' 'stopped' 2
should 'only one app should still be online' 'online' 1

$omnitron stop /echo-3/
should 'should have stopped 1 apps' 'online' 0

$omnitron restart /echo-[1,2]/

should 'should have restarted 2 apps' 'online' 2
