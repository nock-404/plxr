"use client";

import { base, token } from "./token";
import type {
  Account, Agent, AgentProfile, ArchiveEntry, Baseline, FileBody, FileEntry, HookState, Mark, MarkChange, Port,
  NotifyInfo, NotifySettings, NotifyVia, Pace, QueueItem, UpdateStatus, Reply, Rule, SearchHit, FindQuery, FindReport, GitBranch, GitChange, RemoteState, RemoteCode, GitDiff, GitEntry, GitWhere, Session, Template, Theme, TimelineMark, Usage, VersionInfo, Waiting, Workspace,
  UserFont,
} from "./types";

async function req<T>(path: string, opts: RequestInit & { text?: boolean } = {}): Promise<T> {
  const { text, headers, ...rest } = opts;
  const r = await fetch(base() + path, {
    ...rest,
    headers: { "X-Plxr-Token": token(), ...(headers ?? {}) },
  });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  if (r.status === 204) return undefined as T;
  return (text ? await r.text() : await r.json()) as T;
}

export const api = {
  health: () => req<string>("/api/health", { text: true }),

  sessions: () => req<Session[]>("/api/sessions"),
  create: (cwd: string, cmd: string[] = [], name = "", account = "") =>
    req<Session>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ cwd, cmd, name, account }),
    }),
  kill: (id: string) => req<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /* Off the board, not just stopped. Without purge the daemon keeps a stopped
     session in its register, which is right for one that has just died — you
     want to see that it did — and wrong for one somebody is clearing away. */
  forget: (id: string) =>
    req<void>(`/api/sessions/${encodeURIComponent(id)}?purge=1`, { method: "DELETE" }),
  reply: (id: string, text: string, raw = false) =>
    req<void>(`/api/sessions/${encodeURIComponent(id)}/reply${raw ? "?raw=1" : ""}`, {
      method: "POST",
      body: text,
    }),
  freeze: (id: string) => req<void>(`/api/sessions/${encodeURIComponent(id)}/freeze`, { method: "POST" }),
  unfreeze: (id: string) => req<void>(`/api/sessions/${encodeURIComponent(id)}/unfreeze`, { method: "POST" }),
  resume: (id: string) => req<Session>(`/api/sessions/${encodeURIComponent(id)}/resume`, { method: "POST" }),

  emergencyBrake: () => req<void>("/api/freeze", { method: "POST" }),
  releaseBrake: () => req<void>("/api/unfreeze", { method: "POST" }),

  agents: () => req<Agent[]>("/api/agents"),
  windowLog: (lines: string) =>
    req<void>("/api/window-log", { method: "POST", body: lines, headers: { "Content-Type": "text/plain" } }),
  prefsRev: () => req<{ rev: number }>("/api/prefs/rev"),
  prefs: () => req<Record<string, unknown>>("/api/prefs"),
  setPrefs: (change: Record<string, unknown>) =>
    req<void>("/api/prefs", { method: "PUT", body: JSON.stringify(change) }),

  themes: () => req<Theme[]>("/api/themes"),
  themeImport: (text: string) => req<void>("/api/themes", { method: "POST", body: text }),
  themeDelete: (name: string) =>
    req<void>(`/api/themes/${encodeURIComponent(name)}`, { method: "DELETE" }),

  // Fonts a person brings in — the ones not shipped with plxr.
  fonts: () => req<UserFont[]>("/api/fonts"),
  fontImport: (name: string, data: ArrayBuffer) =>
    req<UserFont>(`/api/fonts?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: data,
      headers: { "Content-Type": "application/octet-stream" },
    }),
  fontDelete: (file: string) =>
    req<void>(`/api/fonts/${encodeURIComponent(file)}`, { method: "DELETE" }),
  updateApply: () => req<UpdateStatus>("/api/update", { method: "POST" }),
  updateProgress: () => req<UpdateStatus>("/api/update"),
  restart: () => req<void>("/api/restart", { method: "POST" }),
  branches: (id: string) => req<GitBranch[]>(`/api/branches/${encodeURIComponent(id)}`),
  switchBranch: (id: string, name: string, create = false, anyway = false) =>
    req<GitBranch[]>(`/api/branches/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ name, create, anyway }),
    }),
  deleteBranch: (id: string, name: string) =>
    req<GitBranch[]>(
      `/api/branches/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),

  stage: (id: string, paths: string[], on: boolean) =>
    req<GitChange[]>(`/api/stage/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ paths, on }),
    }),
  commit: (id: string, message: string, amend = false) =>
    req<{ hash: string }>(`/api/commit/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ message, amend }),
    }),
  history: (id: string, n = 20) =>
    req<GitEntry[]>(`/api/history/${encodeURIComponent(id)}?n=${n}`),
  position: (id: string) => req<GitWhere>(`/api/position/${encodeURIComponent(id)}`),

  changes: (id: string) => req<GitChange[]>(`/api/changes/${encodeURIComponent(id)}`),
  diff: (id: string, path: string, staged: boolean) =>
    req<GitDiff>(`/api/diff/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ path, staged }),
    }),

  find: (id: string, q: FindQuery) =>
    req<FindReport>(`/api/find/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ text: q.text, regex: q.regex, case: q.case, word: q.word, glob: q.glob }),
    }),

  remote: () => req<RemoteState>("/api/remote"),
  setRemote: (on: boolean) =>
    req<RemoteState>("/api/remote", { method: "POST", body: JSON.stringify({ on }) }),
  remoteCode: () => req<RemoteCode>("/api/remote/code", { method: "POST" }),

  workspaces: () => req<Workspace[]>("/api/workspaces"),
  openWorkspace: (path: string) =>
    req<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ path }) }),
  closeWorkspace: (id: string) =>
    req<void>(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }),

  paths: (q = "") => req<string[]>(`/api/paths?q=${encodeURIComponent(q)}`),
  accounts: () => req<Account[]>("/api/accounts"),
  accountCreate: (label: string) =>
    req<{ account: Account; accounts: Account[] }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  accountRename: (name: string, label: string) =>
    req<Account[]>(`/api/accounts/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),
  accountSetDefault: (name: string) =>
    req<Account[]>(`/api/accounts/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ default: true }),
    }),
  accountRemove: (name: string) =>
    req<Account[]>(`/api/accounts/${encodeURIComponent(name)}`, { method: "DELETE" }),
  accountAdd: (dir: string, label: string) =>
    req<Account[]>("/api/accounts", { method: "POST", body: JSON.stringify({ dir, label }) }),

  ports: () => req<Port[]>("/api/ports"),
  portKill: (pid: number, hard = false) =>
    req<void>(`/api/ports/${pid}${hard ? "?hard=1" : ""}`, { method: "DELETE" }),

  usage: (days: number) => req<Usage>(`/api/usage?days=${days}`),
  // The current pace: the five-hour spend, the hourly rate, who is spending.
  tempo: () => req<Pace>("/api/tempo"),
  archive: () => req<ArchiveEntry[]>("/api/archive"),
  archiveResume: (id: string) =>
    req<Session>(`/api/archive/${encodeURIComponent(id)}/resume`, { method: "POST" }),

  version: () => req<VersionInfo>("/api/version"),

  listDir: (id: string, dir = "") =>
    req<FileEntry[]>(`/api/files/${encodeURIComponent(id)}?dir=${encodeURIComponent(dir)}`),
  readFile: (id: string, path: string) =>
    req<FileBody>(`/api/file/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`),
  /* The same file as HEAD has it — what the editor's gutter measures the
     buffer against. Empty and not `known` for a file HEAD never saw. */
  baseFile: (id: string, path: string) =>
    req<Baseline>(`/api/base/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`),
  createFile: (id: string, path: string, dir = false) =>
    req<FileEntry>(`/api/file/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ path, dir }),
    }),
  renameFile: (id: string, path: string, to: string) =>
    req<FileEntry>(`/api/file/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ path, to }),
    }),
  removeFile: (id: string, path: string) =>
    req<void>(`/api/file/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  gitStatus: (id: string) => req<Record<string, string>>(`/api/git/${encodeURIComponent(id)}`),
  revealFile: (id: string, path: string) =>
    req<void>(`/api/reveal/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`, { method: "POST" }),

  /* Saving a file. The path, the text and the timestamp the window last saw,
     all in the body — which is what the daemon has always decoded.
     This sent the bare text with the path in the query string, so every save
     hit json.Decode with something that is not JSON and came back as
     err.badJSON with a 400. Measured: the editor could open a file and never
     write one, since it was built. `mod` was not sent either, so the guard
     against a file that changed on disk behind the editor never fired. */
  writeFile: (id: string, path: string, text: string, mod = 0) =>
    req<FileBody>(`/api/file/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ path, text, mod }),
    }),

  rules: (sessionId: string) => req<Rule[]>(`/api/rules?session=${encodeURIComponent(sessionId)}`),
  marks: (sessionId: string) => req<Mark[]>(`/api/marks/${encodeURIComponent(sessionId)}`),
  /* What a mark covers. The route was there from the start and nothing called
     it, so the panel could show a count of files and never which ones. */
  markChanges: (sessionId: string, tree: string) =>
    req<MarkChange[]>(`/api/marks/${encodeURIComponent(sessionId)}/${encodeURIComponent(tree)}`),
  markRestore: (sessionId: string, tree: string, path = "") =>
    req<{ restored: number }>(
      `/api/marks/${encodeURIComponent(sessionId)}/${encodeURIComponent(tree)}/restore`,
      { method: "POST", body: JSON.stringify({ path }) },
    ),

  templates: () => req<Template[]>("/api/templates"),
  templateStart: (name: string) =>
    req<void>(`/api/templates/${encodeURIComponent(name)}/start`, { method: "POST" }),
  templateAdd: (name: string, label: string) =>
    req<void>("/api/templates", { method: "POST", body: JSON.stringify({ Name: name, Label: label }) }),
  templateDelete: (name: string) =>
    req<void>(`/api/templates/${encodeURIComponent(name)}`, { method: "DELETE" }),

  search: (q: string) => req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  searchTerminals: (q: string) => req<SearchHit[]>(`/api/search/terminals?q=${encodeURIComponent(q)}`),

  waiting: (days: number) => req<Waiting>(`/api/waiting?days=${days}`),
  hook: () => req<HookState>("/api/hook"),

  notify: () => req<NotifyInfo>("/api/notify"),
  setNotify: (s: NotifySettings) => req<void>("/api/notify", { method: "PUT", body: JSON.stringify(s) }),
  /* Shows the test notification and says where it went: through the plxr
     window, which posts it with the icon, or from the service itself when no
     window is open. */
  trySound: (sound: string) =>
    req<{ via: NotifyVia }>(`/api/notify/try?sound=${encodeURIComponent(sound)}`, { method: "POST" }),
  /* Two calls, because they are two things. One route with ?an=1 meaning "on"
     read as "off" whenever the flag was left out — which it always was. */
  hookInstall: () => req<HookState>("/api/hook", { method: "POST" }),
  hookRemove: () => req<HookState>("/api/hook", { method: "DELETE" }),
  replies: (q: string) => req<Reply[]>(`/api/replies?q=${encodeURIComponent(q)}`),

  queue: (id: string) => req<QueueItem[]>(`/api/queue/${encodeURIComponent(id)}`),
  queueAdd: (id: string, text: string) =>
    req<void>(`/api/queue/${encodeURIComponent(id)}`, { method: "POST", body: text }),
  queueDrop: (id: string, index: number) =>
    req<void>(`/api/queue/${encodeURIComponent(id)}/${index}`, { method: "DELETE" }),

  timeline: (id: string) => req<TimelineMark[]>(`/api/playback/${encodeURIComponent(id)}/timeline`),
  playback: (id: string, from = 0) =>
    req<string>(`/api/playback/${encodeURIComponent(id)}?from=${from}`, { text: true }),
  agentRead: (name: string) => req<AgentProfile>(`/api/agents/${encodeURIComponent(name)}`),
  agentStarter: (name: string) => req<AgentProfile>(`/api/agents/${encodeURIComponent(name)}/starter`),
  agentWrite: (name: string, profile: AgentProfile) =>
    req<void>(`/api/agents/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(profile, null, 2),
    }),
  agentDelete: (name: string) =>
    req<void>(`/api/agents/${encodeURIComponent(name)}`, { method: "DELETE" }),

  /* Answers with the session it became: moving accounts gives it a new id. It
     was typed as void, so the window had no way to follow it even if it had
     looked. */
  switchAccount: (id: string, account: string) =>
    req<Session>(`/api/sessions/${encodeURIComponent(id)}/account`, {
      method: "POST",
      body: JSON.stringify({ account }),
    }),
};
