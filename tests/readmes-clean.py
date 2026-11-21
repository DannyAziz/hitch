"""Check actual README files; Claude's plugin test sandbox cannot read disk.

Run from the package root: python3 tests/readmes-clean.py
Uses only the Python standard library and writes no files.
"""
from pathlib import Path
import re

PLACEHOLDER = re.compile(r"(?:T-)?00000000-0000-4000-8000-\d{12}\Z")
IDENTIFIER = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|\bT-[A-Za-z0-9_-]+", re.I)
PRIVATE = re.compile(r"/(?:Users|home|private)/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)


def violations(text):
    text = text.replace(r"\/", "/")
    text = re.sub(r"\\u([0-9a-f]{4})", lambda m: chr(int(m[1], 16)), text, flags=re.I)
    return PRIVATE.findall(text) + [m[0] for m in IDENTIFIER.finditer(text) if not PLACEHOLDER.fullmatch(m[0])]


def main():
    root = Path(__file__).resolve().parent.parent
    readmes = sorted(p for p in root.rglob('*') if p.is_file() and re.fullmatch(r'readme(?:\..*)?', p.name, re.I))
    failures = []
    for path in readmes:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            for hit in violations(line):
                failures.append(f'{path.relative_to(root)}:{number}: forbidden private value {hit!r}')
    if failures:
        raise SystemExit('\n'.join(failures))
    if not readmes:
        raise SystemExit('No README files found')
    print(f'{len(readmes)} README files checked: 0 privacy violations')


if __name__ == '__main__':
    main()
