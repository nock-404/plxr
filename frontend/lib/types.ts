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
  /* Whether the CLI is on the PATH sessions get. The dialog greys out one
     that is not, with "not found", instead of starting it into a shell that
     says the same thing after the click. */
  found: boolean;
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

/* One rolling allowance, as far as this machine can see it —
   internal/usage/limits.go Window, field for field.

   `known` is the honest one: false means no reading was found on disk for
   this account, and the view has to say so rather than draw a bar at zero.
   `resetsAt` and `startsAt` are milliseconds, 0 when unknown; they are shown
   in the reader's own timezone, which only the window knows. `measured` says
   the spend was summed from the window's real start — without a reset time
   there is no real start, and the figure is over the window's nominal length
   ending now. */
export interface UsageWindow {
  kind: "session" | "week" | "weekModel";
  known: boolean;
  percent: number;
  severity?: string;
  model?: string;
  resetsAt: number;
  startsAt: number;
  measured: boolean;
  spend: Omit<UsageBucket, "key">;
  byModel: UsageBucket[];
}

/* One account's readout. The percentages are genuinely per account — they
   come out of that account's own file. The token figures may not be: where
   several accounts read one directory of transcripts, `sharedWith` names the
   others and the numbers are the pool's, because nothing on disk says which
   account paid for a line. */
export interface AccountUsage {
  name: string;
  label?: string;
  number: number;
  short: string;
  isDefault?: boolean;
  known: boolean;
  fetchedAt: number;
  source: string;
  session: UsageWindow;
  week: UsageWindow;
  weekModel: UsageWindow;
  sharedWith: string[];
  transcripts: string;
}

/* Every account added together, underneath the per-account figures rather
   than instead of them. There is no total percentage on purpose: three
   accounts on three plans have three different allowances. */
export interface UsageTotals {
  accounts: number;
  session: Omit<UsageBucket, "key">;
  week: Omit<UsageBucket, "key">;
  byModel: UsageBucket[];
}

export interface AccountUsageReport {
  accounts: AccountUsage[];
  total: UsageTotals;
  pools: number;
  /* The percentage at which the service says something, as set in the
     notification settings. The rail and the pickers mark at the same point,
     so a colour never disagrees with a notification. */
  threshold: number;
  files: number;
  readAt: number;
  duration: string;
}

/* How fast the allowance is going right now — internal/usage/usage.go Pace,
   field for field. window5h and perHour are tokens, active is the number of
   sessions that spent something in the last hour. */
export interface Pace {
  window5h: number;
  perHour: number;
  active: number;
  trend: "rising" | "falling" | "flat";
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
  /* The account a new session starts under when none is chosen. */
  default?: boolean;
  /* What the disk says about it right now — sent with every answer the
     accounts routes give, never saved. */
  state?: AccountState;
}

/* internal/accounts/state.go State, field for field. */
export interface AccountState {
  /* Claude Code has recorded a signed-in account. Only the presence of that
     entry is read; what it holds stays in Claude Code's own file. */
  signedIn: boolean;
  /* plxr's hook is in this account's settings. */
  hook: boolean;
  /* Where its transcripts are really read from, links resolved, ~ for home. */
  projects: string;
  /* The other accounts reading the same directory. Empty: its own history. */
  sharedWith: string[];
  /* When Claude Code last fetched its usage, in ms; 0 when it never has. */
  usageAt: number;
  /* The state file all of this was read from, ~ for home. */
  file: string;
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
  /* Relative to the opened folder — the one key that matches the git marks and
     that file operations send back. Path is absolute and resolved, which does
     not line up with the folder as the window holds it. */
  rel: string;
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
  /* An account is running out of its window. On by default, for the same
     reason as needsYou: it is the other state where nothing anybody does
     afterwards helps. */
  limit: boolean;
}

export interface NotifySettings {
  on: boolean;
  sound: string;
  when: NotifyWhen;
  /* How full a window has to be before plxr says so, in percent. */
  limit: number;
}

/* How the system permission stands, as the plxr window reported it to the
   service. "unknown" until a window has said; "asking" while the system's
   question is on screen and not answered. */
export type NotifyPermission = "unknown" | "granted" | "denied" | "notAsked" | "asking";

/* What became of a notification: handed to the plxr window, which shows it;
   shown by the service itself (Linux and Windows); not shown because no
   window is open; not shown because plxr is not allowed yet. */
export type NotifyVia = "window" | "local" | "none" | "notAllowed";

/* A click on a notification, as the plxr window writes it into the settings
   under focusSession: which session, and a number that changes per click. */
export interface FocusRequest {
  id: string;
  seq: number;
}

export interface NotifyInfo {
  settings: NotifySettings;
  sounds: string[];
  permission: NotifyPermission;
  /* How many plxr windows are listening to show notifications. */
  windows: number;
  /* The service shows them itself: Linux and Windows, where there is no
     permission to hold. Never on macOS. */
  serviceShows?: boolean;
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

/* Files whose names match what was typed, best first — go to file. capped
   names every bound the service reached, the way FindReport does. */
export interface NamesReport {
  paths: string[];
  total: number;
  capped: string[];
  took_ms: number;
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
  /* The commit the working tree was measured against, for a range diff. */
  since?: string;
}

/* One state of a folder, as /ws/changes pushes it — only when it differs from
   the last. `rev` names the state; equal revs are the same state. `head` is the
   commit HEAD sits on, which is the one thing that says "a commit landed" when
   the list looks the same before and after. `problem` is a code when the folder
   could not be followed this time. */
export interface ChangesFrame {
  changes: GitChange[];
  where: GitWhere;
  head: string;
  rev: string;
  problem?: string;
}

/* One file as HEAD has it, for the editor's gutter. `known` false means HEAD
   has no such file — untracked, freshly renamed, a submodule — and the whole
   buffer counts as added. */
export interface Baseline {
  path: string;
  text: string;
  known: boolean;
  binary: boolean;
  truncated: boolean;
}

/* One commit, as the history list shows it. */
export interface GitEntry {
  hash: string;
  subject: string;
  author: string;
  when: number; // milliseconds; the window words the age itself
  /* What points at this commit — branches and tags, as git writes them
     ("HEAD -> main, origin/main, tag: v1.2"). Empty for a commit nothing
     names, which is most of them. */
  refs: string;
}

/* One file a commit touched. `status` is git's own letter: A, M, D, R, C, T. */
export interface GitCommitFile {
  path: string;
  status: string;
  renamed?: string;
  added: number;
  removed: number;
  binary: boolean;
}

/* One commit read in full: what it says, who made it, and what it did.
   `hash` is the short form a person reads, `full` the one they paste
   somewhere else. */
export interface GitCommitDetail {
  hash: string;
  full: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  when: number; // milliseconds; the window words the age itself
  refs: string;
  files: GitCommitFile[];
  added: number;
  removed: number;
}

/* One remote and where it points. The fetch URL: the push one is almost always
   the same address, and printing it twice says nothing twice. */
export interface GitRemote {
  name: string;
  url: string;
}

/* One language of a folder, counted by files rather than by bytes: a single
   generated 40,000-line file would otherwise make a project "JSON". */
export interface FolderLanguage {
  name: string;
  files: number;
  share: number; // percent of the counted files
}

/* The plain facts of a directory — true of a folder that was never a
   repository just the same. */
export interface FolderFacts {
  files: number;
  folders: number;
  size: number; // bytes
  touched: number; // milliseconds
  /* The walk stopped early, so the counts are a floor and not a total. Said
     out loud rather than passed off as the answer. */
  partial: boolean;
  languages: FolderLanguage[];
  /* The directories the walk did not enter — node_modules, build output —
     so the counts can be read for what they are. */
  ignored: string[];
  readme: string;
  readme_path: string;
  readme_more: boolean;
}

/* Everything the folder overview shows, in one answer. `repo` false is an
   ordinary folder, not a failure: it gets the facts that apply to it and none
   of the git sections. */
export interface FolderReport {
  path: string;
  name: string;
  repo: boolean;
  where?: GitWhere;
  staged: number;
  unstaged: number;
  untracked: number;
  dirty: boolean;
  stashes: number;
  fetched: number; // milliseconds; 0 when it has never fetched
  head?: GitCommitDetail;
  log: GitEntry[];
  remotes: GitRemote[];
  facts: FolderFacts;
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
  when: number; // milliseconds; the window words the age itself
}

/* One file a branch touched, from its merge-base to the working tree —
   committed, staged and untracked in one, because a review reads the branch,
   not the index. `status` is git's letter; "?" is a file git never saw. */
export interface GitReviewFile {
  path: string;
  status: string;
  renamed?: string;
  added: number;
  removed: number;
  binary: boolean;
}

/* Everything a branch changed against a base. `merge_base` is the commit every
   diff is measured from; `bases` are the refs worth offering instead. */
export interface GitReview {
  base: string;
  merge_base: string;
  branch: string;
  files: GitReviewFile[];
  added: number;
  removed: number;
  bases: string[];
  stashes: GitStash[];
}

/* One stash, as git lists it. `ref` is git's own name (stash@{0}). */
export interface GitStash {
  ref: string;
  subject: string;
  when: number; // milliseconds; the window words the age itself
}

/* Whether plxr can be reached from another machine, and where. */
export interface RemoteState {
  /* What went wrong when the door was last asked to open, or "". */
  trouble?: string;
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

/* A font a person brought into plxr, not one shipped with it. */
export interface UserFont {
  family: string;
  file: string;
}
