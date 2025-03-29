
#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

echo "################## RESET ###################"

#
# BY ID
#
$omnitron start echo.js
should 'should restarted be one for all' 'restart_time: 0' 1

$omnitron restart 0
should 'should process restarted' 'restart_time: 1' 1

$omnitron reset 0
should 'should process reseted' 'restart_time: 0' 1

#
# BY NAME
#
$omnitron start echo.js -i 4 -f
should 'should restarted be one for all' 'restart_time: 0' 5

$omnitron restart echo
should 'should process restarted' 'restart_time: 1' 5

$omnitron reset echo
should 'should process reseted' 'restart_time: 0' 5


#
# ALL
#
$omnitron restart all
$omnitron restart all
$omnitron restart all
should 'should process restarted' 'restart_time: 3' 5

$omnitron reset all
should 'should process reseted' 'restart_time: 0' 5

#
# Restart delay test
#

$omnitron delete all
$omnitron start killtoofast.js --restart-delay 5000
should 'should process not have been restarted yet' 'restart_time: 0' 1

$omnitron kill
