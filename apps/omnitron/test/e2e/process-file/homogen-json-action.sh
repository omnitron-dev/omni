#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron kill

cd homogen-json-action

$omnitron start all.json
should 'should start process' 'online' 6
should 'should all script been restarted 0 time' 'restart_time: 0' 6

$omnitron start all.json
should 'should smart restart processes' 'online' 6
should 'should all script been restarted one time' 'restart_time: 1' 6

$omnitron restart all.json
should 'should all script been restarted one time' 'restart_time: 2' 6

$omnitron reload all.json
should 'should all script been restarted one time' 'restart_time: 3' 6

# With restart should equal a start
$omnitron delete all

$omnitron restart all.json
should 'should start process' 'online' 6
should 'should all script been restarted 0 time' 'restart_time: 0' 6

# With reload should equal a start
$omnitron delete all

$omnitron reload all.json
should 'should start process' 'online' 6
should 'should all script been restarted 0 time' 'restart_time: 0' 6
