import type { IconName } from "./icons";

/* What a file is, as an icon.
 *
 * One table for the tree and for the tabs, so a file wears the same mark in
 * both places. Only the picture lives here; the kind a skin colours by stays
 * with each of them, because the two have always sorted files a little
 * differently and the stylesheets address exactly those values. */

const BY_EXTENSION: Record<string, IconName> = {
  ts: "file-ts",
  mts: "file-ts",
  cts: "file-ts",
  tsx: "file-tsx",
  js: "file-js",
  mjs: "file-js",
  cjs: "file-js",
  jsx: "file-jsx",
  go: "file-go",
  py: "file-py",
  rs: "file-rs",
  php: "file-php",
  rb: "file-code",
  java: "file-code",
  kt: "file-code",
  swift: "file-code",
  c: "file-code",
  h: "file-code",
  m: "file-code",
  mm: "file-code",
  cpp: "file-code",
  hpp: "file-code",
  cs: "file-code",
  lua: "file-code",
  vim: "file-code",
  vue: "file-code",
  sh: "file-shell",
  bash: "file-shell",
  zsh: "file-shell",
  ps1: "file-shell",
  bat: "file-shell",
  cmd: "file-shell",
  css: "file-css",
  scss: "file-css",
  html: "file-html",
  json: "file-json",
  jsonl: "file-json",
  yml: "file-config",
  yaml: "file-config",
  toml: "file-config",
  ini: "file-config",
  env: "file-env",
  sql: "file-sql",
  csv: "file-csv",
  md: "file-markdown",
  txt: "file-text",
  rst: "file-text",
  png: "file-png",
  jpg: "file-jpg",
  jpeg: "file-jpg",
  svg: "file-svg",
  gif: "file-image",
  webp: "file-image",
  ico: "file-image",
  zip: "file-zip",
  gz: "file-archive",
  tar: "file-archive",
  dump: "file-archive",
  lock: "file-lock",
};

// Whole names that say more than their extension does.
const BY_NAME: Record<string, IconName> = {
  "package.json": "file-manifest",
  "go.mod": "file-manifest",
  "go.sum": "file-lock",
  "package-lock.json": "file-lock",
  "pnpm-lock.yaml": "file-lock",
  dockerfile: "file-build",
  makefile: "file-build",
  "readme.md": "file-readme",
  "claude.md": "file-readme",
  ".gitignore": "file-config",
  ".env": "file-env",
};

/* The icon for a path or a bare name. A folder is a folder whatever it is
   called; a file nothing here recognises is a plain file. */
export function fileIcon(path: string, dir = false): IconName {
  if (dir) return "folder";
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  return (dot > 0 && BY_EXTENSION[name.slice(dot + 1)]) || "file";
}
