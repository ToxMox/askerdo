---
name: start-a-server
title: Start a long-lived server detached from the session
summary: Start a dev or board server with Start-Process, never as the session's background task; note its pid and stop command, and stop it before a handoff or name it there.
everywhere: true
triggers:
  words: [start a server, start the server, dev server, run the server, background server, stop the server]
  commands:
    - cli.mjs serve
    - board-server.mjs --root
    - npm run dev
    - npm start
    - npm run start
    - npm run serve
    - npm run preview
    - yarn dev
    - yarn start
    - yarn serve
    - pnpm dev
    - pnpm run dev
    - pnpm start
    - bun run dev
    - bun dev
    - npx vite
    - vite dev
    - vite preview
    - next dev
    - next start
    - npx serve
    - npx http-server
    - npx live-server
    - python -m http.server
    - python3 -m http.server
    - py -m http.server
    - flask run
    - manage.py runserver
    - 'uvicorn "'
    - 'gunicorn "'
    - rails server
    - rails s
    - php -S
    - wrangler dev
    - hugo server
    - jekyll serve
---

# Start a long-lived server detached from the session

## Trigger

A session or agent is about to start a server that keeps running after its command returns: a dev server, a static file server, or this plugin's own board or local server (`node server/cli.mjs serve`, `node hooks/board-server.mjs --root <root>`).

## Preconditions

- None.

## Steps

### 1. Start it detached, never as this session's background task

A server run as this session's background task (or with `&` in its shell) belongs to the session: when it stops, its exit notice wakes the session that started it, even one the user handed off long ago. `Start-Process` leaves it running on its own. If it already runs as a background task here, stop that task first, then start it this way.

`<program>` is the executable and `<arguments>` the rest of the command line as one string. For npm, npx, yarn and pnpm name the `.cmd` file (`npm.cmd`): with its output redirected, `Start-Process` cannot run the shim without its extension. `<log>` is a file name outside the repo or one git ignores. From PowerShell:

```powershell
$p = Start-Process -FilePath <program> -ArgumentList '<arguments>' -WindowStyle Hidden -RedirectStandardOutput <log>.out.log -RedirectStandardError <log>.err.log -PassThru; $p.Id
```

From Git Bash, the same through pwsh (`powershell` where PowerShell 7 is not installed):

```sh
pwsh -NoProfile -Command "(Start-Process -FilePath <program> -ArgumentList '<arguments>' -WindowStyle Hidden -RedirectStandardOutput <log>.out.log -RedirectStandardError <log>.err.log -PassThru).Id"
```

Both print the server's pid.

### 2. Note its pid and how to stop it

Say in your reply or report what runs, its pid, its port and its stop command. `/T` stops the whole tree, since `npm run dev` runs its server under cmd. From PowerShell:

```powershell
taskkill /PID <pid> /T /F
```

From Git Bash (two slashes, so the flags are not read as paths):

```sh
taskkill //PID <pid> //T //F
```

A server whose pid is lost is found by its port:

```powershell
Get-NetTCPConnection -LocalPort <port> -State Listen | Select-Object OwningProcess
```

### 3. Stop it before a handoff, or name it in the handoff

Before a handoff or park, stop it with step 2's command unless the next session needs it running. If it stays, name it in the handoff's state: what runs, its pid, its port and its stop command, so the next session stops it and nothing wakes this one.

## Verify

```powershell
Get-Process -Id <pid>
```

- expect: the server is listed after the tool call that started it has returned, and no background task of this session runs it.
- expect: after the stop command, the same line finds no process.

## References

- `docs/procedures/README.md`: what `everywhere: true` means for this card.
