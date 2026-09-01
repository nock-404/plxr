# Open

Everything said, shown or measured that is not done yet. New things land here
when they turn up, not when there is time for them. What is finished leaves —
there is no archive.

Checked against the running build on 31.08.2026, not from memory.

## Waiting for you — three decisions, two minutes

**1. Night shift: should plxr answer for you?**
The half that only *shows* an unattended session is built. The other half would
have plxr reply to permission prompts itself inside a set window — this program
approving changes in your name while you sleep. To build it I need: which
answer, to which prompts, in which window, and what it must never approve.
*My advice: leave it. The queue already keeps work moving, and it only ever
sends what you typed yourself.* Cost if you want it: a day, most of it spent on
the rules for what it refuses.

**2. Leash: which counter, and what happens at the limit?**
Only useful against accumulated spend, not context size — the context number
says nothing about cost. Decide the limit and the reaction: halt the session,
ask, or just say so in the status strip.
*My advice: say so first, halt later. A leash that stops work in the middle of
something is worse than the spend it saved.* Cost: half a day; the usage data
is already there.

**3. Phone: a page in the local network, or nothing?**
Real push notifications need a foreign cloud, so that is out. What is possible
is a page on your own network that shows the same tiles and lets you answer —
but it will not ring, you have to look.
*My advice: build it only if you would actually open it. A page nobody opens is
the most expensive kind of feature.* Cost: a day, and the daemon has to listen
beyond 127.0.0.1, which is a security decision of its own.

**Two drafts are ready for the same treatment** — `drafts/mcp-server.md` and
`drafts/accounts.md`. Both are one page, both end with the one question I could
not answer for you.

## Verified fixed — the old list, item by item

- **The terminal matches the theme.** Every skin sets `--term-bg`, `--term-fg`
  and its own `--term-font`; the terminal is monospace in all four even where
  the interface is not.
- **The pane label no longer overlaps the first line.** Measured at 7px of
  overlap, now 5px of clearance, identical in all four skins.
- **Account switching is not offered where it cannot work.** Without a Claude
  session id the control is plain text with a tooltip saying why.
- **Resume replaces the tile instead of leaving it.** `ResumeOrphaned` clears
  the old entry first; measured 4 sessions before and 4 after.
- **Two daemons at once.** Racing two starts: one comes up, the other says
  "another daemon is already running — stepping aside".
- **German is gone**, and a gate reads all 154 source files to keep it that way.
- **Theme names are English**, and the palettes come from the daemon.
- **Unattended sessions are marked.** A session started with
  `--dangerously-skip-permissions` wears hazard stripes and a red dot, in all
  four skins — the warning coat the old app had and this one had lost.
- **The update swap works end to end.** Run against a versioned build of this
  code: the check found 0.35.0, the asset was downloaded, unpacked and swapped
  in, and the result ran and reported its own version. No half copies left
  behind. It replaces the running executable, so it can never reach an
  installation it was not started from.
- **Queue.** Instructions can be lined up; the daemon sends the next one when
  the agent is actually ready — an agent when it asks, a shell when it has been
  quiet at its prompt. It lives on disk, so it keeps going with the window
  closed and survives a restart. Verified: three queued through the API and
  three through the interface, all six ran in order.
- **Collision watch.** Starting a session in a folder that already has one says
  so and asks again; the button reads START ANYWAY until it is acknowledged. A
  trailing slash does not fool it.

## Still open

- **plxr as an MCP server.**
- **Managing accounts.** There is `GET /api/accounts` and nothing else — no
  adding, naming or setting a default. Needs a design first.

## Details behind the decisions

The night shift's two readings, spelled out, because the difference is the whole
point: *(a)* mark a session he starts himself with its prompts turned off — this
is built, such a tile wears hazard stripes; *(b)* plxr replies to the prompts
itself inside a window — not built, and not something to infer from one line on
a wish list.

The two drafts carry the same shape: what it would do, what it must never do,
what it costs, and the one question left over.

## On his machine, not in this code

- **Two installed daemons are running right now** — PIDs 10092 (since 29.08.
  08:14) and 55041 (since 30.08. 22:37), both `/Applications/plxr.app`. That is
  the old build without the lock. They hold his terminals, so they are his to
  end, not mine.
- **`mg-pr/plxr` deletion.** `gh repo delete mg-pr/plxr --yes`. His old company
  address is still in that history.
