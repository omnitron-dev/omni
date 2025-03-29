#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"
cd $file_path

echo -e "\033[1mRunning tests for json files :\033[0m"

## alias "apps" to "omnitron" = nicer for package.json
$omnitron start omnitron-ecosystem.json
should 'should start processes' 'online' 6

$omnitron delete all.json
should 'should delete all processes' 'name' 0

$omnitron kill

OMNITRON_WORKER_INTERVAL=90000 $omnitron start all.json
should 'should start processes' 'online' 6

$omnitron stop all.json
should 'should stop processes' 'stopped' 6

$omnitron delete all.json
should 'should delete all processes' 'name' 0

$omnitron start all.json
should 'should start processes' 'online' 6

$omnitron restart all.json
should 'should stop processes' 'online' 6
should 'should all script been restarted one time' 'restart_time: 1' 6

$omnitron reload all.json
sleep 1
should 'should reload processes' 'online' 6
should 'should all script been restarted one time' 'restart_time: 2' 6

##
## Smart restart
##
$omnitron start all.json
sleep 1
should 'should smart restart processes' 'online' 6
should 'should all script been restarted one time' 'restart_time: 3' 6

$omnitron stop all.json
sleep 1
should 'should stop processes' 'stopped' 6

$omnitron start all.json
should 'should smart restart processes' 'online' 6

# $omnitron stop all.json
# sleep 1
# should 'should stop processes' 'stopped' 6

# $omnitron start all
# should 'should smart restart processes' 'online' 6

$omnitron kill

########## JS style

OMNITRON_WORKER_INTERVAL=90000 $omnitron start configuration.json
should 'should start processes' 'online' 6

$omnitron stop configuration.json
should 'should stop processes' 'stopped' 6

$omnitron delete configuration.json
should 'should start processes' 'online' 0

$omnitron start configuration.json
should 'should start processes' 'online' 6

$omnitron restart configuration.json
should 'should stop processes' 'online' 6
should 'should all script been restarted one time' 'restart_time: 1' 6

$omnitron delete configuration.json
should 'should delete processes' 'online' 0

########## PIPE command

$omnitron kill

cat all.json | $omnitron start -
should 'should start processes' 'online' 6

$omnitron kill

######### --only <app_name> option

$omnitron start all.json --only echo
should 'should start processes' 'online' 1

$omnitron start all.json --only child
should 'should start processes' 'online' 5

$omnitron restart all.json --only child
should 'should start processes' 'online' 5
should 'should all script been restarted one time' 'restart_time: 1' 4

$omnitron delete all.json --only echo
should 'should start processes' 'online' 4

$omnitron reload all.json --only child
should 'should all script been restarted one time' 'restart_time: 2' 4

######## multu only

$omnitron start all.json --only "echo,child"
should 'should start processes' 'online' 5

$omnitron kill
