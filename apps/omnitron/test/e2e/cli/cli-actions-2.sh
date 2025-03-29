#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

############# Start / Stop / Restart
echo "---- Start an app, stop it, if state stopped and started, restart stopped app"
$omnitron start echo.js
spec "Should start an app by script.js"
$omnitron stop echo.js
spec "Should stop an app by script.js"
$omnitron restart echo.js
spec "Should restart an app by script.js (TRANSITIONAL STATE)"

############### Start edge case

$omnitron delete all

echo "Start application with filename starting with a numeric"
$omnitron start 001-test.js
should 'should app be online' 'online' 1
$omnitron stop 001-test
should 'should app be stopped' 'stopped' 1
$omnitron restart 001-test
should 'should app be online once restart called' 'online' 1


############## PID

$omnitron delete all
$omnitron start 001-test.js --name "test"
should 'should app be online' 'online' 1
$omnitron pid > /tmp/pid-tmp
$omnitron pid test

###############

$omnitron delete all
echo "Start application with filename starting with a numeric"
$omnitron start throw-string.js -l err-string.log --merge-logs --no-automation
>err-string.log
sleep 1
grep 'throw-string.js' err-string.log
spec "Should have written raw stack when throwing a string"

####

$omnitron delete all

$omnitron start echo.js --name gege
should 'should app be online' 'online' 1
$omnitron stop gege
should 'should app be stopped' 'stopped' 1
$omnitron restart gege
should 'should app be online once restart called' 'online' 1

###############
$omnitron delete all

echo "---- BY_NAME Start an app, stop it, if state stopped and started, restart stopped app"

$omnitron start echo.js --name gege
should 'should app be online' 'online' 1
$omnitron stop gege
should 'should app be stopped' 'stopped' 1
$omnitron restart gege
should 'should app be online once restart called' 'online' 1

###############
$omnitron delete all

echo "Start an app, start it one more time, if started, throw message"
$omnitron start echo.js
$omnitron start echo.js
ispec "Should not re start app"

########### DELETED STUFF BY ID
$omnitron delete all

$omnitron start echo.js
$omnitron delete 0
should 'should has been deleted process by id' "name: 'echo'" 0

########### DELETED STUFF BY NAME
$omnitron delete all

$omnitron start echo.js --name test
$omnitron delete test
should 'should has been deleted process by name' "name: 'test'" 0

########### DELETED STUFF BY SCRIPT
$omnitron delete all

$omnitron start echo.js
$omnitron delete echo.js
$omnitron list
should 'should has been deleted process by script' "name: 'echo'" 0

######## Actions on app name as number (#1937)
$omnitron delete all
$omnitron start echo.js --name "455"
should 'should restart processes' 'restart_time: 0' 1
$omnitron restart 455
should 'should restart processes' 'restart_time: 1' 1
$omnitron restart 0
should 'should restart processes' 'restart_time: 2' 1
$omnitron stop 455
should 'should app be stopped' 'stopped' 1
$omnitron delete 455
should 'should has been deleted process by id' "name: '455'" 0

$omnitron kill
########### OPTIONS OUTPUT FILES
$omnitron delete all

$omnitron start echo.js -o outech.log -e errech.log --name gmail -i 2
sleep 2
cat outech-0.log > /dev/null
spec "file outech-0.log exist"
cat errech-0.log > /dev/null
spec "file errech-0.log exist"

########### Stdout / Stderr

rm stdout-stderr.log
$omnitron start stdout-stderr.js -l stdout-stderr.log --merge-logs
sleep 2
cat stdout-stderr.log | grep "outwrite"
spec "stdout written"
cat stdout-stderr.log | grep "outcb"
spec "stdout cb written"
cat stdout-stderr.log | grep "errwrite"
spec "stderr written"
cat stdout-stderr.log | grep "errcb"
spec "stderr cb written"

$omnitron delete all

## #2350 verify all script have been killed
$omnitron start python-script.py
$omnitron start echo.js
should 'should app be online' 'online' 2

kill `cat ~/.omnitron/omnitron.pid`
spec "should have killed omnitron"

sleep 3
# pgrep "python"
# ispec "should python script be killed"
