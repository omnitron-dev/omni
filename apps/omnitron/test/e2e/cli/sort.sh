#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path/sort

$omnitron start http.js
$omnitron start other.js


$omnitron list --sort=name > /tmp/tmp_out.txt

OUT=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "http" -m 1 | cut -f1 -d:`
OUT2=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "other" -m 1 | cut -f1 -d:`

[ $OUT -lt $OUT2 ] || fail "should sort app by name (asc)"
success "should sort app by name (asc)"

$omnitron list --sort=name:desc > /tmp/tmp_out.txt

OUT=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "http" -m 1 | cut -f1 -d:`
OUT2=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "other" -m 1 | cut -f1 -d:`

[ $OUT -gt $OUT2 ] || fail "should sort app by name (desc)"
success "should sort app by name (desc)"


$omnitron list --sort=id > /tmp/tmp_out.txt

OUT=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "http" -m 1 | cut -f1 -d:`
OUT2=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "other" -m 1 | cut -f1 -d:`

[ $OUT -lt $OUT2 ] || fail "should sort app by id (asc)"
success "should sort app by id (asc)"

$omnitron list --sort=id:desc > /tmp/tmp_out.txt

OUT=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "http" -m 1 | cut -f1 -d:`
OUT2=`cat /tmp/tmp_out.txt | grep -v "npm" | grep -no "other" -m 1 | cut -f1 -d:`

[ $OUT -gt $OUT2 ] || fail "should sort app by id (desc)"
success "should sort app by id (desc)"
