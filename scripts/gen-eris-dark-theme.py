"""Generate dark-mode overrides for hard-coded light colours in the dashboard CSS."""
import re, sys, colorsys

def parse_color(tok):
    tok = tok.strip().lower()
    if tok == "white": return (255, 255, 255, 1)
    m = re.fullmatch(r"#([0-9a-f]{3,8})", tok)
    if m:
        h = m.group(1)
        if len(h) in (3, 4): h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return (r, g, b, a)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", tok)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        r, g, b = (float(p) for p in parts[:3]); a = float(parts[3]) if len(parts) > 3 else 1
        return (r, g, b, a)
    return None

def lum(c): r, g, b, _ = c; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
COLOR = r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b"

def blocks(css):
    """Yield (media, selector, body) for flat rules, one level of @media."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    i, n = 0, len(css)
    def rules(text, media):
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
            yield media, m.group(1).strip(), m.group(2)
    while i < n:
        at = css.find("@media", i)
        if at == -1:
            yield from rules(css[i:], None); break
        yield from rules(css[i:at], None)
        open_ = css.find("{", at); depth, j = 1, open_ + 1
        while depth and j < n:
            depth += css[j] == "{"; depth -= css[j] == "}"; j += 1
        yield from rules(css[open_ + 1:j - 1], css[at:open_].strip())
        i = j

def scope(sel):
    out = []
    for s in sel.split(","):
        s = s.strip()
        if not s or s.startswith(("@", "from", "to")) or re.fullmatch(r"[\d.]+%", s): return None
        if s in (":root", "html", "*"): return None
        if s.startswith("body"): out.append(".app-shell" + s[4:] if s != "body" else ".app-shell"); continue
        out.append(f".app-shell {s}")
    return ", ".join(out)

out = {}
fonts = {}
for path in sys.argv[1:]:
    for media, sel, body in blocks(open(path).read()):
        if "keyframes" in (media or "") : continue
        sc = scope(sel)
        if not sc: continue
        # Fills that carry meaning (meters, bars, chart dots, switches) keep their colour.
        keep_colour = bool(re.search(r"meter i|bar-pair|legend|weight-dot|weight-line|goal-meter|switch|\.ring(?![-\w])|hero-card|tab-", sel)) or sel.strip() == "body"
        decls = []
        for d in body.split(";"):
            if ":" not in d: continue
            prop, val = (x.strip() for x in d.split(":", 1))
            imp = " !important" if "!important" in val else ""
            cols = [parse_color(c) for c in re.findall(COLOR, val)]
            cols = [c for c in cols if c]
            if not cols or keep_colour: continue
            light = any(lum(c) > 0.82 and c[3] > 0.3 for c in cols)
            dark = any(lum(c) < 0.32 and c[3] > 0.5 for c in cols)
            if prop in ("background", "background-color", "background-image") and light and "gradient" not in val.replace("linear-gradient(", "") or (prop in ("background", "background-color") and light):
                tint = "var(--e-panel-2)" if all(lum(c) < 0.985 for c in cols if lum(c) > 0.82) else "var(--e-panel)"
                decls.append(f"background:{tint}{imp}")
            elif prop == "color" and dark:
                decls.append(f"color:var(--ink){imp}")
            elif prop.startswith("border") and light and "color" in prop or (prop.startswith("border") and light and re.search(r"\bsolid|dashed\b", val)):
                decls.append(f"border-color:var(--line){imp}")
            elif prop == "box-shadow" and light:
                decls.append(f"box-shadow:none{imp}")
        for d in body.split(";"):
            if ":" in d and d.split(":",1)[0].strip() == "font-family" and "Georgia" in d:
                fonts.setdefault((media, sc), True)
        if decls:
            key = (media, sc)
            out.setdefault(key, [])
            out[key] += [d for d in decls if d not in out[key]]

lines = []
for (media, sc), decls in out.items():
    rule = f"{sc}{{{';'.join(decls)}}}"
    lines.append((media, rule))
print("/* Serif headings → the chat page's sans, in both modes. */")
for media in [None] + sorted({m for m, _ in fonts if m}):
    rules = [f"{sc}{{font-family:inherit;letter-spacing:-.2px}}" for (m, sc) in fonts if m == media]
    if not rules: continue
    if media: print(f"{media}{{"); [print("  " + r) for r in rules]; print("}")
    else: [print(r) for r in rules]
print("/* Generated from globals.css + mobile.css by gen_theme.py: hard-coded light colours → Eris dark tokens. */")
print("@media (prefers-color-scheme:dark){")
for media, rule in lines:
    if media is None: print("  " + rule)
for media in sorted({m for m, _ in lines if m}):
    print(f"  {media}{{")
    for m, rule in lines:
        if m == media: print("    " + rule)
    print("  }")
print("}")
