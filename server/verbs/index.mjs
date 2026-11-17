/* The verb table: every write and read verb by name, each called as
   verb(db, input, actor). Callers reach the board through runVerb, never a
   verb file, so the in-process and HTTP transports run the same table. */
import { UsageError, resolveLabel, resolveLegacy as legacyOf } from './labels.mjs';
import {
  addEdge, addItem, checkItem, moveItem, removeEdge, strikeItem,
} from './graph.mjs';
import { endRun, openRun, renewRuns, sessionRuns, taskRuns } from './runs.mjs';
import { trackFound } from './found.mjs';
import {
  acquireLease, capture, dropTrack, finishTrack, layOut, listTracks, newTrack, parkTrack, releaseLease,
  renewLease, reorder, splinter, takeOver, trackSummary, trackView, workstreamView,
} from './tracks.mjs';
import { boardSnapshot, workingSet } from './snapshot.mjs';
import { readHandoff, resumeCutoff, resumeTrack, shelf, trackHandoffs, trackKickoff, updateHandoff, writeHandoff } from './handoffs.mjs';
import {
  amendKnowledge, closeRecord, createKnowledge, editKnowledge, fileRecord, editRecord, heldTask, listWork, noteRecord, readRecord, reopenRecord, supersedeKnowledge,
  taskUpdate, waitsOn,
} from './work.mjs';
import {
  answer, drop, editQuestion, list, namesLine, peekOpenQuestions, peekSessionScope, register, show, snooze, subscribe, surface, wake,
} from './questions.mjs';
import { search } from './search.mjs';
import { activity } from './activity.mjs';
import {
  effective, profileAdd, profileDefine, profileDelete, profileGuard, profileList, profileRemove, profileRule, resolveSession, rulesFor, settings, settingsRule, settingsSet, settingsUnset,
} from './profiles.mjs';
import { procDrafts, procedureCards, recordRun, scanProject, triggerCards } from './procedures.mjs';
import { decide, decisionTriggers, decisionsFor, decisionsSince } from './decisions.mjs';
import { markRead, recordHistory } from './history.mjs';
import { bandCalls, bandKeep, upkeepDryRun, upkeepSwitch } from './upkeep.mjs';
import { applyPicture } from './picture.mjs';
import { pictureOverview, pictureView } from './picture-view.mjs';
import { overrideDecide, overrideRequest, overrideUnscrub, overrideView } from './override.mjs';
import { projectsRename } from './projects.mjs';
import { commitLink, commitMove, coverage, reviewCovers } from './coverage.mjs';
import { conversionDrop, conversionMap, conversionPut } from './conversion.mjs';
import { pcMap } from './pc-maps.mjs';
import { taskBlock } from './task-block.mjs';

/* A legacy brain id, { id, project, cwd } in: { key, entry } out, `entry.label` its record's label now. */
const resolveLegacy = (db, input) => {
  const o = input && typeof input === 'object' ? input : { id: input };
  return legacyOf(db, o.id, { project: o.project ?? undefined, cwd: o.cwd ?? undefined });
};

const GROUPS = [
  { register, answer, drop, snooze, wake, surface, subscribe, show, list, peekOpenQuestions, peekSessionScope, namesLine, editQuestion },
  /* a session's task names its place (work.mjs fileRecord); the board's own callers use createRecord */
  { createRecord: fileRecord, editRecord, taskUpdate, closeRecord, reopenRecord, noteRecord, createKnowledge, supersedeKnowledge, readRecord, listWork, waitsOn, heldTask },
  { addEdge, removeEdge, addItem, checkItem, moveItem, strikeItem },
  /* the task shape's runs: one worker's go at one task or several */
  { openRun, renewRuns, endRun, sessionRuns, taskRuns },
  {
    newTrack, splinter, capture, layOut, reorder, parkTrack, finishTrack, dropTrack,
    acquireLease, renewLease, releaseLease, takeOver, trackSummary, trackView, listTracks, workstreamView, trackFound,
  },
  { writeHandoff, updateHandoff, resumeTrack, trackKickoff, trackHandoffs, readHandoff, shelf, resumeCutoff },
  { search, activity },
  { effective, resolveSession, rulesFor, profileList, profileAdd, profileRemove, profileDefine, profileDelete, profileRule, profileGuard, settings, settingsSet, settingsUnset, settingsRule },
  { scanProject, recordRun, procDrafts, procedureCards, triggerCards },
  { decide, decisionsFor, decisionsSince, decisionTriggers },
  { resolveLabel, resolveLegacy },
  { boardSnapshot, workingSet },
  /* amend, edit while unused, the read log and the text history */
  { amendKnowledge, editKnowledge, read: markRead, recordHistory },
  { bandCalls, bandKeep, upkeepDryRun, upkeepSwitch },
  { applyPicture },
  /* the redrawn workstream picture's reads */
  { pictureView, pictureOverview },
  /* the user's override of a record in use */
  { overrideRequest, overrideDecide, overrideUnscrub, overrideView },
  /* a project's records onto its new shared name */
  { projectsRename },
  /* the commits a task finished with and the reviews that read them */
  { commitLink, commitMove, reviewCovers, coverage },
  /* each project's conversion map, keyed by source */
  { conversionMap, conversionPut, conversionDrop },
  /* each PC's project map, so a link opens on a PC whose folders differ */
  { pcMap },
  /* what a task holds now, for a dispatch or any reader */
  { taskBlock },
];

/* two groups adding the same name would shadow one verb silently */
function table(groups) {
  const out = Object.create(null);
  for (const g of groups) {
    for (const [name, fn] of Object.entries(g)) {
      if (out[name]) throw new Error('two board verbs are named ' + name);
      out[name] = fn;
    }
  }
  return Object.freeze(out);
}

export const VERBS = table(GROUPS);

/* A session's ask is checked strictly and inherits its scope, as today's CLI
   register is; a caller that is not a session's ask says strict: false. */
const DEFAULT_OPTS = { register: { strict: true, inherit: true } };

/* opts reach the verbs that read a fourth argument (the question verbs: the
   clock, strict, inherit); the actor's clock stands in when opts name none. */
export function runVerb(db, name, input, actor, opts) {
  const fn = typeof name === 'string' ? VERBS[name] : undefined;
  if (!fn) throw new UsageError('the board has no verb named ' + JSON.stringify(String(name)));
  const o = { ...DEFAULT_OPTS[name], ...opts };
  if (o.now === undefined && actor && actor.now !== undefined) o.now = actor.now;
  return fn(db, input, actor, o);
}
