#!/bin/bash

while [ true ]
do
    OMNITRON_PID=`pgrep "omnitron: Daemon" -o`

    # Run garbage collector
    kill -SIGILL $OMNITRON_PID
    sleep 5

    FILE="/proc/$OMNITRON_PID/smaps"
    Rss=`echo 0 $(cat $FILE  | grep Rss | awk '{print $2}' | sed 's#^#+#') | bc;`

    echo `date +%H:%M:%S` $Rss >> $RESULT_FILE
    sleep 100
done
