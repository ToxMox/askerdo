/* A scheduled task because a board started inside a Claude session inherits
 * Claude's job. This module touches nothing, so a test pins the
 * document, and the SID is a parameter so no identity is tracked. */
import { trayExePath } from './tray.mjs';

/* a person reads this in Task Scheduler, so it takes the brand. It has a
 * space and no ampersand, so it reaches schtasks as one argument and needs
 * nothing escaped in the document. */
export const TASK_NAME = 'AskerDo board';

/* For a person who finds the task in the UI: the undo is documented here,
 * never built. */
export const TASK_DESCRIPTION = 'Starts the ' + TASK_NAME
  + ' server outside every other program\'s job, at logon and on demand.'
  + ' Registered by the AskerDo plugin; delete with'
  + ' schtasks /delete /tn "' + TASK_NAME + '" /f';

/* A task needs a working directory and the board must not hold one anyone might
 * rename; deliberately not part of the compare. */
export const WORK_DIR = 'C:\\';

/* The exe of the running checkout, so a task pointing at last release's cache
 * is detectable from the path alone; the root is an argument because it is the
 * one thing the exe must not assume. */
export function wantedAction(root) {
  return { command: trayExePath(), args: ['--serve', '--root', root] };
}

/* ---- the argument string ------------------------------------------------ */

/* <Arguments> is one string Windows parses back for the exe, so the two halves
 * below are that parse and its inverse; round-tripping makes the compare an
 * argument compare. */
export function formatArgs(args) {
  return args.map(quoteArg).join(' ');
}

function quoteArg(a) {
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let out = '"';
  let slashes = 0;
  for (const ch of a) {
    if (ch === '\\') { slashes += 1; continue; }
    if (ch === '"') { out += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

/* CommandLineToArgvW's rules; the doubled-quote shorthand is deliberately not
 * implemented, since formatArgs never writes it and an action carrying one
 * costs one re-register, not correctness. */
export function parseArgs(text) {
  const out = [];
  let cur = '';
  let quoted = false;
  let started = false;
  let slashes = 0;
  const flush = () => { if (started) { out.push(cur); cur = ''; started = false; } };
  for (const ch of String(text)) {
    if (ch === '\\') { slashes += 1; started = true; continue; }
    if (ch === '"') {
      cur += '\\'.repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) cur += '"';
      else quoted = !quoted;
      slashes = 0;
      started = true;
      continue;
    }
    cur += '\\'.repeat(slashes);
    slashes = 0;
    if (!quoted && /\s/.test(ch)) { flush(); continue; }
    cur += ch;
    started = true;
  }
  cur += '\\'.repeat(slashes);
  flush();
  return out;
}

/* ---- the document ------------------------------------------------------- */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

export function xmlUnescape(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    /* last, so an escaped ampersand cannot re-open an entity that was text */
    .replace(/&amp;/g, '&');
}

/* The document as measured registering: version 1.2 without the
 * two 1.3 elements, and schtasks reads it as UTF-16. Inert settings stay
 * because the UI owes a person the intent. */
export function taskXml({ sid, command, args = [], workDir = WORK_DIR, description = TASK_DESCRIPTION }) {
  if (!sid) throw new Error('taskXml needs the user SID');
  if (!command) throw new Error('taskXml needs a command');
  const e = xmlEscape;
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    '    <Description>' + e(description) + '</Description>',
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    '      <UserId>' + e(sid) + '</UserId>',
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <UserId>' + e(sid) + '</UserId>',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings>',
    '      <StopOnIdleEnd>false</StopOnIdleEnd>',
    '      <RestartOnIdle>false</RestartOnIdle>',
    '    </IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>4</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    '      <Command>' + e(command) + '</Command>',
    '      <Arguments>' + e(formatArgs(args)) + '</Arguments>',
    '      <WorkingDirectory>' + e(workDir) + '</WorkingDirectory>',
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\n');
}

/* ---- the read-back ------------------------------------------------------ */

/* One regex each: a parser for the rest would be a second copy of the schema.
 * Unreadable is null, which the caller reads as stale and registers again. */
export function parseAction(xmlText) {
  const text = String(xmlText || '');
  const command = text.match(/<Command>([\s\S]*?)<\/Command>/);
  if (!command) return null;
  const args = text.match(/<Arguments>([\s\S]*?)<\/Arguments>/);
  const commandText = xmlUnescape(command[1]).trim();
  if (!commandText) return null;
  return { command: commandText, args: parseArgs(xmlUnescape(args ? args[1] : '').trim()) };
}

/* Both sides come from the same two functions, so nothing needs normalizing but
 * case, which would otherwise churn. The trigger is never read: its UserId
 * comes back normalized (measured), so reading it would re-register forever. */
export function actionMatches(wanted, found) {
  if (!found) return false;
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  return same(wanted.command, found.command)
    && same(formatArgs(wanted.args), formatArgs(found.args));
}
