import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** GitHub is one explicitly selected executor, never the source of release identity. */
export function githubQualification({ root, policy, run, progress, poll = delay }) {
  const repo = policy.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Invalid GitHub repository in release policy');
  const api = async (route, args = []) => JSON.parse(await run(root, 'gh', ['api', 'repos/' + repo + '/' + route, ...args]) || 'null');
  const check = (record, commit, workflow, event) => {
    if (!record || record.head_sha !== commit || record.head_branch !== policy.branch ||
        record.path !== '.github/workflows/' + workflow || record.event !== event ||
        !Number.isSafeInteger(record.id) || record.id < 1) throw Error('CI identity differs from the reviewed release');
    return record;
  };
  async function wait(record, context, workflow, event) {
    let last;
    const deadline = Date.now() + policy.qualification.timeoutMs;
    for (;;) {
      context.signal?.throwIfAborted();
      record = check(await api('actions/runs/' + record.id), context.commit, workflow, event);
      const state = record.status + ':' + record.conclusion + ':' + record.run_attempt;
      if (state !== last) progress(context.name + ' · ' + state + ' · ' + record.html_url);
      last = state;
      if (record.status === 'completed') {
        if (record.conclusion !== 'success') throw Error(context.name + ' failed: ' + record.html_url);
        const required = event === 'push' ? policy.qualification.jobs : ['systemd'];
        const jobs = await api('actions/runs/' + record.id + '/attempts/' + record.run_attempt + '/jobs?per_page=100');
        if (!Array.isArray(required) || required.some(name => !jobs.jobs.some(job => job.name === name && job.conclusion === 'success')))
          throw Error(context.name + ' is missing a required successful job: ' + record.html_url);
        return { id: record.id, attempt: record.run_attempt, url: record.html_url, commit: record.head_sha };
      }
      if (context.observeOnly) throw Error(context.name + ' is still running: ' + record.html_url);
      if (Date.now() >= deadline) throw Error(context.name + ' timed out; resume to observe the same run: ' + record.id);
      await poll(policy.qualification.pollMs, undefined, { signal: context.signal });
    }
  }
  async function ci(context) {
    const { workflow } = policy.qualification;
    // The latest push run is authoritative; an old green rerun cannot mask a newer failure.
    const reply = await api('actions/workflows/' + encodeURIComponent(workflow) +
      '/runs?event=push&head_sha=' + context.commit + '&per_page=100');
    const runs = reply.workflow_runs.filter(item => item.head_sha === context.commit &&
      item.head_branch === policy.branch && item.event === 'push')
      .sort((a, b) => b.id - a.id);
    if (!runs[0]) throw Error('No CI run for ' + context.commit + '. Push the reviewed source, then repeat xec release --qualify.');
    return wait(check(runs[0], context.commit, workflow, 'push'), context, workflow, 'push');
  }
  async function native(context, saved, save) {
    const workflow = policy.qualification.nativeWorkflow;
    const title = intent => 'Handoff ' + context.previous + ' → ' + context.commit +
      ' · Node ' + context.node + ' · ' + intent;
    const find = async intent => {
      for (let page = 1; page <= 5; page++) {
        const reply = await api('actions/workflows/' + encodeURIComponent(workflow) +
          '/runs?event=workflow_dispatch&per_page=100&page=' + page);
        const matches = reply.workflow_runs.filter(item => item.display_title === title(intent));
        if (matches.length > 1) throw Error('Ambiguous native qualification; refusing to select an arbitrary run');
        if (matches[0]) return check(matches[0], context.commit, workflow, 'workflow_dispatch');
        if (reply.workflow_runs.length < 100) break;
      }
    };
    let record;
    if (saved?.runId) record = check(await api('actions/runs/' + saved.runId), context.commit, workflow, 'workflow_dispatch');
    else if (saved?.intent) record = await find(saved.intent);
    if (!record && !saved?.intent) {
      if (context.observeOnly) throw Error(context.name + ' has not been dispatched');
      const head = await api('git/ref/heads/' + encodeURIComponent(policy.branch));
      if (head.object.sha !== context.commit) throw Error('Native qualification requires the reviewed commit at ' + policy.branch);
      saved = { intent: randomUUID(), submittedAt: new Date().toISOString() };
      // Persist before the request. A lost response must not dispatch duplicate workflows.
      await save(saved);
      await api('actions/workflows/' + encodeURIComponent(workflow) + '/dispatches', [
        '--method', 'POST', '-f', 'ref=' + policy.branch,
        '-f', 'inputs[previous]=' + context.previous, '-f', 'inputs[candidate]=' + context.commit,
        '-f', 'inputs[node]=' + context.node, '-f', 'inputs[qualification]=' + saved.intent,
      ]);
    }
    if (!record && saved?.intent && !context.observeOnly) {
      const deadline = Date.now() + 120_000;
      do {
        context.signal?.throwIfAborted();
        record = await find(saved.intent);
        if (record) break;
        await poll(policy.qualification.pollMs, undefined, { signal: context.signal });
      } while (Date.now() < deadline);
    }
    if (!record) throw Error(context.name + ' has an unconfirmed dispatch (' + saved?.intent +
      '). Resume to reconcile it; no duplicate request was sent.');
    if (record.display_title !== title(saved.intent)) throw Error('Native qualification input identity differs');
    if (!context.observeOnly && saved.runId !== record.id) { saved = { ...saved, runId: record.id }; await save(saved); }
    return wait(record, context, workflow, 'workflow_dispatch');
  }
  async function downloadNative(context, evidence, directory) {
    const name = 'native-' + context.commit + '-' + context.node + '-' + evidence.attempt;
    const reply = await api('actions/runs/' + evidence.id + '/artifacts?per_page=100');
    const matches = reply.artifacts.filter(artifact => artifact.name === name);
    if (matches.length !== 1 || matches[0].expired || matches[0].size_in_bytes > 2 * 1024 ** 3 ||
        matches[0].workflow_run?.head_sha !== context.commit) throw Error('Qualified native artifact is missing, expired or ambiguous');
    await run(root, 'gh', ['run', 'download', String(evidence.id), '--repo', repo, '--name', name, '--dir', directory], { timeoutMs: 10 * 60_000 });
  }
  return { ci, native, downloadNative };
}
