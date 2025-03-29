#!/usr/bin/env bash

if [ "$EUID" -ne 0 ]
then
    echo "Please run as root"
    exit
fi

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path
$omnitron startup upstart -u $USER --hp $HOME --service-name abcdef
spec "should startup command generation exited succesfully with custom service-name"
test -e /etc/init.d/abcdef
spec "should have generated upstart file with custom service-name"
$omnitron unstartup upstart --service-name abcdef
spec "should have disabled startup with custom service-name"
! test -e /etc/init.d/abcdef
spec "should have deleted upstart file with custom service-name"

$omnitron startup upstart -u $USER --hp $HOME
spec "should startup command generation exited succesfully"
test -e /etc/init.d/omnitron-$USER
spec "should have generated upstart file"
$omnitron unstartup upstart
spec "should have disabled startup"
! test -e /etc/init.d/omnitron-$USER
spec "should have deleted upstart file"
