#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

## Start
$omnitron start child.js echo.js server.js
should 'should app be online' 'online' 3

## Restart
$omnitron restart child echo server
should 'should app be online' 'online' 3
should 'should all script been restarted one time' 'restart_time: 1' 3

## Stop
$omnitron stop child echo server
should 'should app be stopped' 'stopped' 3

## Delete
$omnitron delete child echo server
shouldnot 'should app be deleted' 'stopped' 3
