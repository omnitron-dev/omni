#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path/promise/

# Check for 0.10 & 0.12 support
node -e "process.version.indexOf('v0') > -1 ? process.exit(1) : process.exit(0)"
RET=$?
[ $RET -eq 0 ] || exit 0

echo "###### Cluster mode"
> rejection.log
$omnitron start rejection.js -i 1 -l rejection.log --merge-logs
sleep 1
should 'should has not restarted process' 'restart_time: 0' 1
cat rejection.log | grep "Errorla"
spec "should have logged promise error"

$omnitron delete all

> empty-rejection.log
$omnitron start empty-rejection.js -i 1 -l empty-rejection.log --merge-logs
sleep 1
should 'should has not restarted process' 'restart_time: 0' 1

cat empty-rejection.log | grep "You have triggered an unhandledRejection, you may have forgotten to catch a Promise rejection"
spec "should have logged promise error"

$omnitron delete all

echo "###### Fork mode"

> rejection.log
$omnitron start rejection.js -l rejection.log --merge-logs
sleep 1
should 'should has not restarted process' 'restart_time: 0' 1

cat rejection.log | grep "You have triggered an unhandledRejection, you may have forgotten to catch a Promise rejection"
spec "should have logged promise error"

$omnitron delete all

> empty-rejection.log
$omnitron start empty-rejection.js -l empty-rejection.log --merge-logs
sleep 1
should 'should has not restarted process' 'restart_time: 0' 1

cat empty-rejection.log | grep "You have triggered an unhandledRejection, you may have forgotten to catch a Promise rejection"
spec "should have logged promise error"
