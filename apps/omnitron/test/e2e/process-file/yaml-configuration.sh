#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"
cd $file_path/yaml-configuration

$omnitron start non-existent.yaml
should 'should have started 0 processes because file unknown' 'online' 0

$omnitron start malformated.yml
should 'should have started 0 processes because file malformated' 'online' 0

$omnitron start apps.yaml
should 'should have started 6 processes' 'online' 6

$omnitron restart all
should 'should have restarted 6 processes' 'restart_time: 1' 6

$omnitron restart apps.yaml
should 'should have restarted 6 processes' 'restart_time: 2' 6

$omnitron reload all
should 'should have reloaded 6 processes' 'restart_time: 3' 6

$omnitron reload apps.yaml
should 'should have reloaded 6 processes' 'restart_time: 4' 6

$omnitron stop all
should 'should have reloaded 6 processes' 'stopped' 6

$omnitron start apps.yaml
$omnitron delete all
should 'should have deleted 6 processes' 'online' 0
