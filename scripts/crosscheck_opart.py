"""
Cross-check orb material requirements against an independent source.

Background: the parity run against the workbook confirms that the calculation *logic* is
right, but its sample is tied to one account's current state. That account is mostly maxed
out, which left only 144 non-zero orb cells — 1% of a 12,560-entry table.

schaledb.com is generated automatically from game data and is therefore an independent
source, and its item id scheme maps exactly onto our material array:

    item id = 100 + materialIndex*10 + grade      (100~103 Nebra Disc, 110~113 Phaistos…)

Two things differ, though:
  - schaledb is per level step, 자료2 is cumulative  -> accumulate the steps before comparing
  - schaledb also carries BD (3xxx) and notes (4xxx) -> keep only orbs (100~399)

This script does not fix the workbook. All it does is report the differences — which side
is right is a question to settle in the game.
"""
import collections, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(HERE, "..", "data", "game")
SRC = "https://schaledb.com/data/kr/students.min.json"
NAME_FIX = {"시로코 테러": "시로코*테러"}

sys.path.insert(0, HERE)
from student_ids import load as load_reg


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ba-skillup-calc/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def opart_only(ids, amts):
    """Orbs (100~399) only. BD and notes belong to 자료1, so they are not in 자료2."""
    out = collections.Counter()
    for i, a in zip(ids or [], amts or []):
        if 100 <= i < 400:
            mi, g = divmod(i - 100, 10)
            if g < 4:
                out[(mi, g)] += a
    return out


def main():
    raw = fetch(SRC)
    items = list(raw.values()) if isinstance(raw, dict) else raw
    by_name = {s["Name"]: s for s in items}

    with open(os.path.join(GAME, "skill_costs.json"), encoding="utf-8") as f:
        ours_rows = json.load(f)
    with open(os.path.join(GAME, "materials.json"), encoding="utf-8") as f:
        mats = json.load(f)["opart"]
    reg = load_reg()
    name_of = {v: k for k, v in reg["byName"].items()}

    mine = collections.defaultdict(dict)
    for r in ours_rows:
        for mi, g, q in r["req"]:
            mine[(r["sid"], r["skill"], r["lv"])][(mi, g)] = q

    agree = 0
    conflicts = []            # present on both sides, values differ
    missing_ours = []         # in schaledb, absent from the workbook
    no_source = []            # student not in schaledb at all

    for sid, name in sorted(name_of.items()):
        s = by_name.get(NAME_FIX.get(name, name))
        if not s:
            no_source.append(name)
            continue
        for skill, K, A in (("EX", "SkillExMaterial", "SkillExMaterialAmount"),
                            ("일반", "SkillMaterial", "SkillMaterialAmount")):
            if not s.get(K):
                continue
            acc = collections.Counter()
            for k, (ids, amts) in enumerate(zip(s[K], s[A])):
                acc.update(opart_only(ids, amts))
                lv = k + 2
                exp = {kk: v for kk, v in acc.items() if v}
                got = mine.get((sid, skill, lv))
                if got is None:
                    if exp:
                        missing_ours.append({"sid": sid, "name": name, "skill": skill, "lv": lv})
                    continue
                if got == exp:
                    agree += 1
                    continue
                delta = []
                for key in sorted(set(exp) | set(got)):
                    d = exp.get(key, 0) - got.get(key, 0)
                    if d:
                        delta.append({"material": mats[key[0]], "grade": key[1],
                                      "schaledb": exp.get(key, 0), "workbook": got.get(key, 0)})
                conflicts.append({"sid": sid, "name": name, "skill": skill, "lv": lv, "delta": delta})

    report = {"agree": agree, "conflicts": conflicts,
              "missingInWorkbook": missing_ours, "notInSchaledb": no_source}
    p = os.path.join(HERE, "..", "data", "crosscheck_opart.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    total = agree + len(conflicts)
    print(f"cross-check: agree {agree:,} / {total:,}  ({agree/total*100:.2f}%)")
    print(f"  differing values  {len(conflicts)}, across {len({c['name'] for c in conflicts})} students")
    print(f"  not in workbook   {len(missing_ours)}, across {len({m['name'] for m in missing_ours})} students")
    print(f"  not in schaledb   {len(no_source)} students {no_source[:5]}")

    if conflicts:
        by_student = collections.Counter(c["name"] for c in conflicts)
        print("\nStudents with differing values (count):")
        for n, k in by_student.most_common():
            print(f"    {n:16} {k}")
        print("\nExamples:")
        for c in conflicts[:3]:
            d = ", ".join(f"{x['material']} g{x['grade']}: schaledb {x['schaledb']} vs workbook {x['workbook']}"
                          for x in c["delta"])
            print(f"    {c['name']} {c['skill']} Lv{c['lv']} — {d}")
    if missing_ours:
        print("\nStudents missing from the workbook:", sorted({m["name"] for m in missing_ours}))
    print(f"\n-> {os.path.relpath(p)}")


if __name__ == "__main__":
    main()
