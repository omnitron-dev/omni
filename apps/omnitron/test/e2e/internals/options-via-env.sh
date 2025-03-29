
#!/usr/bin/env bash

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

# With start
$omnitron start echo.js
should 'should deep_monitoring' 'deep_monitoring' 0

$omnitron delete all

OMNITRON_DEEP_MONITORING=true $omnitron start echo.js
should 'should deep_monitoring' 'deep_monitoring' 1

$omnitron delete all

# With restart
$omnitron start echo.js
should 'should deep_monitoring' 'deep_monitoring' 0
OMNITRON_DEEP_MONITORING=true $omnitron restart echo
should 'should deep_monitoring' 'deep_monitoring' 1
