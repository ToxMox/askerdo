/* who sent it: a session or the user's press, on this PC or another (the activity row's device);
   the band and the relayed line the model reads (lineFor) share it, `you` naming the user */
export function senderWords(r, here, noun = false, you = 'you') {
  const by = String(r.by || '');
  const pc = typeof r.pc === 'string' && r.pc ? r.pc : '';
  const away = !!pc && pc !== here;
  if (/^session:/.test(by)) return (noun ? 'from ' : 'in ') + (away ? 'a session on ' + pc : pc ? 'another session on this PC' : 'another session');
  if (/^user:/.test(by)) return 'by ' + you + ' ' + (away ? 'on ' + pc : 'in another session');
  if (by === 'user') return 'by ' + you + ' on the board';
  if (/^board:/.test(by)) return 'by the board';
  return 'on the board';
}

/* another session holding a noted task or track, which the note tool's
   answer names so the sender can raise its hand; the receiving band is unchanged.
   `task`: the task's show read or null; `tracks`: a workstream view's tracks; `own`: this
   session's id and its ids before a /clear. Null when nobody else holds it. */
export function noteHolder(id, task, tracks, own) {
  const list = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  const mine = (s) => !s || own.includes(s);
  const holderOf = (t) => (t && t.holder && t.holder.session) || null;
  const named = (t) => ({ track: t.id, name: t.name ? String(t.name) : '' });
  if (/^TR-\d+$/.test(id)) {
    const t = list.find((x) => x.id === id);
    return t && !mine(holderOf(t)) ? named(t) : null;
  }
  const hand = task && typeof task.inHand === 'string' ? task.inHand : null;
  if (!mine(hand)) {
    const t = list.find((x) => holderOf(x) === hand);
    return t ? named(t) : { task: id };
  }
  const on = list.find((x) => Array.isArray(x.tasks) && x.tasks.some((k) => k && k.id === id));
  return on && !mine(holderOf(on)) ? named(on) : null;
}

/* the session as the user names it: by the track it holds, else by the task in hand */
export function noteWaits(holder, n) {
  if (!holder) return '';
  const who = holder.track ? 'the session holding ' + holder.track + (holder.name ? ' (' + holder.name + ')' : '') : 'the session with ' + holder.task + ' in hand';
  return 'It waits in the band of ' + who + '. If ' + n + ' should press it in there, raise your hand in this reply and name that session and this note in the footer; '
    + 'without a press it goes in with ' + n + '\'s next message there.';
}
