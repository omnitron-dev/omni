#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

#
# Re init module system
#
rm -rf ~/.omnitron/node_modules
$omnitron kill
#
#
#

$omnitron unset omnitron-probe

$omnitron set 'omnitron-probe:config1xxx' true

$omnitron install omnitron-probe@latest
spec "Should install a module"
should 'should app be online' 'online' 1

$omnitron install omnitron-probe@latest
spec "Should update a module"
should 'should app be online' 'online' 1

ls ~/.omnitron/modules/omnitron-probe
spec "Module should be installed"


# Default configuration variable in package.json (under "config" attribute)
should 'should have default config variable via package.json' "var2: false" 4 3

#
# Should configuration variable be present two times
# one time in the raw env, and a second time prefixed with the module name
#
exists '1# should have config variable' "config1xxx: 'true'" 6

#
# Change variable value
#

$omnitron set 'omnitron-probe:config1xxx' false

sleep 1

exists '2# should have config variable' "config1xxx: 'false'" 4

$omnitron update
spec "Should update successfully"
should 'and module still online' 'online' 1

$omnitron kill
spec "Should kill omnitron"

$omnitron list
spec "Should resurrect omnitron"
should 'and module still online' 'online' 1


$omnitron delete all
should 'should module status not be modified' 'online' 1

$omnitron stop all
should 'should module status not be modified' 'online' 1

$omnitron stop omnitron-probe
should 'should module be possible to stop' 'stopped' 1

$omnitron uninstall omnitron-probe
spec "Should uninstall a module"
should 'should module not be online' 'online' 0

ls ~/.omnitron/modules/omnitron-probe
ispec "Module should be deleted"

$omnitron update
should 'should module not be online' 'online' 0

#
# Module test
#

cd module-fixture

$omnitron kill

# Unset all possible variables for module
$omnitron unset example-module

# Install local module in development mode
$omnitron install .
sleep 0.5
spec 'Should have installed module'


# # Override environment variable
# $omnitron set example-module:var2 true
# sleep 0.5
# should 'should module been restarted after setting variable' 'restart_time: 1' 1

# # 4 occurences because of a restart
# should 'should have config variable modified' "var2: 'true'" 4

# $omnitron set example-module:newvar true
# sleep 0.5
# should 'should module been restarted after setting variable' 'restart_time: 2' 1

# # 4 occurences because of a restart
# should 'should have config variable modified' "newvar: 'true'" 4
