#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path/stdin

$omnitron start stdin.js -o out-rel.log --merge-logs
>out-rel.log

# Send LINE\n to stdin application
$omnitron send 0 "LINE"

cat out-rel.log
grep "LINE" out-rel.log
spec "Should have reveived line"

$omnitron delete all
