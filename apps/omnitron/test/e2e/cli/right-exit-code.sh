#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron kill

$omnitron restart BULLSHIT
ispec "Unknown process = error exit"

$omnitron restart 666
ispec "Unknown process = error exit"

$omnitron restart all
ispec "No process = error exit"

$omnitron stop all
ispec "No process = error exit"

$omnitron delete 10
ispec "No process = error exit"

$omnitron delete toto
ispec "No process = error exit"
