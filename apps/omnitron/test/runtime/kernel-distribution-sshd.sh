#!/bin/sh
# Entry inside a disposable Linux root with its own network, mount and PID
# namespaces. Supply the compiled SDK and this test directory. The only listener
# is the fixture's loopback OpenSSH/SFTP service.
set -eu
test "$(id -u)" = 0
test "$(stat -c '%u:%a' /run/omnitron-kernel-qa/disposable)" = 0:600
set -- "$1" "$2" /sys/class/net/*
test "$#" = 3 && test "$3" = /sys/class/net/lo
test ! -e /root/.omnitron && test ! -e /home/receiver/.omnitron
dist=$1
testdir=$2
qa=/run/omnitron-kernel-qa
service=/home/receiver/.omnitron
mkdir -m 700 /root/.omnitron /root/.ssh
install -d -m 700 -o receiver -g receiver "$service" /home/receiver/tmp /home/receiver/.ssh
install -m 600 -o receiver -g receiver /dev/null "$service/config.json"
ln -s "$service/config.json" /root/.omnitron/config.json
ssh-keygen -q -t ed25519 -N '' -f "$qa/host"
umask 077
openssl rand -hex 32 > "$service/fixture-password"
chown receiver:receiver "$service/fixture-password"
printf 'root:%s\n' "$(openssl passwd -6 -stdin < "$service/fixture-password")" | chpasswd -e
ssh-keygen -lf "$qa/host.pub" | cut -d' ' -f2 > "$qa/pin"
chmod 644 "$qa/pin"
mkdir -p /run/sshd
cat > "$qa/sshd_config" <<'SSHD'
Port 2222
ListenAddress 127.0.0.1
HostKey /run/omnitron-kernel-qa/host
PidFile /run/omnitron-kernel-qa/sshd.pid
PermitRootLogin yes
AuthenticationMethods password
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM no
DisableForwarding yes
PermitTTY no
Subsystem sftp internal-sftp
SSHD
/usr/sbin/sshd -t -f "$qa/sshd_config"
/usr/sbin/sshd -f "$qa/sshd_config" -E "$qa/sshd.log"
trap 'kill "$(cat "$qa/sshd.pid")" 2>/dev/null || true' EXIT
setpriv --reuid=receiver --regid=receiver --clear-groups /usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/receiver TMPDIR=/home/receiver/tmp \
  node "$testdir/kernel-distribution.mjs" "$dist" --ssh-fixture
