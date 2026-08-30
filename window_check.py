#!/usr/bin/env python3
"""Look at the photograph of the real window and say what is true.

Three things can only be answered here, and each of them cost an afternoon of
looking in the wrong place:

  - do the settings survive? The window's own storage keeps nothing, so every
    setting was back to default on the next start.
  - does the window let anything through? It was never able to, so see-through
    only made it lighter.
  - did anything go wrong that the interface itself noticed?

The picture is read rather than trusted: the colour that was written into the
settings has to be the colour on the screen.
"""
import json
import subprocess
import sys


def say(what, value):
    print(f'  {what:<42} {value}')


def bad(what):
    print(f'  FAILED: {what}')
    return 1


def pixels(path):
    """Every pixel of the screenshot, as (r, g, b).

    Shrunk first. The screen is 3840 by 2160 — a 33 megabyte bitmap. At 400
    across it is twenty thousand dots and sixteen milliseconds, and the answer
    is the same one: which colours are on the screen, not where.
    """
    small = path + '.small.bmp'
    if subprocess.run(['sips', '-Z', '400', '-s', 'format', 'bmp', path, '--out', small],
                      capture_output=True).returncode != 0:
        return []
    data = open(small, 'rb').read()
    start = int.from_bytes(data[10:14], 'little')
    width = int.from_bytes(data[18:22], 'little', signed=True)
    # Signed, and that is not a nicety: a bitmap stored top down carries a
    # NEGATIVE height, and read unsigned that is four billion rows. The loop
    # below then runs for a quarter of an hour before anybody wonders why.
    height = abs(int.from_bytes(data[22:26], 'little', signed=True))
    depth = int.from_bytes(data[28:30], 'little') // 8
    if depth < 3 or not width or not height:
        return []
    row = (width * depth + 3) // 4 * 4
    out = []
    for y in range(height):
        base = start + y * row
        for x in range(width):
            i = base + x * depth
            if i + 2 < len(data):
                out.append((data[i + 2], data[i + 1], data[i]))
    return out


def main():
    work = sys.argv[1]
    failed = 0

    # 1. Were the settings kept at all? Only the file — whether they were also
    #    READ is answered by the colour on the screen below, and that is the
    #    better question anyway.
    try:
        prefs = json.load(open(work + '/home/prefs.json'))
    except Exception as e:
        return bad(f'the settings file is gone: {e}')
    if 'plxr.style.crt' not in prefs:
        failed = bad('the settings were not kept')
    else:
        say('settings on disk', 'kept')

    # 2. The colour on the screen. #7fd4ff was written into the settings and
    #    exists nowhere else — if it is on screen, the window read it.
    dots = pixels(work + '/solid.png')
    if not dots:
        return bad('the screenshot cannot be read')

    def hue_of(dot):
        r, g, b = (v / 255 for v in dot)
        mx, mn = max(r, g, b), min(r, g, b)
        if mx - mn < 0.08 or mx < 0.12:
            return None      # grey or near black: carries no hue worth counting
        d = mx - mn
        if mx == r:
            h = ((g - b) / d) % 6
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        return (h * 60) % 360

    def around(target, span=35):
        n = 0
        for dot in dots:
            h = hue_of(dot)
            if h is None:
                continue
            gap = abs(h - target)
            if min(gap, 360 - gap) <= span:
                n += 1
        return n

    """Counted by hue, not by exact value.

    Text is drawn with antialiasing: the strokes are blends of the colour and
    the ground behind them, and hardly a pixel carries the value that was set.
    An exact comparison found nine of them and called the run failed while the
    window was plainly blue. The hue survives the blending — that is what makes
    it the thing to measure."""
    blue = around(200)      # #7fd4ff, the colour written into the settings
    amber = around(40)      # #ffb000, the default that must NOT be showing
    say('pixels in the chosen hue', str(blue))
    say('pixels in the default hue', str(amber))
    if blue < 200:
        failed = bad(f'the chosen colour is barely on the screen ({blue}) — the settings were not applied')
    if amber > blue:
        failed = bad('the default colour outweighs the chosen one')

    # 3. Did the window itself notice anything? The workbench raises a flag in
    # the corner on the first error, and that flag is one specific red.
    flag = 0
    for dot in dots:
        r, g, b = dot
        if abs(r - 0xb6) < 22 and abs(g - 0x41) < 22 and abs(b - 0x3a) < 22:
            flag += 1
    say('pixels in the workbench red', str(flag))
    if flag > 200:
        failed = bad('the workbench flag is up — something went wrong in the window')

    # 4. Does the window really let light through?
    #
    # Not by eye and not by colour: the same window, once opaque and once
    # see-through, in the same place with the same things behind it. If it lets
    # anything past, the two pictures differ. If it only got lighter — which is
    # what it did before, and what was complained about — they barely do.
    glass = pixels(work + '/glass.png')
    if not glass or len(glass) != len(dots):
        failed = bad('the two pictures cannot be compared')
    else:
        changed = sum(1 for a, b in zip(dots, glass)
                      if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 30)
        share = changed * 100 // len(dots)
        say('picture changed by see-through', f'{share}%')
        if share < 10:
            failed = bad('see-through changes almost nothing — the window is not letting light past')

    return failed


if __name__ == '__main__':
    sys.exit(main())
