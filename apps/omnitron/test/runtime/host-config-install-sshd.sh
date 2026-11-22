#!/bin/sh
# Secondary container of the private configuration qualification. Only its generated public key is shared.
set -eu
[ "${OMNITRON_DISPOSABLE_HOST_CONFIG_TEST:-}" = 1 ] && [ "$(id -u)" = 0 ] || exit 2
namespace=0
if [ ! -e /.dockerenv ]; then
    [ -f /run/omnitron-disposable-host-config-namespace ] && [ "$(stat -f -c %T /)" = tmpfs ] && [ "$(stat -f -c %T /usr)" = overlayfs ] || exit 2
    namespace=1
fi
set -- /sys/class/net/*
[ "$#" -eq 1 ] && [ "${1##*/}" = lo ] && [ -d /fixture-public ] && [ ! -e /fixture-public/host.pub ] || exit 2
awk -v ns="$namespace" '$5 ~ "^/(etc|usr)(/|$)" && $5 !~ "^/etc/(hostname|hosts|resolv.conf)$" && !($5 == "/usr" && ns) { exit 1 }' /proc/self/mountinfo
mkdir -m 700 /tmp/qa-sshd
mkdir -p /run/sshd
ssh-keygen -q -t ed25519 -N '' -f /tmp/qa-sshd/host
cp /tmp/qa-sshd/host.pub /fixture-public/host.pub
if [ "$namespace" -eq 0 ]; then passwd -d root >/dev/null; fi
cat >/tmp/qa-sshd/config <<'SSHD'
Port 27433
ListenAddress 127.0.0.1
HostKey /tmp/qa-sshd/host
PermitRootLogin prohibit-password
AuthenticationMethods publickey
AuthorizedKeysFile /fixture-public/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
AllowTcpForwarding local
AllowStreamLocalForwarding local
AllowAgentForwarding no
PermitTTY no
X11Forwarding no
MaxSessions 0
PidFile /tmp/qa-sshd/master.pid
LogLevel VERBOSE
SSHD
sed -e 's/27433/27434/' -e 's/AllowTcpForwarding local/AllowTcpForwarding no/' \
    -e 's/master.pid/blocked.pid/' /tmp/qa-sshd/config > /tmp/qa-sshd/blocked
for config in config blocked; do
    /usr/sbin/sshd -t -f /tmp/qa-sshd/"$config"
    /usr/sbin/sshd -T -f /tmp/qa-sshd/"$config" -C user=root,host=localhost,addr=127.0.0.1,laddr=127.0.0.1 \
        | awk '/^(allowtcpforwarding|allowstreamlocalforwarding|authenticationmethods|authorizedkeysfile|disableforwarding|maxsessions|permitopen|permitrootlogin) /' \
        > /fixture-public/effective-"$config"
done
/usr/sbin/sshd -f /tmp/qa-sshd/blocked -E /tmp/qa-sshd/blocked.log
exec /usr/sbin/sshd -D -e -f /tmp/qa-sshd/config
