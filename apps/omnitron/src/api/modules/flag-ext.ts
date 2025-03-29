import fs from 'fs';

function find_extensions(folder: string, ext: RegExp[], ret: string[]): void {
  try {
    fs.accessSync(folder, fs.constants.R_OK);
  } catch (err) {
    return;
  }
  // eslint-disable-next-line no-bitwise
  if (fs.statSync(folder).isDirectory() && folder.indexOf('node_modules') == -1 && fs.statSync(folder).mode & 4) {
    fs.readdirSync(folder).forEach((file: string) => {
      let tmp: string;
      if (folder.lastIndexOf('/') + 1 === folder.length) tmp = folder + file;
      else tmp = folder + '/' + file;
      if (fs.statSync(tmp).isDirectory()) find_extensions(tmp, ext, ret);
      else {
        let p = true;
        for (let i = 0; i < ext.length; i++) {
          if (ext[i]?.test(file)) {
            p = false;
          }
        }
        if (p) ret.push(folder + '/' + file);
      }
    });
  }
}

export function make_available_extension(opts: { ext: string }, ret: string[]): void {
  if (typeof opts == 'object' && typeof ret == 'object') {
    const mas = opts.ext.split(',');
    for (let i = 0; i < mas.length; i++) mas[i] = '.' + mas[i];
    const res: RegExp[] = [];
    for (let i = 0; i < mas.length; i++) res[i] = new RegExp(mas[i] + '$');
    find_extensions(process.cwd(), res, ret);
  }
}
