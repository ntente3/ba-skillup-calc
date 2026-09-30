"""
Add students the shipped data does not have yet, from schaledb.

Writes: data/student_ids.json, data/game/{students,skill_costs,schools}.json and
skill_costs_override.json. Run scripts/fetch_tags.py afterwards.

Run: python scripts/add_students.py [--dry-run]
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
GAME = os.path.join(DATA, "game")
sys.path.insert(0, HERE)
from student_ids import load as load_reg, save as save_reg, register, resolve, verify
from fetch_overrides import get, rows_for, EQUIP_KO, SCHOOL_KO, NAME_FIX

SRC = "https://schaledb.com/data/kr/students.min.json"
OUR_NAME = {v: k for k, v in NAME_FIX.items()}


def load(name, where=GAME):
    with open(os.path.join(where, name), encoding="utf-8") as f:
        return json.load(f)


def dump(name, obj, where=GAME):
    p = os.path.join(where, name)
    with open(p, "w", encoding="utf-8") as f:
        if name.endswith("_override.json"):
            json.dump(obj, f, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(p)


def main(dry):
    roster = load("students.json")
    costs = load("skill_costs.json")
    schools = load("schools.json")
    mats = load("materials.json")["opart"]
    gear_types = load("gear.json")["types"]
    override = load("skill_costs_override.json")
    reg = load_reg()

    have = {s["name"] for s in roster}
    items = get(SRC)
    items = list(items.values()) if isinstance(items, dict) else items

    new = []
    for s in items:
        name = OUR_NAME.get(s["Name"], s["Name"])
        if name in have:
            continue
        rows = rows_for(s)
        if not rows:
            print(f"  skipped {name}: no skill material data yet")
            continue
        bad = sorted({mi for r in rows for mi, _, _ in r["req"] if mi >= len(mats)})
        if bad:
            raise SystemExit(
                f"{name} needs artifact index {bad}, but materials.json has {len(mats)}.\n"
                "  -> a new artifact type: update materials.json and run extract_icons.py first."
            )
        gear = [EQUIP_KO.get(e, e) for e in (s.get("Equipment") or [])]
        stray = [g for g in gear if g not in gear_types]
        if stray:
            raise SystemExit(f"{name} has gear type {stray}, which gear.json does not list.\n"
                             "  -> add it to EQUIP_KO in fetch_overrides.py, or to the gear master.")
        new.append((name, s, rows, gear))

    new.sort(key=lambda x: x[1].get("DefaultOrder") or 0)
    if not new:
        print(f"nothing to add — {len(roster)} students, all of schaledb's {len(items)} known")
        return

    print(f"{len(new)} students to add (schaledb has {len(items)}, we have {len(roster)}):")
    for name, s, rows, _g in new:
        rel = s.get("IsReleased") or []
        where = "JP only" if rel[:2] == [True, False] else "released"
        print(f"  {name:16} {SCHOOL_KO.get(s['School'], s['School']):8} {s.get('StarGrade')}★  "
              f"{len(rows):2} rows  order {s.get('DefaultOrder')}  {where}")

    added_sids = register(reg, [n for n, _, _, _ in new])
    errs = verify(reg)
    if errs:
        raise SystemExit("Registry error: " + "; ".join(errs))

    fresh_schools = []
    for name, s, rows, gear in new:
        sid = resolve(reg, name)
        school = SCHOOL_KO.get(s["School"], s["School"])
        roster.append({"name": name, "star": s.get("StarGrade"), "gear": gear,
                       "sid": sid, "school": school, "schoolSrc": "schaledb"})
        for r in rows:
            costs.append({"skill": r["skill"], "lv": r["lv"], "req": r["req"], "sid": sid})
        override["students"][str(sid)] = {
            "name": name, "reason": "missing", "confirmedBy": None,
            "star": s.get("StarGrade"), "gear": gear, "school": school, "rows": rows,
        }
        if school not in schools:
            schools.insert(schools.index("콜라보") if "콜라보" in schools else len(schools), school)
            fresh_schools.append(school)

    override["fetchedAt"] = time.strftime("%Y-%m-%d")
    if dry:
        print("\n--dry-run: nothing written")
        return

    save_reg(reg)
    sizes = {
        "students.json": dump("students.json", roster),
        "skill_costs.json": dump("skill_costs.json", costs),
        "schools.json": dump("schools.json", schools),
        "skill_costs_override.json": dump("skill_costs_override.json", override),
    }
    print(f"\nsids assigned: {added_sids}")
    if fresh_schools:
        print(f"new school(s): {fresh_schools} -> schools.json now {schools}")
    for k, v in sizes.items():
        print(f"  {k:28} {v:>9,} B")
    print(f"  {'data/student_ids.json':28} {os.path.getsize(os.path.join(DATA, 'student_ids.json')):>9,} B")
    print("\nNow run: python scripts/fetch_tags.py   (attribute tags for the new sids)")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
