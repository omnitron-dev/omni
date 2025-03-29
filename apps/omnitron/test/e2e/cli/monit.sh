#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron link xxx aaa

$omnitron start http.js -i 4
spec "should start 4 processes"

$omnitron monitor 0
should 'should monitoring flag enabled (id)' '_km_monitored: true' 1

$omnitron unmonitor 0
should 'should monitoring flag disabled (id)' '_km_monitored: false' 1

$omnitron monitor http
should 'should monitoring flag enabled (name)' '_km_monitored: true' 4

$omnitron unmonitor http
should 'should monitoring flag disabled (name)' '_km_monitored: false' 4

$omnitron monitor all
should 'should monitoring flag enabled ' '_km_monitored: true' 4

$omnitron unmonitor all
should 'should monitoring flag disabled (name)' '_km_monitored: false' 4
