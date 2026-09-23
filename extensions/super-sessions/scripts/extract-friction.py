#!/usr/bin/env python3
"""Friction audit, numeric pass: mechanical signals from session JSONL. No LLM.

Usage: extract-friction.py <session_jsonl_dir> [out_dir]
Writes: INDEX.tsv, REPEAT-SIGNATURES.tsv, RECURRING-ARTIFACTS.tsv,
        HANDED-PATH-WASTE.tsv, and per-session <session>.tsv / .users.md
Default out_dir: ./audit

Handed-path detection works per turn: a path or @file the human supplies is
checked against the tool calls that follow it, before the next human turn. A
search before any read is the F1 signature (waste); never reading it at all is
recorded separately (unused), because the agent may legitimately have asked a
question instead.
"""
import json, os, re, sys, glob, collections

PROGS = """ssh scp rsync git docker mysql mysqldump pnpm npm node python3 uv php drush curl gh sed awk grep rg find ls cat head tail tar make systemctl nginx certbot jq sqlite3 bash sh composer wp tee xargs printf""".split()
SUBCMD = {'ssh', 'docker', 'git', 'pnpm', 'gh', 'uv', 'npm', 'systemctl', 'mysql', 'php'}
SEARCH = re.compile(r'(^|[\s;&|(])(find|fd|rg|grep|ag|ack|locate|ls|tree)\b')
ARTIFACT = re.compile(r'[\w./-]+\.(?:php|sh|py|js|ts|md|css|sql|json|txt|tpl|inc)\b|(?<=FROM\s)\w+|(?<=UPDATE\s)\w+|(?<=INTO\s)\w+')
HANDED = re.compile(r'@([^\s,;)\]]+)|(?<![\w:/.-])((?:\./|~/|/)[\w./-]*\.[A-Za-z0-9]{1,6})')
# A handoff is a file reference, not a domain: @heavenletters.org is a host alias.
EXT_OK = re.compile(r'\.(php|sh|py|js|ts|jsx|tsx|md|css|sql|json|txt|tpl|inc|env|log|yml|yaml|'
                    r'toml|gz|conf|ini|html|xml|csv)$', re.I)


def load(fp):
    for line in open(fp, errors='replace'):
        try:
            yield json.loads(line)
        except Exception:
            pass


def text_of(blocks):
    if isinstance(blocks, str):
        return blocks
    return '\n'.join(b.get('text', '') for b in blocks or []
                     if isinstance(b, dict) and b.get('type') == 'text')


def signature(cmd):
    """Coarse program-chain signature: `ssh regen | docker exec | mysql`."""
    toks = [m.group(0) for m in re.finditer(r'[A-Za-z0-9_./:@-]+', cmd)]
    sig = []
    for i, t in enumerate(toks):
        base = os.path.basename(t)
        if base in PROGS:
            part = base
            if base in SUBCMD and i + 1 < len(toks):
                nxt = toks[i + 1]
                if not nxt.startswith('-') and len(nxt) < 30:
                    part += ' ' + os.path.basename(nxt)
            if part not in sig[-1:]:
                sig.append(part)
    return ' | '.join(sig[:5])[:80]


def handed_paths(text):
    """Paths the human supplied: @file refs and absolute/relative paths with an extension."""
    out = set()
    for m in HANDED.finditer(text):
        candidate = m.group(1) or m.group(2) or ''
        if not candidate or '://' in candidate or candidate.startswith('//'):
            continue
        if candidate.startswith('-'):  # CLI flags in pasted commands
            continue
        head = candidate.lstrip('@')
        if not (head.startswith(('./', '~/', '/')) or '/' in head or EXT_OK.search(head)):
            continue
        out.add(candidate)
    return sorted(out)


def name_tokens(tail):
    """Significant words in a filename: the glob `*without-italian*` names
    `hl-without-italian-100.txt` for our purposes."""
    stem = tail.rsplit('.', 1)[0]
    return [t for t in re.split(r'[-_. ]+', stem) if len(t) >= 3]


def matches_path(detail, tail):
    if tail in detail:
        return True
    toks = name_tokens(tail)
    if not toks:
        return False
    return sum(t in detail for t in toks) * 2 >= len(toks)


def is_search(tool, detail):
    if tool in ('find', 'grep', 'ls'):
        return True
    return tool == 'bash' and bool(SEARCH.search(detail))


def build_turns(fp):
    """Split a session into human turns, each with the tool calls that followed it."""
    turns = []
    for d in load(fp):
        if d.get('type') != 'message':
            continue
        m = d.get('message') or {}
        role = m.get('role')
        if role == 'user':
            turns.append({'text': text_of(m.get('content')), 'calls': []})
        elif role == 'assistant' and turns:
            for b in m.get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'toolCall':
                    a = b.get('arguments') or {}
                    detail = ' '.join(str(a.get('command') or a.get('path') or a.get('pattern')
                                         or a.get('query') or '').split())
                    turns[-1]['calls'].append((b.get('name', '?'), detail[:300]))
    return turns


def main():
    sdir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), 'audit')
    os.makedirs(out, exist_ok=True)
    rows, tool_hist = [], collections.Counter()
    sig_s, sig_c, art_s = collections.Counter(), collections.Counter(), collections.Counter()
    handed_sess = waste_sess = unused_sess = 0
    waste_examples = []
    waste_turns = unused_turns = 0

    for fp in sorted(glob.glob(os.path.join(sdir, '*.jsonl'))):
        sid = date = model = ''
        for d in load(fp):
            if d.get('type') == 'session':
                sid, date = d.get('id', ''), (d.get('timestamp') or '')[:10]
            elif d.get('type') == 'model_change':
                model = d.get('modelId', model)
        turns = build_turns(fp)
        errors = 0
        for d in load(fp):
            m = d.get('message') or {}
            if m.get('role') == 'toolResult' and m.get('isError'):
                errors += 1
        ev = [c for t in turns for c in t['calls']]
        if not ev and not turns:
            continue

        base = f"{date}_{sid[:8]}"
        sess_handed, sess_waste, sess_unused = [], [], []
        for ti, turn in enumerate(turns):
            paths = handed_paths(turn['text'])
            if not paths:
                continue
            sess_handed += paths
            for h in paths:
                tail = os.path.basename(h.rstrip('/'))
                if len(tail) < 4:
                    continue
                verdict = None
                for name, detail in turn['calls']:
                    if not matches_path(detail, tail):
                        continue
                    if name == 'read':
                        verdict = 'read'
                        break
                    if is_search(name, detail):
                        verdict = 'searched'
                        break
                if verdict == 'searched':
                    sess_waste.append((ti, h, tail))
                    waste_turns += 1
                    if len(waste_examples) < 60:
                        waste_examples.append((base, ti, h, tail))
                elif verdict is None:
                    sess_unused.append((ti, h))
                    unused_turns += 1

        if sess_handed:
            handed_sess += 1
        if sess_waste:
            waste_sess += 1
        if sess_unused:
            unused_sess += 1

        with open(os.path.join(out, base + '.tsv'), 'w') as f:
            f.write("i\ttool\tdetail\n")
            for i, (n, d) in enumerate(ev):
                f.write(f"{i}\t{n}\t{d}\n")
        if turns:
            open(os.path.join(out, base + '.users.md'), 'w').write(
                '\n---\n'.join(t['text'][:2500] for t in turns if t['text'].strip()))

        sess_sigs = collections.Counter()
        for n, det in ev:
            if n == 'bash' and det:
                k = signature(det)
                if k:
                    sess_sigs[k] += 1
            for a in ARTIFACT.findall(det):
                if len(a) > 3 and not a.startswith('/'):
                    art_s[a] += 1
        # session counts must be distinct sessions, not calls
        for k, c in sess_sigs.items():
            sig_s[k] += 1
            sig_c[k] += c

        rows.append((base, len([t for t in turns if t['text'].strip()]), len(ev), errors,
                     len(sess_handed), len(sess_waste), len(sess_unused), model))

    head = ("session\tuser_turns\ttool_calls\terrors\thanded_paths\t"
            "handed_searched\thanded_unused\tmodel\n")
    open(os.path.join(out, 'INDEX.tsv'), 'w').write(
        head + ''.join('\t'.join(map(str, r)) + '\n' for r in rows))
    open(os.path.join(out, 'REPEAT-SIGNATURES.tsv'), 'w').write(
        "signature\tsessions\tcalls\n" +
        ''.join(f"{k}\t{n}\t{sig_c[k]}\n" for k, n in sig_s.most_common(80) if n >= 2))
    open(os.path.join(out, 'RECURRING-ARTIFACTS.tsv'), 'w').write(
        "artifact\tcalls\n" + ''.join(f"{k}\t{n}\n" for k, n in art_s.most_common(80)))
    open(os.path.join(out, 'HANDED-PATH-WASTE.tsv'), 'w').write(
        "session\tturn\thanded\tbasename\n" +
        ''.join('\t'.join(map(str, r)) + '\n' for r in waste_examples))

    print(f"sessions={len(rows)} tool_calls={sum(tool_hist.values()) or sum(r[2] for r in rows)} "
          f"errors={sum(r[3] for r in rows)}")
    print(f"handed-path sessions={handed_sess}  searched-before-read: {waste_sess} sessions "
          f"({waste_turns} turns)  never-read: {unused_sess} sessions ({unused_turns} turns)")
    print(f"out: {out}")


if __name__ == "__main__":
    main()
