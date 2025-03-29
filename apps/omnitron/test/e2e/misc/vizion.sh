#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

echo "################## VIZION ###################"

mv git .git

###############
$omnitron kill
$omnitron start echo.js
sleep 1

should 'should have versioning metadata' 'jshkurti/omnitron_travis' 1

$omnitron delete all
$omnitron start echo.js --no-vizion
sleep 1

should 'should not have versioning metadata' 'jshkurti/omnitron_travis' 0

$omnitron delete all
$omnitron start no-vizion.json
sleep 1

should 'should not have versioning metadata' 'jshkurti/omnitron_travis' 0

mv .git git
