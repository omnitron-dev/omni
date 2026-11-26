/** Both functions are embedded in the Fleet receiver for older installations. */
export async function syncRuntimeEntries(entries: string[], directory: boolean): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  // All admitted descriptors settle even if a sibling fails. Groups span small
  // package directories, whose files would otherwise flush one at a time.
  for (let offset = 0; offset < entries.length; offset += 16) {
    const results = await Promise.allSettled(entries.slice(offset, offset + 16).map(async file => {
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
        (directory ? constants.O_DIRECTORY : 0));
      try {
        const stat = await handle.stat();
        if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('Runtime entry changed before durability check');
        await handle.sync();
      } finally { await handle.close(); }
    }));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'Runtime files could not be made durable');
  }
}

/** Publish a verified, private staging tree on the registry filesystem. */
export async function publishRuntimeTree(staging: string, destination: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const level: string[][] = [[staging]];
  const files: string[] = [];
  for (let depth = 0; depth < level.length; depth++) {
    const children: string[] = [];
    for (const directory of level[depth]!) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isFile()) files.push(file);
        else if (entry.isDirectory()) children.push(file);
        else if (!entry.isSymbolicLink()) throw Error('Unsupported runtime entry during publication');
      }
    }
    if (children.length) level.push(children);
  }

  await syncRuntimeEntries(files, false);
  for (const directories of level.reverse()) await syncRuntimeEntries(directories, true);
  try {
    await fs.lstat(destination);
    throw Error('A release already occupies the publication destination');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.rename(staging, destination);
  await syncRuntimeEntries([...new Set([path.dirname(destination), path.dirname(staging)])], true);
}
