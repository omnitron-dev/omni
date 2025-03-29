#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

function getInterpreter() {
	echo `$omnitron prettylist | grep "exec_interpreter:" | awk -F"'" '{print $2}'`
}

#
# Testing omnitron execution of binary files
#
$omnitron start `type -p watch` -- ls

OUT=$(getInterpreter)

[ $OUT="none" ] || fail "$1"
success "$1"

$omnitron kill
$omnitron start binary-js-file

OUT=$(getInterpreter)
echo $OUT

[ $OUT="node" ] || fail "$1"
success "$1"

$omnitron kill
$omnitron start binary-js-file.js

OUT=$(getInterpreter)
[ $OUT="node" ] || fail "$1"
success "$1"

$omnitron kill
$omnitron start binary-py-file.py

OUT=$(getInterpreter)
[ $OUT="python" ] || fail "$1"
success "$1"

$omnitron kill

#
# Should execute command in $PATH
#
$omnitron start ls
spec "Should script started"

OUT=$(getInterpreter)
[ $OUT="none" ] || fail "$1"
success "Right interpreter"

should 'Have the right relative path' '/bin/ls' 1
