"use client";

import { base, token } from "./token";
import type {
  Account, Agent, AgentProfile, ArchiveEntry, FileBody, FileEntry, HookState, Mark, Port,
  NotifySettings, QueueItem, UpdateStatus, Reply, Rule, SearchHit, Session, Template, Theme, TimelineMark, Usage, VersionInfo, Waiting,
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
  updateApply: () => req<UpdateStatus>("/api/update", { method: "POST" }),
  updateProgress: () => req<UpdateStatus>("/api/update"),
  restart: () => req<void>("/api/restart", { method: "POST" }),
  paths: (q = "") => req<string[]>(`/api/paths?q=${encodeURIComponent(q)}`),
  accounts: () => req<Account[]>("/api/accounts"),
  accountAdd: (dir: string, label: string) =>
    req<Account[]>("/api/accounts", { method: "POST", body: JSON.stringify({ dir, label }) }),
  accountRename: (name: string, label: string) =>
    req<Account[]>(`/api/accounts/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),
  accountRemove: (name: string) =>
    req<Account[]>(`/api/accounts/${encodeURIComponent(name)}`, { method: "DELETE" }),

  ports: () => req<Port[]>("/api/ports"),
  portKill: (pid: number, hard = false) =>
    req<void>(`/api/ports/${pid}${hard ? "?hard=1" : ""}`, { method: "DELETE" }),

  usage: (days: number) => req<Usage>(`/api/usage?days=${days}`),
  archive: () => req<ArchiveEntry[]>("/api/archive"),
  archiveResume: (id: string) =>
    req<Session>(`/api/archive/${encodeURIComponent(id)}/resume`, { method: "POST" }),

  version: () => req<VersionInfo>("/api/version"),

  listDir: (id: string, dir = "") =>
    req<FileEntry[]>(`/api/files/${encodeURIComponent(id)}?dir=${encodeURIComponent(dir)}`),
  readFile: (id: string, path: string) =>
    req<FileBody>(`/api/file/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`),
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

  writeFile: (id: string, path: string, text: string) =>
    req<void>(`/api/file/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: text,
    }),

  rules: (sessionId: string) => req<Rule[]>(`/api/rules?session=${encodeURIComponent(sessionId)}`),
  marks: (sessionId: string) => req<Mark[]>(`/api/marks/${encodeURIComponent(sessionId)}`),
  markRestore: (sessionId: string, tree: string) =>
    req<void>(`/api/marks/${encodeURIComponent(sessionId)}/${encodeURIComponent(tree)}/restore`, {
      method: "POST",
    }),

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

  notify: () => req<{ settings: NotifySettings; sounds: string[] }>("/api/notify"),
  setNotify: (s: NotifySettings) => req<void>("/api/notify", { method: "PUT", body: JSON.stringify(s) }),
  trySound: (sound: string) =>
    req<void>(`/api/notify/try?sound=${encodeURIComponent(sound)}`, { method: "POST" }),
  hookInstall: () => req<void>("/api/hook", { method: "POST" }),
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

  switchAccount: (id: string, account: string) =>
    req<void>(`/api/sessions/${encodeURIComponent(id)}/account`, {
      method: "POST",
      body: JSON.stringify({ account }),
    }),
};
