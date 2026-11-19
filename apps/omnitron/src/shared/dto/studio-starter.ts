import { isProjectStarterNeeds, projectStarterOptions, type ProjectStarterNeeds } from './project.js';

/** A suggestion crosses into the project wizard only as declared needs. */
export const projectInterview = [
  'Help me choose the smallest project that does the job. Ask one concrete question at a time when a requirement is unclear.',
  'Find out what should run on demand, what data should survive, and whether anything must keep running.',
  'Use automation for a repeatable Xec task. Choose Kysera with sqlite for an embedded database, postgresql or mysql for that database server, or none.',
  'Choose service none for standalone commands, node for a supervised Node process, or titan when the service needs Titan.',
  'The starter creates local source files. For required migrations, tenant policy, remote credentials, schedules or deployment, explain the additional work. Ask whether the user wants a partial starter and wait for their answer before offering JSON. If no starter fits, omit it.',
  'When the needs are clear, explain the choice briefly. Return exactly one JSON code block with the boolean automation, persistence (' +
    Object.keys(projectStarterOptions.persistence).join(', ') +
    ') and service (' +
    Object.keys(projectStarterOptions.service).join(', ') +
    ').',
].join(' ');

export function readProjectSuggestion(answer: string): ProjectStarterNeeds | null {
  const blocks = [...answer.matchAll(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim)];
  if (blocks.length > 1) return null;
  try {
    const needs: unknown = JSON.parse(blocks[0]?.[1] ?? answer);
    return isProjectStarterNeeds(needs) ? needs : null;
  } catch {
    return null;
  }
}
