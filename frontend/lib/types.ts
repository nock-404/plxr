// Mirrors the daemon's JSON (internal/session, internal/core). Kept in step by
// the fields gate; never guessed from the wire.
export type Status = "working" | "waiting" | "permission" | "dead" | "unknown";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  cmd: string[];
  pid: number;
  tty: string;
  started_at: number;
  alive: boolean;
  exit_code: number;
  ended_at?: number;
  orphaned?: boolean;
  account?: string;
  agent?: string;
  agent_label?: string;
  claude_session_id?: string;
  status: Status;
  title?: string;
  activity?: string;
  project?: string;
  branch?: string;
  model?: string;
  effort?: string;
  context?: number;
  last_message?: string;
  since?: number;
}

export interface Tile extends Session {
  preview: string;
  frozen?: boolean;
  question?: string;
  stuck?: { files?: string[] } | null;
}

export interface Agent {
  name: string;
  label: string;
  match: string[];
  own: boolean;
}

export interface Theme {
  name: string;
  label: string;
  skin: string;
  palette: Record<string, string>;
}

// Measured against the live daemon, never guessed.
export interface Port {
  pid: number;
  command: string;
  port: number;
  addr: string;
  user: string;
  own: boolean;
}

export interface UsageBucket {
  key: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  messages: number;
}

export interface Usage {
  sum: Omit<UsageBucket, "key">;
  byDay: UsageBucket[];
  byProject?: UsageBucket[];
  byModel?: UsageBucket[];
}

export interface ArchiveEntry {
  id: string;
  account: string;
  path: string;
  cwd: string;
  project: string;
  title: string;
  branch: string;
  model: string;
  size: number;
  mod: number;
  loop: boolean;
  accounts: string[];
}

export interface Account {
  /* What somebody called it. Separate from the name, which is the identity:
     sessions are recorded against that, so renaming what is shown must not
     rename what they point at. */
  label?: string;
  name: string;
  number: number;
  dir: string;
  /* dir with the home directory written as ~ — what the row shows. Three
     accounts under one home all begin the same way, so a path cut off at the
     end tells them apart from nothing. */
  short: string;
  sessions: number;
}

/* How far along an update is.
   The daemon starts the work and answers at once, so asking again is the only
   way to know whether anything has actually happened yet. */
export interface UpdateStatus {
  running: boolean;
  percent: number;
  phase: string;
  done: boolean;
  error?: string;
  path?: string;
}

export interface VersionInfo {
  /* What is running right now. */
  current: string;
  /* What lies on disk and would run if it were started now. Different from
     `current` between an update finishing and the restart that picks it up. */
  installed: string;
  latest: string;
  available: boolean;
  notes: string;
}

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mod: number;
  noise: boolean;
}

export interface FileBody {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
  size: number;
  lines: number;
  /* When the file was last written, as the daemon saw it. Sent back on save so
     a file that changed on disk in the meantime is refused instead of
     overwritten — which is the case that matters when an agent is working in
     the same tree. The daemon has always sent this; the window did not have the
     field, so it never had the value to send back. */
  mod: number;
}

export interface Rule {
  kind: string;
  name: string;
  path: string;
  description: string;
  size: number;
  level: number;
}

export interface Mark {
  id: string;
  tree: string;
  at: number;
  instruction: string;
  files: number;
}

export interface Template {
  name: string;
  label: string;
  entries: number;
}

export interface Waiting {
  worked: number;
  waited: number;
  cut: number;
  cap: number;
  byDay: { key: string; worked: number; waited: number }[] | null;
}

export interface HookState {
  accounts: number;
  dir: string;
  installed: boolean;
  missing: string[];
}

export interface AgentProfile {
  name: string;
  label: string;
  source: string;
  match: string[];
  blocked: string[];
  working: string[];
  idle_seconds: number;
  idle_status: "waiting" | "working" | "unknown";
}

export interface SearchHit {
  sessionId: string;
  account: string;
  path: string;
  cwd: string;
  project: string;
  title: string;
  mod: number;
  role: string;
  excerpt: string;
}

export interface Reply {
  question: string;
  answer: string;
  at: number;
  cwd: string;
}

export interface TimelineMark {
  offset: number;
  at: number;
}

export interface QueueItem {
  text: string;
  added: number;
}

export interface NotifyWhen {
  needsYou: boolean;
  waiting: boolean;
  ended: boolean;
  crashed: boolean;
}

export interface NotifySettings {
  on: boolean;
  sound: string;
  when: NotifyWhen;
}

/* One file that differs from a mark. */
export interface MarkChange {
  status: string;
  path: string;
}

/* A folder plxr holds open, on its own, whether or not anything runs in it. */
export interface Workspace {
  id: string;
  path: string;
  real: string;
  label?: string;
  opened_at: number;
  used_at: number;
  /* Worked out when the list is read, never stored: a folder on a volume that
     is not mounted is not a folder to forget. */
  missing: boolean;
}

/* What to look for in the files of a folder. */
export interface FindQuery {
  text: string;
  regex?: boolean;
  case?: boolean;
  word?: boolean;
  glob?: string;
}

/* One matching line, with every match on it — per line, because a line with
   four matches is one thing to look at, not four. */
export interface FindHit {
  path: string;
  line: number;
  text: string;
  ranges: [number, number][];
}

export interface FindReport {
  hits: FindHit[];
  files: number;
  scanned: number;
  /* Every bound the daemon reached, named. A short list that looks complete is
     worse than one that says it is short. */
  capped: string[];
  took_ms: number;
}

/* One file git has something to say about. index and work are the two letters
   git prints, kept apart on purpose: a file can be staged and changed again
   since, and one word cannot show that. */
export interface GitChange {
  path: string;
  index: string;
  work: string;
  renamed?: string;
  /* Counted twice: staged and unstaged are two different numbers for the same
     file, and one total shown in both groups says the same thing about a
     change that was staged and a later one that was not. */
  added: number;
  removed: number;
  staged_added: number;
  staged_removed: number;
  binary: boolean;
}

export interface GitLine {
  /* " " kept, "+" added, "-" removed, "\\" a note from git. */
  kind: string;
  text: string;
  old: number;
  new: number;
}

export interface GitHunk {
  header: string;
  lines: GitLine[];
}

export interface GitDiff {
  path: string;
  staged: boolean;
  hunks: GitHunk[];
  binary: boolean;
  /* Said plainly rather than as an empty list, which reads as a failure. */
  empty: boolean;
}

/* One commit, as the history list shows it. */
export interface GitEntry {
  hash: string;
  subject: string;
  author: string;
  when: string;
}

/* Which branch this is and how it stands against its upstream. */
export interface GitWhere {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /* No branch, just a commit. Committing here is not wrong but it is easy to
     lose, so the window says so. */
  detached: boolean;
}

/* One branch, with where it stands against its upstream. */
export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  subject: string;
  when: string;
}

/* Whether plxr can be reached from another machine, and where. */
export interface RemoteState {
  /* What was asked for. It takes effect when the daemon next starts. */
  on: boolean;
  /* Whether the listener that is actually running is on the network. Read off
     the socket, not off the setting: saying "on" while still bound to this
     machine would be a promise somebody carries into another room. */
  live: boolean;
  port: number;
  addresses: string[];
}

export interface RemoteCode {
  code: string;
  until: number;
  port: number;
}
