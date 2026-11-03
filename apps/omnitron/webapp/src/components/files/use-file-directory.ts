import { useEffect, useRef, useState } from 'react';
import type { FileEntry, FileLocation, FileRoot } from '@omnitron-dev/omnitron/dto/services';
import { files } from 'src/netron/client';
import { describeFileError } from './model';

type Policy = { key: string; roots: FileRoot[]; error?: string };
type Listing = { key: string; entries: FileEntry[]; next: string | null; revision: string; error?: string };
const noEntries: FileEntry[] = [];

/** A result may only be shown or used for the exact tab and location that requested it. */
export function useFileDirectory(tabId: string, location: FileLocation, refresh: number, refreshListing: number) {
  const policyKey = JSON.stringify([tabId, location.nodeId, refresh]);
  const listKey = JSON.stringify([policyKey, location.rootId, location.path, refreshListing]);
  const [policyResult, setPolicy] = useState<Policy | null>(null);
  const [listResult, setList] = useState<Listing | null>(null);
  const [pagingKey, setPagingKey] = useState<string | null>(null);
  const paging = useRef<string | null>(null);
  const epoch = useRef(0);
  const policy = policyResult?.key === policyKey ? policyResult : null;
  const root = policy?.roots.find((item) => item.id === location.rootId);
  const list = root && listResult?.key === listKey ? listResult : null;
  useEffect(() => {
    let current = true;
    setPolicy(null);
    void files
      .roots({ nodeId: location.nodeId })
      .then((result) => {
        if (result.protocol !== 1) throw new Error('Node requires a compatible file protocol');
        if (current) setPolicy({ key: policyKey, roots: result.roots });
      })
      .catch((e) => {
        if (current) setPolicy({ key: policyKey, roots: [], error: describeFileError(e) });
      });
    return () => {
      current = false;
    };
  }, [policyKey, location.nodeId]);

  useEffect(() => {
    const run = ++epoch.current;
    setList(null);
    paging.current = null;
    setPagingKey(null);
    if (root) {
      void files
        .list(location)
        .then((data) => {
          if (run === epoch.current)
            setList({ key: listKey, entries: data.entries, revision: data.revision, next: data.next });
        })
        .catch((e) => {
          if (run === epoch.current)
            setList({ key: listKey, entries: [], revision: '', next: null, error: describeFileError(e) });
        });
    }
    return () => {
      epoch.current = run + 1;
    };
  }, [listKey, location, root]);
  const more = async () => {
    if (!list?.next || list.error || paging.current === listKey) return;
    const run = epoch.current;
    paging.current = listKey;
    setPagingKey(listKey);
    try {
      const data = await files.list({ ...location, after: list.next, revision: list.revision });
      if (run === epoch.current) setList({ ...list, entries: [...list.entries, ...data.entries], next: data.next });
    } catch (e) {
      if (run === epoch.current) setList({ ...list, error: describeFileError(e) });
    } finally {
      if (run === epoch.current) {
        paging.current = null;
        setPagingKey(null);
      }
    }
  };
  return {
    policy,
    root,
    entries: list?.entries ?? noEntries,
    next: list?.next,
    more,
    ready: Boolean(list && !list.error),
    loading: !policy || Boolean(root && (!list || pagingKey === listKey)),
    error: policy?.error || list?.error,
  };
}
