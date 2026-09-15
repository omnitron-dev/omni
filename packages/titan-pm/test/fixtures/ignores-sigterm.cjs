// A child that installs a SIGTERM handler and keeps running — which is what a
// titan child does, and the exact shape `child.killed` misreports.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
if (process.send) process.send({ type: 'ready' });
