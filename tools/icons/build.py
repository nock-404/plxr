#!/usr/bin/env python3
"""Build plxr's icon packs from their upstream sets, at pinned commits.

plxr offers four packs to choose between. Each is drawn from open-source sets
fetched here at a commit written down in this file — never at whatever a
branch points to today, because a set that moves under a build changes the
window without anybody having decided it.

What comes out, all of it written by this script and none of it by hand:

  frontend/public/icons/<pack>.svg     one sprite per pack, one <symbol> per name
  frontend/public/icons/sources.json   which upstream file every symbol came from
  frontend/public/licenses/<set>.txt   each set's LICENSE file, byte for byte
  frontend/lib/icons.ts                the names, the packs and the sets, for the window

Only the icons plxr uses are fetched and kept. Every one is normalised the same
way: no width or height, the one viewBox of its set, and its colour reduced to
currentColor, so the skin decides what colour an icon is.

The licence rules are enforced here, not remembered:
  - Phosphor: the regular weight only (duotone paints a 20% back layer that
    turns to mush on the tube), and never a file whose name contains "-logo" —
    those are third-party trademarks, and the licence grants no trademark rights.
  - Pixelarticons: only the svg/ folder of the free repository its licence covers.
    Its `npx pixelarticons upgrade` command installs the paid Pro set, which
    that licence does not cover; nothing here runs it or fetches from it.
  - Seti UI and Catppuccin draw in colour. Every colour is removed, and an icon
    that needs a gradient or a second colour to be read is refused.
  - File kinds use letters and generic shapes. Where a set's icon for a
    language is that language's logo (the Python snakes, the Rust gear, the Go
    gopher, the Docker whale, the npm or git marks), the entry below falls back
    to a lettered or generic icon instead, for the same trademark reason.

Run it from anywhere:  python3 tools/icons/build.py
Sources are cached under $PLXR_ICON_CACHE, or a directory in the system's temp.
"""
import concurrent.futures
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(ROOT, "frontend", "public")
ICONS_OUT = os.path.join(PUBLIC, "icons")
LICENCES_OUT = os.path.join(PUBLIC, "licenses")
TS_OUT = os.path.join(ROOT, "frontend", "lib", "icons.ts")
CACHE = os.environ.get("PLXR_ICON_CACHE") or os.path.join(tempfile.gettempdir(), "plxr-icon-sources")

# ---------------------------------------------------------------------------
# The upstream sets, each at one commit.
#
# `colours` says what happens to a colour found in a file:
#   keep     the set already draws in currentColor; any other colour is refused
#   strip    fill, stroke and stop-color are removed; the symbol paints in currentColor
#   replace  every colour becomes currentColor
# ---------------------------------------------------------------------------
SETS = {
    "tabler-icons": {
        "title": "Tabler Icons",
        "repo": "tabler/tabler-icons",
        "commit": "55f87a73f45cf1d9eaf16d7da705065483a9e4f9",
        "licence_file": "LICENSE",
        "licence": "MIT",  # german-ok: the licence's name
        "dir": "icons/outline",
        "viewBox": "0 0 24 24",
        "colours": "keep",
    },
    "phosphor-core": {
        "title": "Phosphor Icons",
        "repo": "phosphor-icons/core",
        "commit": "2b75f3ad12b420c9504ef05df8d2564a28f8500e",
        "licence_file": "LICENSE",
        "licence": "MIT",  # german-ok: the licence's name
        "dir": "assets/regular",
        "viewBox": "0 0 256 256",
        "colours": "keep",
    },
    "seti-ui": {
        "title": "Seti UI",
        "repo": "jesseweed/seti-ui",
        "commit": "2d6c5e68b4ded73c92dac291845ee44e1182d511",
        "licence_file": "LICENSE.md",
        "licence": "MIT",  # german-ok: the licence's name
        "dir": "icons",
        "viewBox": "0 0 32 32",
        "colours": "strip",
    },
    "lucide": {
        "title": "Lucide",
        "repo": "lucide-icons/lucide",
        "commit": "a79b2d131dab2bf20cb224bd0937b439a9c4fa99",
        "licence_file": "LICENSE",
        # One file, two notices: ISC for Lucide, and the Feather project's own
        # for the icons derived from it. It is shipped whole, so both travel
        # together.
        "licence": "ISC, MIT",  # german-ok: the licences' names
        "dir": "icons",
        "viewBox": "0 0 24 24",
        "colours": "keep",
    },
    "catppuccin-vscode-icons": {
        "title": "Catppuccin VSCode Icons",
        "repo": "catppuccin/vscode-icons",
        "commit": "b6915da9f6889b683a110aa747de96c2820a537d",
        "licence_file": "LICENSE",
        "licence": "MIT",  # german-ok: the licence's name
        # The css-variables flavour: colours are variables rather than values,
        # which is what makes them replaceable.
        "dir": "icons/css-variables",
        "viewBox": "0 0 16 16",
        "colours": "replace",
    },
    "pixelarticons": {
        "title": "Pixelarticons",
        "repo": "halfmage/pixelarticons",
        "commit": "8275e0af7c16aa40c54ea2b90b7af83b1fe4eb4c",
        "licence_file": "LICENSE",
        "licence": "MIT",  # german-ok: the licence's name
        "dir": "svg",
        "viewBox": "0 0 24 24",
        "colours": "keep",
        "crisp": True,
    },
}

# The packs, and the set each one draws its interface icons from. File kinds
# may come from a second set; see FILES.
PACKS = {
    "tabler": {"label": "Tabler", "set": "tabler-icons"},
    "phosphor": {"label": "Phosphor", "set": "phosphor-core"},
    "lucide": {"label": "Lucide", "set": "lucide"},
    "pixel": {"label": "Pixel", "set": "pixelarticons"},
}
PACK_ORDER = ["tabler", "phosphor", "lucide", "pixel"]
# The pack a window draws with until somebody picks one. He chose Pixel on
# 13.09.2026. A look that was saved keeps the pack it was saved with.
DEFAULT_PACK = "pixel"

# ---------------------------------------------------------------------------
# Drawn for plxr, per pack, where the pack's set has no shape for a name. Each
# drawing sits on its pack's grid, in currentColor, in that pack's house style:
#
#   pixel     Pixelarticons has no diff, no network port and no window with a
#             panel. A 24-unit grid, integer coordinates, bars two units thick
#             (one pixel of the 12-cell art), axis-aligned, corners left open,
#             no curves. The panels are the frame of its own terminal icon
#             with a two-unit bar across it.
#   phosphor  The regular weight has sidebar-simple, which faces left, and
#             nothing that faces right or down. Its 256-unit grid, a 16-unit
#             outline with 16-unit corner arcs, holes cut by winding. The two
#             panels are sidebar-simple's own frame with its column moved; the
#             build stops if that frame no longer opens the file at the pin.
# ---------------------------------------------------------------------------
PIXEL_FRAME = "M4 2h16v2H4zM4 20h16v2H4zM2 4h2v16H2zM20 4h2v16h-2z"
PHOSPHOR_FRAME = (
    "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Z"
)
OWN = {
    "phosphor": {
        "panel-right": {
            "body": f'<path d="{PHOSPHOR_FRAME}M40,56H160V200H40ZM176,56H216V200H176Z"/>',
            "what": "sidebar-simple mirrored: the column on the right",
            "after": "sidebar-simple",
            "frame": PHOSPHOR_FRAME,
        },
        "panel-bottom": {
            "body": f'<path d="{PHOSPHOR_FRAME}M40,56H216V144H40ZM40,160H216V200H40Z"/>',
            "what": "sidebar-simple's frame with its column laid along the bottom",
            "after": "sidebar-simple",
            "frame": PHOSPHOR_FRAME,
        },
    },
    "pixel": {
        "diff": {
            "body": '<path d="M11 4h2v10h-2zM6 8h12v2H6zM6 18h12v2H6z"/>',
            "what": "plus over minus",
        },
        "ports": {
            "body": (
                '<path d="M4 2h16v2H4zM2 4h2v12H2zM20 4h2v12h-2zM4 16h6v2H4zM14 16h6v2h-6z'
                'M8 18h2v2H8zM14 18h2v2h-2zM10 20h4v2h-4zM7 7h2v4H7zM11 7h2v4h-2zM15 7h2v4h-2z"/>'
            ),
            "what": "a network socket with three contacts and its latch",
        },
        "panel-left": {
            "body": f'<path d="{PIXEL_FRAME}M8 4h2v16H8z"/>',
            "what": "a window with a column along its left side",
        },
        "panel-right": {
            "body": f'<path d="{PIXEL_FRAME}M14 4h2v16h-2z"/>',
            "what": "a window with a column along its right side",
        },
        "panel-bottom": {
            "body": f'<path d="{PIXEL_FRAME}M4 14h16v2H4z"/>',
            "what": "a window with a row along its bottom",
        },
    },
}

# ---------------------------------------------------------------------------
# The vocabulary: one name per thing plxr shows, mapped per pack.
#
# A spec is "icon" (from the pack's own set), "set:icon", "plxr:name" (drawn
# above), or a list of those tried in order — the first one that passes the
# rules is used, and every refusal is written into sources.json with its reason.
# ---------------------------------------------------------------------------
#                    tabler                 phosphor                   lucide                     pixel
UI = {
    "overview":      ("layout-dashboard",   "squares-four",            "layout-dashboard",        "grid-2x2-2"),
    "inbox":         ("inbox",              "tray",                    "inbox",                   "inbox"),
    "folder":        ("folder",             "folder",                  "folder",                  "folder"),
    "changes":       ("git-compare",        "git-diff",                "git-compare",             "plxr:diff"),
    "review":        ("git-pull-request",   "git-pull-request",        "git-pull-request",        "git-pull-request"),
    "search":        ("search",             "magnifying-glass",        "search",                  "search"),
    "ports":         ("plug-connected",     "plugs-connected",         "ethernet-port",           "plxr:ports"),
    "usage":         ("gauge",              "gauge",                   "gauge",                   "chart-bar-big"),
    "archive":       ("archive",            "archive",                 "archive",                 "archive"),
    "notes":         ("notes",              "note-pencil",             "notebook-pen",            "notes"),
    "settings":      ("settings",           "gear-six",                "settings",                "settings-cog"),
    "terminal":      ("terminal-2",         "terminal-window",         "square-terminal",         "terminal"),
    "file":          ("file",               "file",                    "file",                    "file"),
    "close":         ("x",                  "x",                       "x",                       "close"),
    "chevron-right": ("chevron-right",      "caret-right",             "chevron-right",           "chevron-right"),
    "chevron-down":  ("chevron-down",       "caret-down",              "chevron-down",            "chevron-down"),
    "play":          ("player-play",        "play",                    "play",                    "play"),
    "pause":         ("player-pause",       "pause",                   "pause",                   "pause"),
    "stop":          ("player-stop",        "stop",                    "square",                  "stop"),
    "warning":       ("alert-triangle",     "warning",                 "triangle-alert",          "warning-diamond"),
    "check":         ("check",              "check",                   "check",                   "check"),
    "git-branch":    ("git-branch",         "git-branch",              "git-branch",              "git-branch"),
    "diff":          ("file-diff",          ["plus-minus", "git-diff"], "diff",                   "plxr:diff"),
    "help":          ("help",               "question",                "circle-question-mark",    "circle-question"),
    "reset":         ("restore",            "arrow-counter-clockwise", "rotate-ccw",              "reload"),
    "plus":          ("plus",               "plus",                    "plus",                    "plus"),
    "preview":       ("app-window",         "browser",                 "app-window",              "monitor"),
    # The tool stripes (spec 2026-09-13 §9), as he picked them on 13.09.2026.
    # The tools themselves and the two switchers keep the names above.
    "files":         ("list-tree",          "tree-view",               "folder-tree",             "files"),
    "hide":          ("minus",              "minus",                   "minus",                   "minus"),
    "more":          ("dots-vertical",      "dots-three-outline-vertical", "ellipsis-vertical",   "more-vertical"),
    "move":          ("grip-vertical",      "arrows-out-cardinal",     "grip-vertical",           "move"),
    "panel-left":    ("layout-sidebar",     "sidebar-simple",          "panel-left",              "plxr:panel-left"),
    "panel-right":   ("layout-sidebar-right", "plxr:panel-right",      "panel-right",             "plxr:panel-right"),
    "panel-bottom":  ("layout-bottombar",   "plxr:panel-bottom",       "panel-bottom",            "plxr:panel-bottom"),
}

S = "seti-ui:"
C = "catppuccin-vscode-icons:"

# Logos, refused by name whatever the colour rules would let through. Looked at
# one by one at the pinned commits: each of these is a language's or a
# product's own mark, not a letter or a generic shape.
LOGOS = {
    ("seti-ui", name) for name in
    ("go", "go2", "python", "rust", "php", "npm", "docker", "git", "git_ignore", "github", "react")
} | {
    ("catppuccin-vscode-icons", name) for name in
    ("go", "go-mod", "python", "rust", "php", "html", "svg", "docker", "git",
     "typescript-react", "javascript-react", "package-json")
}

#                    tabler             phosphor: Seti, then Phosphor      lucide: Catppuccin, then Lucide    pixel
FILES = {
    "file-code":     ("file-code",      "file-code",                       "file-code",                       "code"),
    "file-ts":       ("file-type-ts",   [S + "typescript", "file-ts"],     [C + "typescript"],                "code"),
    "file-tsx":      ("file-type-tsx",  [S + "typescript", "file-tsx"],    [C + "typescript"],                "code"),
    "file-js":       ("file-type-js",   [S + "javascript", "file-js"],     [C + "javascript"],                "code"),
    "file-jsx":      ("file-type-jsx",  [S + "javascript", "file-jsx"],    [C + "javascript"],                "code"),
    "file-go":       ("file-code",      "file-code",                       "file-code",                       "code"),
    "file-py":       ("file-code",      "file-py",                         "file-code",                       "code"),
    "file-rs":       ("file-type-rs",   "file-rs",                         "file-code",                       "code"),
    "file-php":      ("file-type-php",  "file-code",                       "file-code",                       "code"),
    "file-shell":    ("script",         [S + "shell", "terminal"],         [C + "bash", "file-terminal"],     "script"),
    "file-css":      ("file-type-css",  [S + "css", "file-css"],           [C + "css"],                       "code"),
    "file-html":     ("file-type-html", [S + "html", "file-html"],         "file-code",                       "code"),
    "file-json":     ("braces",         [S + "json", "brackets-curly"],    [C + "json", "file-braces"],       "braces"),
    "file-config":   ("file-settings",  [S + "config", "gear"],            [C + "config", "file-cog"],        "sliders"),
    "file-env":      ("key",            [S + "settings", "key"],           [C + "env", "key"],                "key"),
    "file-sql":      ("file-type-sql",  [S + "db", "file-sql"],            [C + "database", "database"],      "database"),
    "file-csv":      ("file-type-csv",  [S + "csv", "file-csv"],           [C + "csv"],                       "file-text"),
    "file-markdown": ("markdown",       [S + "markdown", "file-md"],       [C + "markdown"],                  "article"),
    "file-text":     ("file-type-txt",  [S + "default", "file-text"],      [C + "text", "file-text"],         "file-text"),
    "file-png":      ("file-type-png",  [S + "image", "file-png"],         [C + "image", "file-image"],       "image"),
    "file-jpg":      ("file-type-jpg",  [S + "image", "file-jpg"],         [C + "image", "file-image"],       "image"),
    "file-svg":      ("file-type-svg",  [S + "svg", "file-svg"],           "file-image",                      "image"),
    "file-image":    ("photo",          [S + "image", "file-image"],       [C + "image", "file-image"],       "image"),
    "file-zip":      ("file-type-zip",  [S + "zip", "file-zip"],           [C + "zip", "file-archive"],       "archive"),
    "file-archive":  ("file-zip",       [S + "zip", "file-archive"],       [C + "zip", "file-archive"],       "archive"),
    "file-lock":     ("lock",           [S + "lock", "file-lock"],         [C + "lock", "file-lock"],         "lock"),
    "file-manifest": ("package",        "package",                         "package",                         "package"),
    "file-build":    ("tool",           [S + "makefile", "hammer"],        [C + "makefile", "hammer"],        "tools"),
    "file-readme":   ("book",           [S + "info", "book-open"],         [C + "readme", "book-open"],       "book-open"),
}

NAMES = list(UI) + list(FILES)

SHAPES = {"path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g"}
IGNORED = {"title", "desc", "metadata"}
GEOMETRY = {
    "d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2",
    "points", "transform", "fill-rule", "clip-rule", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit",
}
PAINT = {"fill", "stroke", "stop-color", "color"}
ROOT_KEEP = {"fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule"}
# Anything that paints with more than one flat colour.
REFUSED_ATTRS = {"opacity", "fill-opacity", "stroke-opacity", "filter", "mask", "clip-path"}


class Refused(Exception):
    pass


def fetch(repo, commit, path):
    local = os.path.join(CACHE, repo, commit, path)
    if os.path.exists(local):
        with open(local, "rb") as fh:
            return fh.read()
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise
    os.makedirs(os.path.dirname(local), exist_ok=True)
    with open(local, "wb") as fh:
        fh.write(data)
    return data


class Node:
    def __init__(self, tag, attrib):
        self.tag = tag
        self.attrib = attrib
        self.children = []

    def __iter__(self):
        return iter(self.children)


TOKEN = re.compile(r"<!--.*?-->|<\?.*?\?>|<!\w[^>]*>|</\s*([\w:-]+)\s*>|<([\w:-]+)((?:\s+[^\s=/>]+\s*=\s*(?:\"[^\"]*\"|'[^']*'))*)\s*(/?)>|([^<]+)", re.S)
ATTR = re.compile(r"([^\s=/>]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')")


def parse(data):
    """The few shapes an icon file is made of, read without an XML library.

    Python's own parser needs expat, and a Homebrew Python whose expat does not
    match the system's refuses to load it at all — so a build script that
    leans on it only works on some machines. Icon files are small and regular:
    elements, attributes in quotes, comments. Anything else is refused."""
    text = data.decode("utf-8")
    root, stack, at = None, [], 0
    for match in TOKEN.finditer(text):
        if match.start() != at:
            raise Refused(f"cannot read the markup at offset {at}")
        at = match.end()
        closing, opening, attrs, selfclose, loose = match.groups()
        if loose is not None:
            if loose.strip() and stack and local(stack[-1].tag) not in IGNORED:
                raise Refused("contains text")
            continue
        if closing:
            if not stack or stack[-1].tag != closing:
                raise Refused(f"closes <{closing}> it never opened")
            stack.pop()
            continue
        if not opening:
            continue  # a comment, a declaration or a doctype
        node = Node(opening, {k: html.unescape(a if a is not None else b) for k, a, b in ATTR.findall(attrs)})
        if stack:
            stack[-1].children.append(node)
        elif root is None:
            root = node
        else:
            raise Refused("has more than one root element")
        if not selfclose:
            stack.append(node)
    if at != len(text) or stack or root is None:
        raise Refused("is not a complete svg")
    return root


def local(tag):
    return tag.split(":", 1)[1] if ":" in tag else tag


def paint(value, mode, colours):
    """What a colour attribute becomes, or None to drop it."""
    value = value.strip()
    if value in ("none", "currentColor", "inherit"):
        return value
    colours.add(value)
    if mode == "keep":
        raise Refused(f"paints in a colour of its own: {value}")
    if value.startswith("url("):
        raise Refused("paints with a gradient or pattern")
    return None if mode == "strip" else "currentColor"


def attributes_of(element, mode, colours, allowed):
    out = {}
    declared = dict(element.attrib)
    style = declared.pop("style", "")
    for part in filter(None, (p.strip() for p in style.split(";"))):
        name, _, value = part.partition(":")
        declared[name.strip()] = value.strip()
    for name, value in declared.items():
        name = local(name)
        if name in REFUSED_ATTRS:
            if name == "opacity" and value.strip() in ("1", "1.0"):
                continue
            raise Refused(f"uses {name}")
        if name in PAINT:
            if name in ("stop-color", "color"):
                if mode == "keep" and value.strip() not in ("currentColor", "inherit"):
                    raise Refused(f"sets {name}")
                continue
            kept = paint(value, mode, colours)
            if kept is not None:
                if mode == "strip" and name == "stroke" and kept not in ("none",):
                    raise Refused("draws with a stroke that stripping would erase")
                out[name] = kept
            elif mode == "strip" and name == "stroke":
                raise Refused("draws with a coloured stroke that stripping would erase")
            continue
        if name in allowed:
            out[name] = value
    return out


def declared(element):
    """The paint an element names itself, before any rule has touched it."""
    out = {k: v.strip() for k, v in element.attrib.items() if k in ("fill", "stroke")}
    for part in filter(None, (p.strip() for p in element.attrib.get("style", "").split(";"))):
        name, _, value = part.partition(":")
        if name.strip() in ("fill", "stroke"):
            out[name.strip()] = value.strip()
    return out


def serialise(element, mode, colours, fill, stroke):
    """One element and what is inside it. `fill` and `stroke` are what it
    inherits, so a shape that names no colour is still counted as painting in
    one — the default black, which beside a named colour is a second colour."""
    tag = local(element.tag)
    if tag in IGNORED:
        return ""
    if tag not in SHAPES:
        raise Refused(f"contains <{tag}>")
    attrs = attributes_of(element, mode, colours, GEOMETRY)
    # Inheritance follows what the file says, not what is left after
    # stripping: a fill that was removed was still a colour.
    own = declared(element)
    fill = own.get("fill", fill)
    stroke = own.get("stroke", stroke)
    if tag != "g":
        if fill == "none" and stroke in (None, "none"):
            return ""  # an invisible sizing box, as Tabler puts in some files
        if fill is None:
            colours.add("the default black")
    children = "".join(serialise(child, mode, colours, fill, stroke) for child in element)
    head = tag + "".join(f' {k}="{html.escape(v, quote=True)}"' for k, v in attrs.items())
    return f"<{head}>{children}</{tag}>" if children else f"<{head}/>"


def normalise(set_id, name, data):
    spec = SETS[set_id]
    if (set_id, name) in LOGOS or (set_id == "phosphor-core" and "-logo" in name):
        raise Refused("a third-party logo")
    root = parse(data)
    if local(root.tag) != "svg":
        raise Refused("is not an svg")
    view = " ".join(root.attrib.get("viewBox", "").split())
    if view != spec["viewBox"]:
        raise Refused(f"viewBox {view!r}, the set's is {spec['viewBox']!r}")
    colours = set()
    mode = spec["colours"]
    symbol = attributes_of(root, mode, colours, ROOT_KEEP)
    body = "".join(serialise(child, mode, colours, declared(root).get("fill"), declared(root).get("stroke")) for child in root)
    if len(colours) > 1:
        raise Refused(f"needs {len(colours)} colours to be read: {', '.join(sorted(colours))}")
    if not body:
        raise Refused("draws nothing")
    symbol.setdefault("fill", "currentColor")
    if spec.get("crisp"):
        symbol["shape-rendering"] = "crispEdges"
    return view, symbol, body


def candidates(spec, pack):
    for item in spec if isinstance(spec, list) else [spec]:
        if item.startswith("plxr:"):
            yield "plxr", item[5:]
        elif ":" in item:
            set_id, icon = item.split(":", 1)
            yield set_id, icon
        else:
            yield PACKS[pack]["set"], item


def resolve(pack, name, spec, fetched):
    refusals = []
    for set_id, icon in candidates(spec, pack):
        if set_id == "plxr":
            own = OWN.get(pack, {}).get(icon)
            if own is None:
                refusals.append({"set": "plxr", "path": icon, "why": f"not drawn for the {pack} pack"})
                continue
            base_id = PACKS[pack]["set"]
            base = SETS[base_id]
            origin = {"set": "plxr", "what": own["what"]}
            if "after" in own:
                path = f"{base['dir']}/{own['after']}.svg"
                upstream = fetched.get((base_id, path))
                first = next((n for n in parse(upstream) if local(n.tag) == "path"), None) if upstream else None
                if first is None or not first.attrib.get("d", "").startswith(own["frame"]):
                    raise SystemExit(f"  {pack}: plxr:{icon} is drawn after {path}, whose frame is not the one it copies")
                if not own["body"].startswith(f'<path d="{own["frame"]}'):
                    raise SystemExit(f"  {pack}: plxr:{icon} does not start from the frame it names")
                origin["after"] = {"set": base_id, "path": path}
            symbol = {"fill": "currentColor"}
            if base.get("crisp"):
                symbol["shape-rendering"] = "crispEdges"
            return origin, base["viewBox"], symbol, own["body"], refusals
        path = f"{SETS[set_id]['dir']}/{icon}.svg"
        data = fetched.get((set_id, path))
        if data is None:
            refusals.append({"set": set_id, "path": path, "why": "not in the set at this commit"})
            continue
        try:
            view, symbol, body = normalise(set_id, icon, data)
        except Refused as why:
            refusals.append({"set": set_id, "path": path, "why": str(why)})
            continue
        return {"set": set_id, "path": path}, view, symbol, body, refusals
    raise SystemExit(f"  {pack}: no usable icon for {name!r}: {json.dumps(refusals)}")


def main():
    table = {name: dict(zip(PACK_ORDER, row)) for name, row in {**UI, **FILES}.items()}
    wanted = set()
    for name, row in table.items():
        for pack, spec in row.items():
            for set_id, icon in candidates(spec, pack):
                if set_id != "plxr":
                    wanted.add((set_id, f"{SETS[set_id]['dir']}/{icon}.svg"))
    for pack, drawings in OWN.items():
        for own in drawings.values():
            if "after" in own:
                set_id = PACKS[pack]["set"]
                wanted.add((set_id, f"{SETS[set_id]['dir']}/{own['after']}.svg"))
    for set_id, spec in SETS.items():
        wanted.add((set_id, spec["licence_file"]))

    with concurrent.futures.ThreadPoolExecutor(16) as pool:
        jobs = {key: pool.submit(fetch, SETS[key[0]]["repo"], SETS[key[0]]["commit"], key[1]) for key in wanted}
        fetched = {key: job.result() for key, job in jobs.items()}

    os.makedirs(ICONS_OUT, exist_ok=True)
    os.makedirs(LICENCES_OUT, exist_ok=True)

    sources = {"generatedBy": "tools/icons/build.py", "sets": {}, "packs": {}}
    used_by = {}  # set id -> {pack: set of parts}
    versions = {}
    for pack in PACK_ORDER:
        lines = [
            '<svg xmlns="http://www.w3.org/2000/svg">',
            "<!-- Generated by tools/icons/build.py. Do not edit: change the script and run it again. -->",
            f"<!-- The {PACKS[pack]['label']} icon pack for plxr. Licences: /licenses/ -->",
        ]
        record = {}
        for name in NAMES:
            origin, view, symbol, body, refusals = resolve(pack, name, table[name][pack], fetched)
            if origin["set"] == "plxr":
                where = f"drawn for plxr: {origin['what']}"
            else:
                s = SETS[origin["set"]]
                where = f"{s['repo']}@{s['commit'][:12]} {origin['path']}"
                used_by.setdefault(origin["set"], {}).setdefault(pack, set()).add(
                    "files" if name.startswith("file-") else "icons"
                )
            attrs = "".join(f' {k}="{html.escape(v, quote=True)}"' for k, v in symbol.items())
            lines.append(f"<!-- {name}: {where} -->")
            lines.append(f'<symbol id="{name}" viewBox="{view}"{attrs}>{body}</symbol>')
            record[name] = {**origin, **({"refused": refusals} if refusals else {})}
        lines.append("</svg>")
        sprite = "\n".join(lines) + "\n"
        check_sprite(pack, sprite)
        with open(os.path.join(ICONS_OUT, f"{pack}.svg"), "w", encoding="utf-8") as fh:
            fh.write(sprite)
        versions[pack] = hashlib.sha256(sprite.encode()).hexdigest()[:12]
        sources["packs"][pack] = record

    third_party = []
    for set_id, spec in SETS.items():
        if set_id not in used_by:
            continue
        text = fetched[(set_id, spec["licence_file"])]
        if not text:
            raise SystemExit(f"  {set_id}: no {spec['licence_file']} at {spec['commit']}")
        with open(os.path.join(LICENCES_OUT, f"{set_id}.txt"), "wb") as fh:
            fh.write(text)
        sources["sets"][set_id] = {
            "title": spec["title"],
            "repo": f"https://github.com/{spec['repo']}",
            "commit": spec["commit"],
            "folder": spec["dir"],
            "licenceFile": f"licenses/{set_id}.txt",
            "licenceSha256": hashlib.sha256(text).hexdigest(),
        }
        uses = [
            {"pack": pack, "part": part}
            for pack in PACK_ORDER
            for part in sorted(used_by[set_id].get(pack, ()))
        ]
        third_party.append({"id": set_id, **sources["sets"][set_id], "licence": spec["licence"], "uses": uses})

    with open(os.path.join(ICONS_OUT, "sources.json"), "w", encoding="utf-8") as fh:
        json.dump(sources, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    drawn = [(pack, [n for n in NAMES if sources["packs"][pack][n]["set"] == "plxr"]) for pack in PACK_ORDER]
    write_ts(versions, third_party, [(pack, names) for pack, names in drawn if names])

    for pack in PACK_ORDER:
        fell_back = {n: r for n, r in sources["packs"][pack].items() if r.get("refused")}
        print(f"  {pack}: {len(NAMES)} icons, {len(fell_back)} took a fallback")
        for n, r in fell_back.items():
            for refusal in r["refused"]:
                print(f"      {n}: {refusal['set']} {refusal['path']} refused — {refusal['why']}")
    print(f"  licences: {', '.join(t['id'] for t in third_party)}")


FORBIDDEN = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|var\(|url\(|style=|opacity|<style|Gradient")


def check_sprite(pack, sprite):
    body = re.sub(r"<!--.*?-->", "", sprite, flags=re.S)
    found = FORBIDDEN.search(body)
    if found:
        raise SystemExit(f"  {pack}: the sprite still carries {found.group(0)!r}")
    ids = re.findall(r'<symbol id="([^"]+)"', body)
    if sorted(ids) != sorted(NAMES) or len(ids) != len(set(ids)):
        raise SystemExit(f"  {pack}: the sprite's symbols do not match the vocabulary")
    if re.search(r"<symbol[^>]*\s(width|height)=", body):
        raise SystemExit(f"  {pack}: a symbol keeps a width or height")


def write_ts(versions, third_party, drawn):
    q = json.dumps
    out = [
        "/* Generated by tools/icons/build.py. Do not edit by hand: change the script",
        "   and run it again. */",
        "",
        f"export const ICON_PACKS = [{', '.join(q(p) for p in PACK_ORDER)}] as const;",
        "export type IconPack = (typeof ICON_PACKS)[number];",
        f"export const DEFAULT_ICON_PACK: IconPack = {q(DEFAULT_PACK)};",
        "",
        "/* A pack's name is a name, the same in every language. */",
        "export const PACK_LABELS: Record<IconPack, string> = {",
        *[f"  {p}: {q(PACKS[p]['label'])}," for p in PACK_ORDER],
        "};",
        "",
        "/* Changes whenever a sprite does, so a window never draws from a copy the",
        "   web view kept from before an update. */",
        "export const SPRITE_VERSIONS: Record<IconPack, string> = {",
        *[f"  {p}: {q(versions[p])}," for p in PACK_ORDER],
        "};",
        "",
        "export const ICON_NAMES = [",
        *[f"  {q(n)}," for n in NAMES],
        "] as const;",
        "export type IconName = (typeof ICON_NAMES)[number];",
        "",
        "export interface ThirdPartySet {",
        "  id: string;",
        "  title: string;",
        "  repo: string;",
        "  commit: string;",
        "  licence: string;",
        "  licenceFile: string;",
        '  uses: { pack: IconPack; part: "icons" | "files" }[];',
        "}",
        "",
        "export const THIRD_PARTY: ThirdPartySet[] = [",
    ]
    for t in third_party:
        uses = ", ".join(f"{{ pack: {q(u['pack'])}, part: {q(u['part'])} }}" for u in t["uses"])
        out += [
            "  {",
            f"    id: {q(t['id'])},",
            f"    title: {q(t['title'])},",
            f"    repo: {q(t['repo'])},",
            f"    commit: {q(t['commit'])},",
            f"    licence: {q(t['licence'])}, // german-ok: the licence's name",
            f"    licenceFile: {q(t['licenceFile'])},",
            f"    uses: [{uses}],",
            "  },",
        ]
    out += [
        "];",
        "",
        "/* Icons no set had, drawn for plxr in the style of the pack they sit in. */",
        "export const DRAWN_FOR_PLXR: { pack: IconPack; names: IconName[] }[] = [",
        *[f"  {{ pack: {q(pack)}, names: [{', '.join(q(n) for n in names)}] }}," for pack, names in drawn],
        "];",
        "",
    ]
    with open(TS_OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    main()
