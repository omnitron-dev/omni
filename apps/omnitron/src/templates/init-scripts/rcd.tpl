#!/bin/sh

# PROVIDE: omnitron
# REQUIRE: LOGIN
# KEYWORD: shutdown

. /etc/rc.subr

name="%SERVICE_NAME%"
rcvar="%SERVICE_NAME%_enable"

start_cmd="omnitron_start"
stop_cmd="omnitron_stop"
reload_cmd="omnitron_reload"
status_cmd="omnitron_status"
extra_commands="reload status"

omnitron()
{
  env PATH="$PATH:%NODE_PATH%" OMNITRON_HOME="%HOME_PATH%" su -m "%USER%" -c "%OMNITRON_PATH% $*"
}

omnitron_start()
{
  omnitron resurrect
}

omnitron_stop()
{
  omnitron kill
}

omnitron_reload()
{
  omnitron reload all
}

omnitron_status()
{
  omnitron list
}

load_rc_config $name
run_rc_command "$1"
