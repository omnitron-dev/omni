#!/usr/bin/env bash

#
# LSOF check
#

SRC=$(cd $(dirname "$0"); pwd)
source "${SRC}/../include.sh"

cd $file_path

echo "################## RELOAD ###################"

# lsof -c OMNITRON > /tmp/no_omnitron_out.dat

# $omnitron list

# sleep 1
# lsof -c OMNITRON > /tmp/empty_omnitron_out.dat

# $omnitron start echo.js -i 3
# $omnitron start killtoofast.js -i 3
# $omnitron delete all

# sleep 3
# lsof -c OMNITRON > /tmp/empty_omnitron_out2.dat

# OUT1=`cat /tmp/empty_omnitron_out.dat | wc -l`
# OUT2=`cat /tmp/empty_omnitron_out2.dat | wc -l`

# if [ $OUT1 -eq $OUT2 ]; then
#   success "All file descriptors have been closed"
# else
#   fail "Some file descriptors are still open"
# fi

# $omnitron start killtoofast.js -i 6
# $omnitron kill

# rm /tmp/no_omnitron_out.dat
# rm /tmp/no_omnitron_out2.dat
# rm /tmp/empty_omnitron_out.dat
# rm /tmp/empty_omnitron_out2.dat

# sleep 6
> /tmp/no_pm_omnitron_out.dat
> /tmp/no_pm_omnitron_out2.dat

lsof -c OMNITRON > /tmp/no_omnitron_out2.dat
diff /tmp/no_omnitron_out.dat /tmp/no_omnitron_out2.dat

if [ $? == "0" ]; then
  success "All file descriptors have been closed"
else
  fail "Some file descriptors are still open"
fi

rm /tmp/no_omnitron_out.dat
rm /tmp/no_omnitron_out2.dat
rm /tmp/empty_omnitron_out.dat
rm /tmp/empty_omnitron_out2.dat
