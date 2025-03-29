#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path/interpreter

########### typescript fork test
$omnitron delete all

>typescript.log

$omnitron start echo.ts -o typescript.log --merge-logs

sleep 1.5

grep "Hello Typescript!" typescript.log
spec "Should work on Typescript files in fork mode"

# ########### typescript cluster test
$omnitron delete all

>typescript.log

$omnitron start echo.tsx -o typescript.log --merge-logs

sleep 1.5

grep "Hello Typescript!" typescript.log
spec "Should work on Typescript files in fork mode"

$omnitron delete all
