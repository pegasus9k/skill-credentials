"""Metadata documents of the simulated year.

Reads courses.json, graph.json, thirdPartyPosts.json and skillTypes.json.
Writes one JSON document per badge, node and post under ../metadata, and
index.json with the SHA-256 and the IPFS CID of each file. Every field comes
from the specification files, so the same inputs give the same bytes.

The replay puts the SHA-256 of each file on the ledger as its metadataCID.
In the full mode it also pins the file on IPFS, where the CID (CIDv1, raw
codec, sha2-256) holds that same digest.

Usage: python3 build_metadata.py
"""
import base64
import hashlib
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "..", "spec")
OUT = os.path.join(HERE, "..", "metadata")

ACADEMIC_YEAR = "2025/2026"
SEMESTER = {1: "1st semester", 2: "2nd semester"}
TIERS = ["Architect", "Specialist", "Fundamentals"]


def load(name):
    with open(os.path.join(SPEC, name), encoding="utf-8") as f:
        return json.load(f)


def skill_labels():
    """Code -> label, from skillTypes.json."""
    return {t["code"]: t["label"] for t in load("skillTypes.json")["skillTypes"]}


def season(n):
    return {"number": n, "academicYear": ACADEMIC_YEAR, "semester": SEMESTER[n]}


def skills(vector, labels):
    return [{"skillType": t, "label": labels[t], "points": p} for t, p in vector.items()]


def names(ids, graph):
    """[18, 20] -> 'Energy Optimization Specialist and Energy Infrastructure Specialist'"""
    words = [graph[i]["name"] for i in ids]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def node_description(node, graph):
    groups = node["prerequisiteGroups"]
    if not groups:
        return f"{node['tier']} node, with no prerequisites."
    if len(groups) == 1:
        return f"{node['tier']} node. Requires {names(groups[0], graph)}."
    common = [m for m in groups[0] if all(m in g for g in groups)]
    rest = [" and ".join(graph[m]["name"] for m in g if m not in common) for g in groups]
    either = " or ".join(rest)
    if common:
        return f"{node['tier']} node. Requires {names(common, graph)}, and {either}."
    return f"{node['tier']} node. Requires {either}."


def closures(checked, graph):
    """Every way to meet the prerequisite groups below the checked nodes:
    the set of nodes a holder then also holds. Minimal sets only, in the
    order of the groups."""
    found = []

    def expand(held, pending):
        if not pending:
            if held not in found:
                found.append(held)
            return
        n, rest = pending[0], pending[1:]
        groups = graph[n]["prerequisiteGroups"]
        if not groups:
            expand(held, rest)
            return
        for g in groups:
            expand(held | set(g), rest + [m for m in g if m not in held])

    expand(frozenset(checked), list(checked))
    return [s for s in found if not any(o < s for o in found)]


def path_nodes(checked, graph):
    """Nodes of a path by tier: the checked nodes, the nodes they always imply
    ('all'), and the nodes of each option ('oneOf', numbered)."""
    ways = closures(checked, graph)
    always = set.intersection(*map(set, ways)) - set(checked)
    options = [sorted(w - always - set(checked)) for w in ways]
    options = [o for o in options if o]
    entries = [(n, {"id": n, "name": graph[n]["name"], "required": "checked"}) for n in checked]
    entries += [(n, {"id": n, "name": graph[n]["name"], "required": "all"}) for n in sorted(always)]
    if len(options) == 1:
        entries += [(n, {"id": n, "name": graph[n]["name"], "required": "all"}) for n in options[0]]
        options = []
    for k, o in enumerate(options, start=1):
        entries += [(n, {"id": n, "name": graph[n]["name"], "required": "oneOf", "option": k}) for n in o]
    by_tier = {}
    for tier in TIERS:
        rows = [e for n, e in entries if graph[n]["tier"] == tier]
        if rows:
            by_tier[tier] = rows
    return by_tier, bool(options), bool(always or options)


def path_description(n_checked, has_options, implies):
    it = "it" if n_checked == 1 else "them"
    text = f"The path checks the node{'s' if n_checked > 1 else ''} marked 'checked'."
    if implies:
        text += f" Holding {it} implies every node marked 'all'"
        text += " and every node of one option." if has_options else "."
    return text


def project_description(max_teams):
    return ("A team forms when each slot is taken by a student who holds every node of that slot. "
            f"The third party selects at most {max_teams} team{'s' if max_teams > 1 else ''}.")


def dump(o, ind=0):
    """One skill entry, node or flat object per line, the rest indented."""
    sp = "  " * ind
    if o == [] or o == {}:
        return json.dumps(o)
    if isinstance(o, dict) and all(not isinstance(v, (dict, list)) for v in o.values()):
        return json.dumps(o, ensure_ascii=False)
    if isinstance(o, dict):
        body = ",\n".join(f"{sp}  {json.dumps(k)}: {dump(v, ind + 1)}" for k, v in o.items())
        return "{\n" + body + f"\n{sp}}}"
    if isinstance(o, list):
        body = ",\n".join(f"{sp}  {dump(v, ind + 1)}" for v in o)
        return "[\n" + body + f"\n{sp}]"
    return json.dumps(o, ensure_ascii=False)


def cid(digest):
    """CIDv1, raw codec, sha2-256, base32: the CID IPFS gives the same bytes."""
    return "b" + base64.b32encode(bytes([0x01, 0x55, 0x12, 0x20]) + digest).decode().lower().rstrip("=")


def main():
    courses = load("courses.json")["courses"]
    graph_file = load("graph.json")
    graph = {n["id"]: n for n in graph_file["nodes"]}
    posts = load("thirdPartyPosts.json")
    labels = skill_labels()

    docs = []  # (kind, id, relative path, document), in the order of definition on the ledger
    for c in courses:
        for b in c["badges"]:
            docs.append(("badge", b["id"], f"badges/{b['id']}.json", {
                "type": "badge",
                "specId": b["id"],
                "name": b["name"],
                "description": b["content"],
                "course": {"code": c["code"], "name": c["name"], "ects": c["ects"], "page": c["page"]},
                "assessment": b["assessment"],
                "season": season(c["season"]),
                "skillPoints": skills(b["skillPoints"], labels),
            }))
    for n in graph_file["nodes"]:
        docs.append(("node", n["id"], f"nodes/{n['id']:02d}.json", {
            "type": "node",
            "name": n["name"],
            "tier": n["tier"],
            "description": node_description(n, graph),
            "season": season(graph_file["definedInSeason"]),
            "prerequisiteGroups": [[{"id": m, "name": graph[m]["name"], "tier": graph[m]["tier"]} for m in g]
                                   for g in n["prerequisiteGroups"]],
            "threshold": skills(n["threshold"], labels),
            "versionOf": 0,
        }))
    for p in posts["paths"]:
        nodes, has_options, implies = path_nodes(p["nodes"], graph)
        docs.append(("path", p["id"], f"posts/path-{p['id']}.json", {
            "type": "path",
            "name": p["title"],
            "thirdParty": p["thirdParty"],
            "description": path_description(len(p["nodes"]), has_options, implies),
            "nodes": nodes,
        }))
    for p in posts["projects"]:
        docs.append(("project", p["id"], f"posts/project-{p['id']}.json", {
            "type": "project",
            "name": p["title"],
            "thirdParty": p["thirdParty"],
            "description": project_description(p["maxTeams"]),
            "maxTeams": p["maxTeams"],
            "slots": [{"slot": s["slot"], "role": s["role"],
                       "nodes": [{"id": m, "name": graph[m]["name"], "tier": graph[m]["tier"]} for m in s["nodes"]]}
                      for s in p["slots"]],
        }))

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    index = []
    for kind, key, rel, doc in docs:
        data = (dump(doc) + "\n").encode("utf-8")
        assert json.loads(data) == doc
        assert len(data) < 256 * 1024, f"{rel}: larger than one IPFS block"
        path = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        digest = hashlib.sha256(data).digest()
        index.append({"kind": kind, "id": key, "file": rel, "sha256": digest.hex(), "cid": cid(digest)})

    head = {"generator": "build_metadata.py", "academicYear": ACADEMIC_YEAR,
            "inputs": ["courses.json", "graph.json", "thirdPartyPosts.json", "skillTypes.json"]}
    text = "{\n" + "".join(f'  "{k}": {json.dumps(v)},\n' for k, v in head.items())
    text += '  "documents": [\n' + ",\n".join("    " + json.dumps(e) for e in index) + "\n  ]\n}\n"
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        f.write(text)
    counts = {k: sum(e["kind"] == k for e in index) for k in ("badge", "node", "path", "project")}
    print(f"{len(index)} documents written to {os.path.normpath(OUT)}: {counts}")


if __name__ == "__main__":
    main()
