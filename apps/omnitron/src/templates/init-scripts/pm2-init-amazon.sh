#!/bin/bash
#
# omnitron Process manager for NodeJS
#
# chkconfig: 345 80 20
#
# description: OMNITRON next gen process manager for Node.js
# processname: omnitron
#
### BEGIN INIT INFO
# Provides:          omnitron
# Required-Start: $local_fs $remote_fs
# Required-Stop: $local_fs $remote_fs
# Should-Start: $network
# Should-Stop: $network
# Default-Start:        2 3 4 5
# Default-Stop:         0 1 6
# Short-Description: OMNITRON init script
# Description: OMNITRON is the next gen process manager for Node.js
### END INIT INFO

NAME=omnitron
OMNITRON=%OMNITRON_PATH%
USER=%USER%

export PATH=%NODE_PATH%:$PATH
export OMNITRON_HOME="%HOME_PATH%"

lockfile="/var/lock/subsys/omnitron-init.sh"

super() {
    su - $USER -c "PATH=$PATH; OMNITRON_HOME=$OMNITRON_HOME $*"
}

start() {
    echo "Starting $NAME"
    super $OMNITRON resurrect
    retval=$?
    [ $retval -eq 0 ] && touch $lockfile
}

stop() {
    echo "Stopping $NAME"
    super $OMNITRON kill
    rm -f $lockfile
}

restart() {
    echo "Restarting $NAME"
    stop
    start
}

reload() {
    echo "Reloading $NAME"
    super $OMNITRON reload all
}

status() {
    echo "Status for $NAME:"
    super $OMNITRON list
    RETVAL=$?
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        restart
        ;;
    reload)
        reload
        ;;
    *)
        echo "Usage: {start|stop|status|restart|reload}"
        exit 1
        ;;
esac
exit $RETVAL
