#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"
cd $file_path

$omnitron start cluster-omnitron.json
should 'should have started 4 processes' 'online' 4

$omnitron reload cluster-omnitron.json
should 'should have started 4 processes' 'online' 4
