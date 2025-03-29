#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

function head {
  echo -e "\x1B[1;35m$1\x1B[0m"
}
function rm_omnitronlog {
  if [ "$1" -ne 1 ]; then
    $omnitron kill
    rm -rf ~/.omnitron/omnitron.log
  fi
}
function grep_log {

    echo "travis"
    eval "$omnitron $1 >| omnitron.log"
    sleep 0.3
    OUT=`cat omnitron.log | grep -n "[0-9]\{4\}\-[0-9]\{2\}\-[0-9]\{2\}" | wc -l`
}
function no_prefix {
  eval "grep_log \"$1\""
  echo "line count: $OUT"
  [ $OUT -eq 0 ] || fail "expect no timestamp prefix in omnitron.log, but currently existing."
  success "have no timestamp prefix"
  rm_omnitronlog "$2"
}
function prefix {
  eval "grep_log \"$1\""
  echo "line count: $OUT"
  [ $OUT -ne 0 ] || fail "expect have timestamp prefix in omnitron.log, but currently does not exist."
  success "have timestamp prefix"

  rm_omnitronlog "$2"
}

cd $file_path

$omnitron kill

sleep 0.5

$omnitron flush

unset OMNITRON_LOG_DATE_FORMAT
export OMNITRON_LOG_DATE_FORMAT=""

head ">> LIST (NO PREFIX)"
no_prefix "ls" 0

head ">> START (NO PREFIX)"
no_prefix "start echo.js" 1

head ">> RESTART (NO PREFIX)"
no_prefix "restart echo" 1

head ">> STOP (NO PREFIX)"
no_prefix "stop echo" 0

head ">> START JSON (NO PREFIX)"
no_prefix "start echo-omnitron.json" 1

head ">> RESTART JSON (NO PREFIX)"
no_prefix "restart echo-omnitron.json" 1

head ">> STOP-JSON (NO PREFIX)"
no_prefix "stop echo-omnitron.json" 0

export OMNITRON_LOG_DATE_FORMAT="YYYY-MM-DD HH:mm Z"

head ">> LIST (PREFIX)"
prefix "ls" 0

head ">> START (PREFIX)"
prefix "start echo.js" 1

head ">> RESTART (PREFIX)"
prefix "restart echo" 1

head ">> STOP (PREFIX)"
prefix "stop echo" 0

head ">> START JSON (PREFIX)"
prefix "start echo-omnitron.json" 1

head ">> RESTART JSON (PREFIX)"
prefix "restart echo-omnitron.json" 1

head ">> STOP-JSON (PREFIX)"
prefix "restart echo-omnitron.json" 0

rm -rf omnitron.log
unset OMNITRON_LOG_DATE_FORMAT
touch ~/.omnitron/omnitron.log
