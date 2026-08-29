#!/usr/bin/env python3
"""Convierte docs/04-backlog.md en backlog.json (una entrada por tarea/issue)."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "04-backlog.md"
OUT = ROOT / "docs" / "backlog.json"

TASK_RE = re.compile(
    r"^\*\*(?P<id>F\d-\d\d) · (?P<title>.+?)\*\* · (?P<size>[SML]) · Dep: (?P<deps>.+)$"
)
PHASE_RE = re.compile(r"^## (?P<phase>Fase \d+ · .+)$")


def main() -> int:
    lines = SRC.read_text(encoding="utf-8").splitlines()
    tasks, phase, current = [], None, None

    for line in lines:
        if m := PHASE_RE.match(line):
            phase = m.group("phase")
            continue
        if m := TASK_RE.match(line.strip()):
            deps_raw = m.group("deps").strip()
            deps = [] if deps_raw in {"—", "-"} else [
                d.strip() for d in deps_raw.split(",") if d.strip()
            ]
            current = {
                "id": m.group("id"),
                "title": m.group("title").strip(),
                "phase": phase,
                "size": m.group("size"),
                "deps": deps,
                "description": "",
                "acceptance": "",
            }
            tasks.append(current)
            continue
        if current is None:
            continue
        stripped = line.strip()
        if stripped.startswith("*Aceptación:*"):
            current["acceptance"] = stripped.removeprefix("*Aceptación:*").strip()
            current = None
        elif stripped and not stripped.startswith(("|", "---", "**", "#")):
            current["description"] = (current["description"] + " " + stripped).strip()

    if not tasks:
        print("No se ha parseado ninguna tarea; revisa el formato de 04-backlog.md", file=sys.stderr)
        return 1

    missing = [t["id"] for t in tasks if not t["acceptance"]]
    if missing:
        print(f"Tareas sin criterio de aceptación: {missing}", file=sys.stderr)
        return 1

    ids = {t["id"] for t in tasks}
    bad = {t["id"]: [d for d in t["deps"] if d not in ids] for t in tasks}
    bad = {k: v for k, v in bad.items() if v}
    if bad:
        print(f"Dependencias que no existen: {bad}", file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(tasks)} tareas escritas en {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
