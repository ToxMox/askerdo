# When to hand off (read once, at the 30 percent mark)

A handoff lands at a point it does not cut through: nothing the next
session would have to piece back together, and nothing whose result
would come back to this session after it is gone. Past the 30 percent
mark, finish what is in flight, start nothing that cannot finish by the
40 percent line, and hand off at the first such point. While the user is
actively engaged (a conversation, a sitting, a live look), never pick the
point on your own: finish with the user, or ask where to break if it runs
long. The percents are the profile's; 30 and 40 are the defaults.

Before the handoff, stop what this session started (servers, background
commands, agents), or name each in the handoff's state with how to stop
it. Nothing this session started outlives it unnamed. Detach any side
session it started (a test, display or helper session) and say so in one
line: a side session's turn notes reach only the session that started
it, so after the handoff they would wake this one instead of the resumed
one.

## Where each state hands off

- **An active conversation** (a question out, a topic open, a back and
  forth going): once it wraps, the topic settled and nothing the user said
  waiting on action. The test: the reply about to be sent would not raise
  its hand to the user about this conversation.
- **A sitting or a live look with the user:** never on your own: at the
  sitting's end, or where the user says when asked.
- **Waiting on the user's go:** after the go and the step, if it is small.
- **Background work running** (agents, workflows, driven test sessions):
  after it lands and its result is checked.
- **Mid-change in code:** at a commit with its tests passing; a half-done
  change to the live contract text backed out or set aside.
- **Working alone through a plan:** at the next task boundary, committed
  and pushed.
- **About to start something big** (a wave, a review, a many-agent run):
  before it starts.
- **Idle:** right away.
- **Already handed off, and the user keeps talking:** keep working. The
  mod asks for an update only when a turn changed state after the handoff
  (a board or repo write, a ruling, a new or dropped waiting item, a
  dispatched agent or a stopped process); a turn that only answered stays
  silent. Then bring the handoff up to date with `handoff_update`
  (`handoff update TR-n` from the CLI) with only what the next leg needs,
  never a line for a plain answer. It patches the handoff in place
  and keeps its id: a state section replaced or added, a whereWeWere line,
  a waitingOnUser line added or dropped, a repo's verify-first snapshot
  refreshed. Once another session has resumed the track, put what changed
  in a note on the track instead (`note TR-n`); it reaches that session at
  its next prompt. The next leg's kickoff lists what the handoff carried
  as waiting on the user and says to check each item against the app or
  the board before repeating it: it may be done already.

## The 40 percent line

Start nothing new, and finish what is in flight; an active conversation or
sitting counts as in flight. Nothing forces a cut: only the user's word
does (`/askerdo handoff`, `/askerdo park`).
