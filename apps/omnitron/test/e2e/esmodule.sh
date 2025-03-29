#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/include.sh"

# Bootstrap one app
cd $file_path/esmodules/mjs

#### FORK MODE

$omnitron delete all

$omnitron start index.mjs
sleep 2
should 'should have detected es module via .mjs file extension and started 1 app' 'online' 1
should 'should have application in stable state' 'restart_time: 0' 1

$omnitron restart index
sleep 2
should 'should have detected es module via .mjs file extension and started 1 app' 'online' 1
should 'should have application in stable state' 'restart_time: 1' 1

$omnitron delete all

cd $file_path/esmodules/packagemodule

$omnitron start index.js
sleep 2
should 'should have detected es module via .mjs file extension and started 1 app' 'online' 1
should 'should have application in stable state' 'restart_time: 0' 1

$omnitron restart index
sleep 2
should 'should have detected es module via .mjs file extension and started 1 app' 'online' 1
should 'should have application in stable state' 'restart_time: 1' 1

$omnitron save

$omnitron update

sleep 2
should 'should have detected es module via .mjs file extension and started 1 app' 'online' 1
should 'should have application in stable state' 'restart_time: 0' 1

#### CLUSTER MODE

cd $file_path/esmodules/mjs

$omnitron delete all

$omnitron start index.mjs -i 4
sleep 2
should 'should have detected es module via .mjs file extension and started 4 apps' 'online' 4
should 'should have application in stable state' 'restart_time: 0' 4

$omnitron restart index
sleep 2
should 'should have detected es module via .mjs file extension and started 4 app' 'online' 4
should 'should have application in stable state' 'restart_time: 1' 4

$omnitron delete all

cd $file_path/esmodules/packagemodule

$omnitron start index.js -i 4
sleep 2
should 'should have detected es module via .mjs file extension and started 4 apps' 'online' 4
should 'should have application in stable state' 'restart_time: 0' 4

$omnitron restart index
sleep 2
should 'should have detected es module via .mjs file extension and started 4 app' 'online' 4
should 'should have application in stable state' 'restart_time: 1' 4

$omnitron delete all
