"""Generator of the simulated year.

Reads courses.json, archetypes.json, graph.json and thirdPartyPosts.json, and
writes simulatedYear.json: the students, every assessment they take or miss,
the transactions of the year in replay order, and the outcome expected for
each student. All the randomness of the simulation is here, from one seed.
The replay has none.

Students, per archetype of 20, in this order:
  1 reference        every assessment, grade 18, allocates in week 30
  6 regular          every assessment, drawn grades, allocates in weeks 15 and 30
  7 regular          every assessment, drawn grades, allocates in week 30
  3 skips            each assessment skipped with probability 0.25, allocates in week 30
  3 dropout          Season 1 only, allocates in week 15

Grades: one ability per drawn student from U[12.0, 15.5]. Each assessment
taken draws Normal(ability, 2.5), clamped to [0, 20] and rounded half up to a
whole number. A grade of 10 or above mints the badge. Every value is drawn
from its own key (seed, student, badge, purpose), so a skip or a dropout
changes no other draw.

Allocation: the allocation helper (allocate.py) on the badges the student
holds in that week and the target nodes of its archetype.

Week 30: paths and project defined and approved, allocations, applications,
team slots in student order, then TP3 selects the first team that formed.
Reference students take no part in the posts.

Usage: python3 generate_year.py
"""
import hashlib
import json
import math
import os
import platform
import random

import scipy

from allocate import allocate

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec")
OUT = os.path.join(SPEC, "simulatedYear.json")

SEED = 42
ABILITY = (12.0, 15.5)
SPREAD = 2.5
SKIP_PROBABILITY = 0.25
REFERENCE_GRADE = 18
MINT_GRADE = 10
FREEZE_WEEK = {1: 15, 2: 29}

# (class, students per archetype, allocation weeks)
CLASSES = [
    ("reference", 1, [30]),
    ("regular", 6, [15, 30]),
    ("regular", 7, [30]),
    ("skips", 3, [30]),
    ("dropout", 3, [15]),
]


def draw(*key):
    """A random generator for one value, keyed by the seed and the key."""
    return random.Random(":".join(str(k) for k in (SEED,) + key))


def half_up(x):
    return math.floor(x + 0.5)


def load(name):
    return json.load(open(os.path.join(SPEC, name), encoding="utf-8"))


def main():
    courses = load("courses.json")["courses"]
    archetypes = load("archetypes.json")
    graph = {n["id"]: n for n in load("graph.json")["nodes"]}
    posts = load("thirdPartyPosts.json")
    post_week = posts["week"]

    course_by_code = {c["code"]: c for c in courses}
    badge_by_id = {b["id"]: dict(b, course=c["code"], season=c["season"])
                   for c in courses for b in c["badges"]}
    badge_rank = {bid: i for i, bid in enumerate(badge_by_id)}

    # Students
    students = []
    for a in archetypes["archetypes"]:
        assert sum(n for _, n, _ in CLASSES) == archetypes["studentsPerArchetype"]
        for cls, n, weeks in CLASSES:
            for _ in range(n):
                sid = f"S{len(students) + 1:03d}"
                ability = None
                if cls != "reference":
                    ability = round(draw(sid, "ability").uniform(*ABILITY), 2)
                students.append({
                    "id": sid, "archetype": a["id"], "class": cls,
                    "allocationWeeks": weeks, "ability": ability,
                    "masterSalt": hashlib.sha256(f"{SEED}:{sid}:masterSalt".encode()).hexdigest(),
                })
    arch = {a["id"]: a for a in archetypes["archetypes"]}

    # Assessments and mints
    assessments, mints = [], []
    minted = {s["id"]: [] for s in students}
    for s in students:
        sid, a = s["id"], arch[s["archetype"]]
        for p in ("P1", "P2", "P3", "P4"):
            for code in a["courses"][p]:
                c = course_by_code[code]
                for b in c["badges"]:
                    bid = b["id"]
                    if s["class"] == "dropout" and c["season"] == 2:
                        status, grade = "dropped", None
                    elif s["class"] == "skips" and draw(sid, bid, "skip").random() < SKIP_PROBABILITY:
                        status, grade = "skipped", None
                    elif s["class"] == "reference":
                        status, grade = "taken", REFERENCE_GRADE
                    else:
                        g = draw(sid, bid, "grade").normalvariate(s["ability"], SPREAD)
                        status, grade = "taken", half_up(min(max(g, 0.0), 20.0))
                    assessments.append({"student": sid, "badge": bid, "week": b["week"],
                                        "status": status, "grade": grade})
                    if grade is not None and grade >= MINT_GRADE:
                        minted[sid].append(bid)
                        mints.append({"week": b["week"], "type": "mintBadge", "by": "oracle",
                                      "student": sid, "badge": bid, "grade": grade})
    mints.sort(key=lambda e: (e["week"], badge_rank[e["badge"]], e["student"]))

    # Allocations, in the order the helper sees the badges: period, course, badge
    allocations = {w: [] for w in (15, 30)}
    held = {s["id"]: {} for s in students}
    for s in students:
        sid, a = s["id"], arch[s["archetype"]]
        free = list(minted[sid])
        for w in s["allocationWeeks"]:
            pool = [badge_by_id[b] for b in free if badge_by_id[b]["week"] <= w]
            result = allocate(pool, a["targetNodes"], graph, held[sid])
            for node, used in result.items():
                allocations[w].append({"week": w, "type": "allocateBadges", "by": sid,
                                       "node": node, "badges": used})
                held[sid][node] = w
                free = [b for b in free if b not in used]

    # Week 30 posts
    post_events = []
    for p in posts["paths"]:
        post_events.append({"week": post_week, "type": "definePath", "by": p["thirdParty"],
                            "path": p["id"], "nodes": p["nodes"]})
    for p in posts["projects"]:
        post_events.append({"week": post_week, "type": "defineProject", "by": p["thirdParty"],
                            "project": p["id"], "maxTeams": p["maxTeams"],
                            "slots": [s["nodes"] for s in p["slots"]]})
    for p in posts["paths"]:
        post_events.append({"week": post_week, "type": "approvePath", "by": "admin", "path": p["id"]})
    for p in posts["projects"]:
        post_events.append({"week": post_week, "type": "approveProject", "by": "admin", "project": p["id"]})

    drawn = [s for s in students if s["class"] != "reference"]
    applications = {s["id"]: [] for s in students}
    apply_events = []
    for s in drawn:
        for p in posts["paths"]:
            if set(p["nodes"]) <= set(held[s["id"]]):
                applications[s["id"]].append(p["id"])
                apply_events.append({"week": post_week, "type": "applyToPath", "by": s["id"],
                                     "path": p["id"]})

    # Teams: each qualifying student takes its slot in the first team still
    # forming with that slot free, or starts a new team. Slots numbered 1 to 4.
    project = posts["projects"][0]
    teams, formed_order, team_events = [], [], []
    membership = {s["id"]: None for s in students}
    for s in drawn:
        for slot in project["slots"]:
            if not set(slot["nodes"]) <= set(held[s["id"]]):
                continue
            k = slot["slot"]
            team = next((t for t in teams if not t["formed"] and k not in t["members"]), None)
            if team is None:
                team = {"id": len(teams) + 1, "members": {}, "formed": False}
                teams.append(team)
                team_events.append({"week": post_week, "type": "startTeam", "by": s["id"],
                                    "project": project["id"], "team": team["id"], "slot": k})
            else:
                team_events.append({"week": post_week, "type": "joinTeam", "by": s["id"],
                                    "team": team["id"], "slot": k})
            team["members"][k] = s["id"]
            membership[s["id"]] = (team["id"], k)
            if len(team["members"]) == len(project["slots"]):
                team["formed"] = True
                formed_order.append(team["id"])
            break  # one team per project
    if formed_order:
        selected = formed_order[0]
        team_events.append({"week": post_week, "type": "selectTeam", "by": project["thirdParty"],
                            "team": selected})
    else:
        selected = None
        team_events.append({"week": post_week, "type": "endRecruitment", "by": project["thirdParty"],
                            "project": project["id"]})

    # Events in replay order
    events = []
    for w in range(1, post_week + 1):
        events += [e for e in mints if e["week"] == w]
        for season, fw in FREEZE_WEEK.items():
            if fw == w:
                events.append({"week": w, "type": "freezeSeason", "by": "admin", "season": season})
        if w == post_week:
            events += post_events
        events += allocations.get(w, [])
        if w == post_week:
            events += apply_events + team_events

    # Expected outcome per student
    team_of = {t["id"]: t for t in teams}
    expected = []
    for s in students:
        sid = s["id"]
        m = membership[sid]
        expected.append({
            "student": sid,
            "badges": minted[sid],
            "nodes": {str(n): w for n, w in held[sid].items()},
            "applications": applications[sid],
            "team": None if m is None else {"team": m[0], "slot": m[1],
                                            "formed": team_of[m[0]]["formed"],
                                            "selected": m[0] == selected},
        })

    meta = {
        "generator": "generate_year.py", "seed": SEED,
        "inputs": ["courses.json", "archetypes.json", "graph.json", "thirdPartyPosts.json"],
        "parameters": {"ability": list(ABILITY), "spread": SPREAD, "skipProbability": SKIP_PROBABILITY,
                       "referenceGrade": REFERENCE_GRADE, "mintGrade": MINT_GRADE,
                       "freezeWeek": {str(k): v for k, v in FREEZE_WEEK.items()},
                       "classes": [{"class": c, "perArchetype": n, "allocationWeeks": w} for c, n, w in CLASSES]},
        "versions": {"python": platform.python_version(), "scipy": scipy.__version__},
        "counts": {"students": len(students), "assessments": len(assessments), "events": len(events)},
    }

    # One object per line, so the file reads and diffs line by line
    def block(name, rows, last=False):
        body = ",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in rows)
        return f'  "{name}": [\n{body}\n  ]' + ("" if last else ",")

    text = "\n".join([
        "{",
        '  "meta": ' + json.dumps(meta) + ",",
        block("students", students),
        block("assessments", assessments),
        block("events", events),
        block("expected", expected, last=True),
        "}",
    ]) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {OUT}: {len(students)} students, {len(assessments)} assessments, {len(events)} events")
    print("SHA-256", hashlib.sha256(text.encode("utf-8")).hexdigest())


if __name__ == "__main__":
    main()
