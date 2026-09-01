# Draft: plxr as an MCP server

**Not built. This is the page to nod at or throw away.**

## What it would be for

An agent running inside plxr can see its own terminal and nothing else. It
cannot tell whether the other five sessions are waiting, what it answered to the
same question yesterday, or which port it just took. plxr knows all of that.
An MCP server is how it hands that over — to a coding CLI, or to a session on
the phone, without either of them learning plxr's HTTP API.

It changes nothing about the daemon: the same calls, a second way in.

## The tools it would offer

**Read only — safe, and where the value is**

| Tool | Answers |
|---|---|
| `sessions` | What is running, where, in which state, under which account |
| `session` | One session: state, agent, branch, model, context, last message |
| `screen` | The last N lines of a session's terminal |
| `inbox` | Which sessions are waiting for an answer, and the question |
| `ports` | Which process holds which port |
| `usage` | Spend over a window, by day, project, model |
| `archive` | Past transcripts, searchable by title and by full text |
| `playback` | A recording, from an offset — for "what happened at 03:00" |
| `rules` | Which instruction files reach an agent in a folder |
| `marks` | The git trees taken before each instruction |

**Writing — useful, and each one needs a reason to exist**

| Tool | Does | Why it is defensible |
|---|---|---|
| `queue` | Lines an instruction up for a session | The queue already exists and only sends when the agent is ready; this is the same door |
| `start` | Starts a session in a folder with a chosen CLI | The collision watch applies here too, and it cannot pass the dangerous flag |
| `freeze` / `unfreeze` | Halts or releases a session | Reversible, and the tile shows it |
| `note` | Writes a line into plxr's own log | For an agent to leave a trace of what it did |

## What it must never do

These are not settings. They are the reason the thing can exist at all.

1. **Never answer a permission prompt.** Not through `queue`, not through any
   other door. A question an agent asks is asked of a person. An MCP client
   answering it turns plxr into the thing that approves changes in his name.
2. **Never start a session with `--dangerously-skip-permissions`,** and never
   pass through an argument that begins with `--dangerously`. That decision is
   made by a person at a keyboard, in a window that then shows hazard stripes.
3. **Never kill a session, delete a transcript, or restore a mark.** Losing work
   must stay a deliberate act with a hand on it. Reading is unlimited; undoing
   is not offered.
4. **Never touch anything outside `~/.plxr`** except by reading a file a session
   is already working with, through the existing files API, inside that
   session's own directory.
5. **Never reach another machine.** Local only, same as the daemon.
6. **Never hand out the token.** The MCP server sits behind the same guard and
   does not repeat it in any answer.

## How it would be wired

`plxr mcp` — a subcommand that speaks MCP on stdin/stdout and talks to the
daemon over the HTTP API it already has, with the token from `~/.plxr`. No new
state, no second copy of anything. Registering it is one line in the client's
config, the way the hook already is.

Sessions started this way are marked as such, so a tile says who asked for it.

## What it costs

Half a day for the read-only half, which is the useful part. The writing half
is another half day and needs the rules above enforced in code, not in a
comment — a check that a tool cannot be added without declaring which side of
the line it is on.

## The question for him

Read-only first, and the writing tools only if he wants them? Or not at all —
the hook already reports state upward, and this is a second path to the same
place.
