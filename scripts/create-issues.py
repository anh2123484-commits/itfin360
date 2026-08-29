#!/usr/bin/env python3
"""Crea en GitHub las labels, milestones e issues del backlog de ITFin360.

Uso:
    GITHUB_TOKEN=... python3 scripts/create-issues.py <owner>/<repo> [--dry-run]

Es idempotente: una issue cuyo título ya existe (abierta o cerrada) no se vuelve a crear.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
ROOT = Path(__file__).resolve().parent.parent
BACKLOG = ROOT / "docs" / "backlog.json"

SIZE_LABEL = {"S": ("size/S", "c2e0c6"), "M": ("size/M", "fef2c0"), "L": ("size/L", "f9d0c4")}


def req(method: str, path: str, token: str, payload: dict | None = None) -> dict | list:
    url = path if path.startswith("http") else f"{API}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {token}")
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        body = resp.read().decode()
    return json.loads(body) if body else {}


def ensure_label(repo: str, token: str, name: str, color: str, desc: str, dry: bool) -> None:
    if dry:
        print(f"  [dry] label {name}")
        return
    try:
        req("POST", f"/repos/{repo}/labels", token,
            {"name": name, "color": color, "description": desc[:100]})
    except urllib.error.HTTPError as e:
        if e.code != 422:  # 422 = ya existe
            raise


def ensure_milestone(repo: str, token: str, title: str, dry: bool) -> int | None:
    if dry:
        print(f"  [dry] milestone {title}")
        return None
    existing = req("GET", f"/repos/{repo}/milestones?state=all&per_page=100", token)
    for m in existing:  # type: ignore[union-attr]
        if m["title"] == title:
            return m["number"]
    return req("POST", f"/repos/{repo}/milestones", token, {"title": title})["number"]  # type: ignore[index]


def existing_issue_titles(repo: str, token: str) -> dict[str, int]:
    out: dict[str, int] = {}
    page = 1
    while True:
        batch = req("GET", f"/repos/{repo}/issues?state=all&per_page=100&page={page}", token)
        if not batch:
            break
        for i in batch:  # type: ignore[union-attr]
            if "pull_request" not in i:
                out[i["title"]] = i["number"]
        page += 1
    return out


def topo_sort(tasks: list[dict]) -> list[dict]:
    by_id = {t["id"]: t for t in tasks}
    seen: set[str] = set()
    order: list[dict] = []

    def visit(tid: str, stack: tuple[str, ...] = ()) -> None:
        if tid in seen:
            return
        if tid in stack:
            raise SystemExit(f"Ciclo de dependencias: {' -> '.join(stack + (tid,))}")
        for dep in by_id[tid]["deps"]:
            visit(dep, stack + (tid,))
        seen.add(tid)
        order.append(by_id[tid])

    for t in tasks:
        visit(t["id"])
    return order


def build_body(task: dict, numbers: dict[str, int]) -> str:
    deps = ", ".join(f"#{numbers[d]} ({d})" if d in numbers else d for d in task["deps"]) or "ninguna"
    return f"""**Identificador de backlog:** `{task['id']}` · **Fase:** {task['phase']} · **Talla:** {task['size']}

## Qué hay que hacer
{task['description']}

## Criterios de aceptación
{task['acceptance']}

## Depende de
{deps}

## Antes de empezar
Lee `AGENTS.md` y, según la tarea, `docs/02-modelo-financiero.md` y `docs/03-arquitectura-y-datos.md`.
Recuerda las reglas duras: importes en céntimos enteros, `tenantId` + RLS en toda tabla,
consultas siempre dentro de `withTenant`, sin `any`, y nada de datos reales en fixtures.

## Antes de abrir la PR
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.
La PR debe incluir `Closes #<esta issue>` y la sección **Decisiones tomadas**.
"""


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    repo = sys.argv[1]
    dry = "--dry-run" in sys.argv
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token and not dry:
        print("Falta GITHUB_TOKEN", file=sys.stderr)
        return 1

    tasks = topo_sort(json.loads(BACKLOG.read_text(encoding="utf-8")))
    phases = sorted({t["phase"] for t in tasks})

    print(f"Repositorio: {repo} · {len(tasks)} issues{' (simulación)' if dry else ''}")

    for name, color in [("devin", "5319e7"), ("backlog", "0e8a16"), ("necesita-revision-humana", "b60205")]:
        ensure_label(repo, token, name, color, "ITFin360", dry)
    for label, color in SIZE_LABEL.values():
        ensure_label(repo, token, label, color, "Talla estimada", dry)

    milestones = {p: ensure_milestone(repo, token, p, dry) for p in phases}
    already = {} if dry else existing_issue_titles(repo, token)

    numbers: dict[str, int] = {}
    created = skipped = 0
    critical = {"F0-05", "F4-02", "F1-10", "F6-06"}

    for t in tasks:
        title = f"[{t['id']}] {t['title']}"
        if title in already:
            numbers[t["id"]] = already[title]
            skipped += 1
            continue
        labels = ["backlog", "devin", SIZE_LABEL[t["size"]][0]]
        if t["id"] in critical:
            labels.append("necesita-revision-humana")
        payload = {
            "title": title,
            "body": build_body(t, numbers),
            "labels": labels,
        }
        if milestones.get(t["phase"]):
            payload["milestone"] = milestones[t["phase"]]
        if dry:
            print(f"  [dry] issue {title}")
            created += 1
            continue
        issue = req("POST", f"/repos/{repo}/issues", token, payload)
        numbers[t["id"]] = issue["number"]  # type: ignore[index]
        created += 1
        print(f"  #{issue['number']:>3}  {title}")  # type: ignore[index]
        time.sleep(1.0)  # respeta el límite de creación de contenido de GitHub

    print(f"\nCreadas: {created} · Ya existían: {skipped}")
    if not dry:
        (ROOT / "docs" / "issue-map.json").write_text(
            json.dumps(numbers, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print("Mapa id→issue en docs/issue-map.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
