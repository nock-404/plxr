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
  name: string;
  number: number;
  dir: string;
  sessions: number;
}

export interface VersionInfo {
  current: string;
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
