#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron start echo.js
$omnitron prettylist | grep "km_link: false"
spec "should km_link not be enabled"

$omnitron plus alcz82ewyhy2va6 litfrsovr52celr --install-all

should 'have started 3 apps' 'online' 3
should 'all application be monitored' 'km_link: true' 3

$omnitron plus delete

should 'have started 1 apps' 'online' 1
$omnitron prettylist | grep "km_link: false"
spec "should km_link be disabled"
