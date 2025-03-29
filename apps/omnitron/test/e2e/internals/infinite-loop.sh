#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

echo "Starting infinite loop tests"

$omnitron start killtoofast.js --name unstable-process

echo -n "Waiting for process to restart too many times and omnitron to stop it"

for (( i = 0; i <= 100; i++ )); do
    sleep 0.1
    echo -n "."
done


$omnitron list
should 'should has stopped unstable process' 'errored' 1

$omnitron delete all

echo "Start infinite loop tests for restart|reload"

cp killnotsofast.js killthen.js

$omnitron start killthen.js --name killthen

$omnitron list

should 'should killthen alive for a long time' 'online' 1

# Replace killthen file with the fast quit file

sleep 15
cp killtoofast.js killthen.js

echo "Restart with unstable process"

$omnitron list

$omnitron restart all  # omnitron reload should also work here

for (( i = 0; i <= 80; i++ )); do
    sleep 0.1
    echo -n "."
done

$omnitron list

should 'should has stoped unstable process' 'errored' 1

rm killthen.js

$omnitron list

$omnitron kill
