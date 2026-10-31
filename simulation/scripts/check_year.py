"""Dry run of the simulated year: checks simulatedYear.json against the
contract rules and the decisions of the generation, then prints a summary.

It reads the file, not the generator, and replays every event with the
checks the contracts make: a badge mints once, an allocation uses badges the
student holds and has not allocated, meets every threshold amount and holds
one prerequisite group; an application or a team slot needs every node it
asks for. It then compares the outcome with the "expected" block.

Usage: python3 check_year.py
"""
import json
import os
from collections import Counter, defaultdict

from allocate import allocate

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec")


def load(name):
    return json.load(open(os.path.join(SPEC, name), encoding="utf-8"))


def main():
    year = load("simulatedYear.json")
    courses = load("courses.json")["courses"]
    graph = {n["id"]: n for n in load("graph.json")["nodes"]}
    arch = {a["id"]: a for a in load("archetypes.json")["archetypes"]}
    posts = load("thirdPartyPosts.json")
    badge = {b["id"]: dict(b, season=c["season"]) for c in courses for b in c["badges"]}
    course_badges = {c["code"]: [b["id"] for b in c["badges"]] for c in courses}
    errors = []

    def check(ok, msg):
        if not ok:
            errors.append(msg)

    students = {s["id"]: s for s in year["students"]}
    order = [s["id"] for s in year["students"]]

    # 1. Cohort
    per = Counter((s["archetype"], s["class"], tuple(s["allocationWeeks"])) for s in year["students"])
    for a in arch:
        check(per[(a, "reference", (30,))] == 1 and per[(a, "regular", (15, 30))] == 6
              and per[(a, "regular", (30,))] == 7 and per[(a, "skips", (30,))] == 3
              and per[(a, "dropout", (15,))] == 3, f"{a}: class counts {per}")

    # 2. Assessments: one per student and badge of its nine courses
    by_student = defaultdict(list)
    for r in year["assessments"]:
        by_student[r["student"]].append(r)
    for sid, s in students.items():
        a = arch[s["archetype"]]
        want = [b for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p] for b in course_badges[c]]
        got = [r["badge"] for r in by_student[sid]]
        check(got == want, f"{sid}: assessments {len(got)} != {len(want)}")
        for r in by_student[sid]:
            b = badge[r["badge"]]
            check(r["week"] == b["week"], f"{sid} {r['badge']}: week")
            if s["class"] == "reference":
                check(r["status"] == "taken" and r["grade"] == 18, f"{sid}: reference grade")
            if s["class"] in ("reference", "regular"):
                check(r["status"] == "taken", f"{sid}: regular not taken")
            if s["class"] == "dropout":
                check((r["status"] == "dropped") == (b["season"] == 2), f"{sid}: dropout status")
            if r["status"] == "taken":
                check(isinstance(r["grade"], int) and 0 <= r["grade"] <= 20, f"{sid}: grade {r['grade']}")
            else:
                check(r["grade"] is None, f"{sid}: grade on a missed assessment")

    # 3. Replay the events with the contract checks
    holds_badge = defaultdict(dict)    # student -> badge -> week minted
    committed = defaultdict(dict)      # student -> badge -> node
    holds_node = defaultdict(dict)     # student -> node -> week
    frozen, path_status, project_status = set(), {}, {}
    applied, teams, team_of, selected = set(), {}, {}, None
    last_week = 0
    passed = {(r["student"], r["badge"]): r for r in year["assessments"]
              if r["grade"] is not None and r["grade"] >= 10}
    mint_seen = set()
    for e in year["events"]:
        w, t = e["week"], e["type"]
        check(w >= last_week, f"week goes back at {e}")
        last_week = w
        if t == "mintBadge":
            key = (e["student"], e["badge"])
            check(key in passed and passed[key]["grade"] == e["grade"], f"mint without a pass {e}")
            check(w == badge[e["badge"]]["week"], f"mint week {e}")
            check(e["badge"] not in holds_badge[e["student"]], f"double mint {e}")
            holds_badge[e["student"]][e["badge"]] = w
            mint_seen.add(key)
        elif t == "freezeSeason":
            frozen.add(e["season"])
        elif t == "allocateBadges":
            sid, n = e["by"], e["node"]
            node = graph[n]
            check(n not in holds_node[sid], f"node already held {e}")
            check(w in students[sid]["allocationWeeks"], f"allocation outside the student's weeks {e}")
            check(n in arch[students[sid]["archetype"]]["targetNodes"], f"not a target node {e}")
            for b in e["badges"]:
                check(b in holds_badge[sid], f"badge not held {e}")
                check(b not in committed[sid], f"badge already allocated {e}")
                committed[sid][b] = n
            for typ, need in node["threshold"].items():
                total = sum(badge[b]["skillPoints"].get(typ, 0) for b in e["badges"])
                check(total >= need, f"threshold {typ} {total} < {need} {e}")
            groups = node["prerequisiteGroups"]
            check(not groups or any(all(m in holds_node[sid] for m in g) for g in groups),
                  f"prerequisites not held {e}")
            holds_node[sid][n] = w
        elif t == "definePath":
            path_status[e["path"]] = "pending"
        elif t == "defineProject":
            project_status[e["project"]] = "pending"
        elif t == "approvePath":
            check(path_status.get(e["path"]) == "pending", f"approve {e}")
            path_status[e["path"]] = "open"
        elif t == "approveProject":
            check(project_status.get(e["project"]) == "pending", f"approve {e}")
            project_status[e["project"]] = "open"
        elif t == "applyToPath":
            p = next(p for p in posts["paths"] if p["id"] == e["path"])
            check(path_status[e["path"]] == "open", f"path not open {e}")
            check(all(n in holds_node[e["by"]] for n in p["nodes"]), f"applies without the nodes {e}")
            check((e["path"], e["by"]) not in applied, f"applies twice {e}")
            applied.add((e["path"], e["by"]))
        elif t in ("startTeam", "joinTeam"):
            proj = posts["projects"][0]
            check(project_status[proj["id"]] == "open", f"project not open {e}")
            slot = next(s for s in proj["slots"] if s["slot"] == e["slot"])
            check(all(n in holds_node[e["by"]] for n in slot["nodes"]), f"slot without the nodes {e}")
            check(e["by"] not in team_of, f"second team {e}")
            if t == "startTeam":
                check(e["team"] not in teams, f"team id reused {e}")
                teams[e["team"]] = {}
            else:
                check(e["team"] in teams and len(teams[e["team"]]) < 4, f"join a formed team {e}")
            check(e["slot"] not in teams[e["team"]], f"slot taken {e}")
            teams[e["team"]][e["slot"]] = e["by"]
            team_of[e["by"]] = e["team"]
        elif t == "selectTeam":
            check(len(teams.get(e["team"], {})) == 4, f"selects a team not formed {e}")
            selected = e["team"]
            project_status[1] = "started"
        elif t == "endRecruitment":
            project_status[1] = "closed"
        else:
            errors.append(f"unknown event {t}")
    check(mint_seen == set(passed), "a passed assessment without its mint")
    check(frozen == {1, 2}, "both seasons frozen")

    # 4. Expected block matches the replay
    for x in year["expected"]:
        sid = x["student"]
        check(sorted(x["badges"]) == sorted(holds_badge[sid]), f"{sid}: expected badges")
        check({int(k): v for k, v in x["nodes"].items()} == holds_node[sid], f"{sid}: expected nodes")
        check(sorted(x["applications"]) == sorted(p for p, s in applied if s == sid), f"{sid}: applications")
        tm = team_of.get(sid)
        check((x["team"] is None) == (tm is None), f"{sid}: team")

    # 5. Reference students repeat the completion check of 5.1.5
    for sid, s in students.items():
        if s["class"] != "reference":
            continue
        a = arch[s["archetype"]]
        pool = [badge[b] for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p] for b in course_badges[c]]
        want = allocate(pool, a["targetNodes"], graph)
        got = {e["node"]: e["badges"] for e in year["events"]
               if e["type"] == "allocateBadges" and e["by"] == sid}
        check(got == want, f"{sid}: reference allocation differs from the completion check")
        check(set(got) == set(a["targetNodes"]), f"{sid}: reference misses a target node")

    print("CHECKS:", "all passed" if not errors else f"{len(errors)} failed")
    for m in errors[:30]:
        print("  -", m)

    # Summary
    print(f"\nevents by type: {dict(Counter(e['type'] for e in year['events']))}")
    drawn_taken = [r for r in year["assessments"] if r["status"] == "taken"
                   and students[r["student"]]["class"] != "reference"]
    fails = sum(1 for r in drawn_taken if r["grade"] < 10)
    st = Counter(r["status"] for r in year["assessments"])
    print(f"assessments: {dict(st)}; drawn and taken {len(drawn_taken)}, failed {fails} "
          f"({100 * fails / len(drawn_taken):.1f}%)")
    sk = [r for r in year["assessments"] if students[r["student"]]["class"] == "skips"]
    print(f"skips class: {sum(r['status'] == 'skipped' for r in sk)} of {len(sk)} skipped "
          f"({100 * sum(r['status'] == 'skipped' for r in sk) / len(sk):.1f}%)")

    label = lambda s: s["class"] if s["class"] != "regular" else (
        "regular-early" if s["allocationWeeks"] == [15, 30] else "regular-end")
    print("\nper archetype and class: students | mean points minted of 540 | "
          "all targets | Architect held | target nodes unlocked (count: students)")
    for a in arch:
        tgt = arch[a]["targetNodes"]
        architect = [n for n in tgt if graph[n]["tier"] == "Architect"][0]
        for lab in ("reference", "regular-early", "regular-end", "skips", "dropout"):
            group = [s for s in year["students"] if s["archetype"] == a and label(s) == lab]
            pts = [sum(badge[b]["points"] for b in holds_badge[s["id"]]) for s in group]
            nn = Counter(len(holds_node[s["id"]]) for s in group)
            full = sum(1 for s in group if set(holds_node[s["id"]]) == set(tgt))
            arc = sum(1 for s in group if architect in holds_node[s["id"]])
            print(f"  {a} {lab:14s} {len(group):2d} | {sum(pts) / len(group):5.1f} | {full:2d} | {arc:2d} | "
                  f"{dict(sorted(nn.items()))} of {len(tgt)}")

    print("\nweek 15 nodes held by dropouts and early regulars:")
    for a in arch:
        for lab in ("regular-early", "dropout"):
            group = [s for s in year["students"] if s["archetype"] == a and label(s) == lab]
            c = Counter(tuple(sorted(n for n, w in holds_node[s["id"]].items() if w == 15)) for s in group)
            print(f"  {a} {lab:14s} {dict(c)}")

    print("\npath applications:")
    for p in posts["paths"]:
        who = Counter((students[s]["archetype"], label(students[s])) for pid, s in applied if pid == p["id"])
        print(f"  path {p['id']} (node {p['nodes']}): {sum(who.values())} students {dict(sorted(who.items()))}")
    for p in posts["paths"]:
        holders = [s for s in order if all(n in holds_node[s] for n in p["nodes"])]
        print(f"  path {p['id']}: held by {len(holders)} students incl. reference "
              f"{sum(students[s]['class'] == 'reference' for s in holders)}")

    proj = posts["projects"][0]
    print("\nteams:")
    for k in (1, 2, 3, 4):
        slot = next(s for s in proj["slots"] if s["slot"] == k)
        q = [s for s in order if students[s]["class"] != "reference"
             and all(n in holds_node[s] for n in slot["nodes"])]
        print(f"  slot {k} {slot['nodes']}: {len(q)} qualifying "
              f"{dict(Counter((students[s]['archetype'], label(students[s])) for s in q))}")
    formed = [t for t, m in teams.items() if len(m) == 4]
    print(f"  started {len(teams)}, formed {len(formed)}, incomplete {len(teams) - len(formed)}, selected {selected}")
    above = {1: 24, 2: 22, 3: 21, 4: 23}
    for t in formed:
        row = []
        for k in (1, 2, 3, 4):
            s = teams[t][k]
            row.append(f"slot {k} {s} {label(students[s])}, Architect {above[k]} "
                       f"{'yes' if above[k] in holds_node[s] else 'no'}")
        print(f"  team {t}: " + "; ".join(row))


if __name__ == "__main__":
    main()
