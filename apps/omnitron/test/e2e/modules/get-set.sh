#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

$omnitron unset all
spec "Should unset all variables"

ls ~/.omnitron/module_conf.json
spec "Should file exists"

$omnitron get

$omnitron set key1 val1
cat ~/.omnitron/module_conf.json | grep "key1"
spec "Should key exists"

$omnitron unset key1
cat ~/.omnitron/module_conf.json | grep "key1"
ispec "Should key does not exist"

rm -rf ~/.omnitron
