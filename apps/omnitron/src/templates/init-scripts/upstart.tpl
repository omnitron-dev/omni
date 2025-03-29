#!/bin/bash
### BEGIN INIT INFO
# Provides:        omnitron
# Required-Start:  $local_fs $remote_fs $network
# Required-Stop:   $local_fs $remote_fs $network
# Default-Start:   2 3 4 5
# Default-Stop:    0 1 6
# Short-Description: OMNITRON Init script
# Description: OMNITRON process manager
### END INIT INFO

NAME=omnitron
OMNITRON=%OMNITRON_PATH%
USER=%USER%
DEFAULT=/etc/default/$NAME

export PATH=%NODE_PATH%:$PATH
export OMNITRON_HOME="%HOME_PATH%"

# The following variables can be overwritten in $DEFAULT

# maximum number of open files
MAX_OPEN_FILES=

# overwrite settings from default file
if [ -f "$DEFAULT" ]; then
    . "$DEFAULT"
fi

# set maximum open files if set
if [ -n "$MAX_OPEN_FILES" ]; then
    ulimit -n $MAX_OPEN_FILES
fi

get_user_shell() {
    local shell
    shell=$(getent passwd "${1:-$(whoami)}" | cut -d: -f7 | sed -e 's/[[:space:]]*$//')

    if [[ $shell == *"/sbin/nologin" ]] || [[ $shell == "/bin/false" ]] || [[ -z "$shell" ]];
    then
      shell="/bin/bash"
    fi

    echo "$shell"
}

super() {
    local shell
    shell=$(get_user_shell $USER)
    su - "$USER" -s "$shell" -c "PATH=$PATH; OMNITRON_HOME=$OMNITRON_HOME $*"
}

start() {
    echo "Starting $NAME"
    super $OMNITRON resurrect
}

stop() {
    super $OMNITRON kill
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
    force-reload)
        reload
        ;;
    *)
        echo "Usage: {start|stop|status|restart|reload|force-reload}"
        exit 1
        ;;
esac
exit $RETVAL
