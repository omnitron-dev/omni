import { spawn } from 'child_process';

function execDocker(cmd, cb) {
  const i = spawn('docker', cmd, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });

  i.on('close', cb);
}

export const dockerProcessCommand = (
  OMNITRON: any,
  start_id: number,
  select_id: number,
  action: string,
  cb: (err: Error) => void
) => {
  OMNITRON.executeRemote('getSystemData', {}, (err, sys_infos) => {
    if (sys_infos.containers && sys_infos.containers.length == 0) {
      cb(new Error(`Process ${select_id} not found`));
      return;
    }
    const container = sys_infos.containers[select_id - start_id - 1];
    if (action == 'stopProcessId') execDocker(['stop', container.id], cb);
    if (action == 'deleteProcessId') execDocker(['rm', container.id], cb);
    if (action == 'restartProcessId') execDocker(['restart', container.id], cb);
  });
};
