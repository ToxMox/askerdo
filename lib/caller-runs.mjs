/* What never runs in the local server, read by the server (its 409), the launcher and the mod,
   so neither caller posts a call the server is bound to refuse. Pure: no imports. */

/* The kind words that take a subcommand, so 'ws create' is looked up whole.
   'question' joins them with exactly ONE subcommand: a question is
   created by `register` and closed by `answer` and `drop`, so `question edit`
   is the whole of its two-word grammar and `question create` is the unknown
   verb it always was. */
export const KIND_WORDS = ['ws', 'task', 'question', 'handoff', 'knowledge', 'profile', 'proc', 'track', 'edge', 'check', 'override', 'commit', 'review'];

/* the server starts no process: these start one, so they run in the caller too */
const STARTS_A_PROCESS = new Set(['board', 'login', 'restore']);
/* status judges the asking copy (replaced or not), so it never runs in the server's */
const READS_OWN_COPY = new Set(['status']);
/* git would hold the server's loop: a scan reads each repo's log */
const READS_GIT = new Set(['proc scan', 'proc ran']);

/* The reason a command runs in the caller's process, or null to run it in the server. */
export function runsInCaller(argv) {
  if (!Array.isArray(argv)) return null;
  let [verb, ...rest] = argv;
  if (KIND_WORDS.includes(verb) && rest.length && !rest[0].startsWith('--')) { verb += ' ' + rest[0]; rest = rest.slice(1); }
  const named = (f) => rest.some((a) => a === '--' + f || a.startsWith('--' + f + '='));
  /* a login that prints its link opens no browser, so the pane's mint runs here */
  if (verb === 'login' && (named('print') || named('qr'))) return null;
  if (STARTS_A_PROCESS.has(verb)) return verb + " starts a process, so it runs in the caller's process";
  if (READS_OWN_COPY.has(verb)) return verb + " reads the caller's own AskerDo copy, so it runs in the caller's process";
  /* hundreds of MB of transcripts would hold the server's loop */
  if (verb === 'sweep') return "sweep reads the session transcripts, so it runs in the caller's process";
  /* a contract key or the queue lands in config.json, then the sync runs */
  if (verb === 'settings' && (rest[0] === 'set' || rest[0] === 'unset') && /^(contract\.|queue$)/.test(String(rest[1] || ''))) return 'settings ' + rest[0] + " runs the sync, so it runs in the caller's process";
  /* a triggers call that scans first reads the repo's log, as proc scan does; a bare knowledge new finds its repo root */
  if (READS_GIT.has(verb) || (verb === 'proc triggers' && named('project') && !named('no-scan'))
    || (verb === 'knowledge new' && !named('project') && !named('global'))) return verb + " runs git, so it runs in the caller's process";
  return null;
}
