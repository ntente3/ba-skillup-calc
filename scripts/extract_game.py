"""
Extract game data from the distributed workbook and export it as normalized JSON.

The source 자료2 is a 4,545-row × 88-column wide matrix, yet only 3.4% of its cells
actually hold a value. The remaining 91.1% are empty cells with nothing but formatting
attached, and that is what the 8.3MB of sheet XML really is.
Flattened into long form, the same information comes down to 12,560 rows.

Output (data/game/):
  students.json    student master — sid, name, school, ★, 3 gear slots
  materials.json   material master — 20 O-Parts × 4 grades, BD/note grades, 9 gear types
  skill_costs.json skill level-up materials — (sid, skill, Lv) -> [[material idx, qty], …]
  cumulative.json  자료1 cumulative tables — BD/note/credit/★/character level
  gear.json        자료_장비 — gear requirements and credits per tier
  collab.json      자료_콜라보 — materials per event (already long form)
"""
import collections, json, os, sys
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "game")
sys.path.insert(0, HERE)
from student_ids import load as load_reg, save as save_reg, register, resolve, verify

SKILL_TYPES = ["EX", "노멀", "패시브", "서브"]


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def extract_materials(ws2):
    """자료2 row 1: material names sit every 4 columns; each material has 4 grades."""
    mats, col_map = [], {}
    last = ws2.max_column
    for c in range(8, last + 1):
        name = ws2.cell(1, c).value
        if name:
            mats.append(name)
        if mats:
            idx = len(mats) - 1
            grade = (c - 8) % 4
            col_map[c] = (idx, grade)
    return mats, col_map


def extract_students_and_costs(ws2, reg):
    """Flatten 자료2 into long form. The student master comes out of it too (★, gear slots)."""
    mats, col_map = extract_materials(ws2)
    students, costs, order = {}, [], []
    for row in ws2.iter_rows(min_row=3, values_only=True):
        name = row[0]
        if not name:
            continue
        if name not in students:
            order.append(name)
            students[name] = {
                "name": name,
                "star": _num(row[1]),
                "gear": [g for g in (row[2], row[3], row[4]) if g],
            }
        skill, lv = row[5], _num(row[6])
        if skill is None or lv is None:
            continue
        entries = []
        for c, (mi, grade) in col_map.items():
            v = _num(row[c - 1]) if c - 1 < len(row) else None
            if v:
                entries.append([mi, grade, int(v)])
        if entries:
            costs.append({"name": name, "skill": skill, "lv": int(lv), "req": entries})

    costs = repair_cumulative(costs)
    costs, order = apply_overrides(costs, order, students)
    register(reg, order)
    for name, s in students.items():
        s["sid"] = resolve(reg, name)
    for c in costs:
        c["sid"] = resolve(reg, c.pop("name"))
    return mats, students, order, costs


def apply_overrides(costs, order, students=None):
    """Overlay the cross-checked corrections and additions.

    Every case where the workbook and schaledb disagreed was re-checked against a third
    source (bluearchive.wiki): in all 130 cases the wiki sided with schaledb, with zero
    counterexamples. They are data-entry errors in the workbook.

    The workbook itself is not edited — the original is left as it is and this layer
    covers only the students that were verified. What was taken from where is recorded
    in a single file (skill_costs_override.json), which makes it easy to revert. Every
    application is printed.
    """
    path = os.path.join(OUT, "skill_costs_override.json")
    if not os.path.exists(path):
        return costs, order
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)

    by_sid_name = {v["name"]: (sid, v) for sid, v in doc["students"].items()}
    replaced = collections.Counter()
    kept = []
    for c in costs:
        if c["name"] in by_sid_name:
            replaced[c["name"]] += 1
            continue
        kept.append(c)

    added = 0
    for name, (sid, v) in sorted(by_sid_name.items()):
        for r in v["rows"]:
            kept.append({"name": name, "skill": r["skill"], "lv": r["lv"], "req": r["req"]})
            added += 1
        if name not in order:
            order.append(name)
        # For a student absent from the workbook, the override supplies the student record too.
        if students is not None and name not in students:
            students[name] = {"name": name, "star": v.get("star"), "gear": v.get("gear") or []}

    print(f"Overrides applied: {len(by_sid_name)} students "
          f"({sum(replaced.values())} workbook rows replaced -> {added} rows), "
          f"source {doc['source']}")
    for name, (sid, v) in sorted(by_sid_name.items(), key=lambda x: x[1][1]["reason"]):
        print(f"    [{v['reason']:8}] {name}")
    return kept, order


def repair_cumulative(costs):
    """Restore the values that were not carried over in the cumulative table.

    자료2 is cumulative, so no material's value can go down as the level rises. Yet in
    some rows a value is missing outright — e.g. for 미요 일반 Lv10 the 아틀란티스 메달
    carried over but 네브라 디스크 alone is absent. That is plainly an omission.

    Leaving it as is makes the calculator **under-report the requirement**. The
    requirement for a span is a subtraction (target cumulative - current cumulative),
    so it comes out negative, and a negative is clamped to 0 and therefore looks like
    'not needed'. It is the kind of bug that produces a wrong value without any error.

    That a cumulative table cannot decrease is a property of the data structure itself,
    so carrying the previous level's value forward is the only consistent repair. No
    external source has to be trusted for it. An independent source (schaledb) points
    at the same values as well.

    The repair is not done quietly — everything that was fixed is printed.
    """
    by = {}
    for c in costs:
        by.setdefault((c["name"], c["skill"]), []).append(c)

    repairs = []
    for key, rows in by.items():
        rows.sort(key=lambda r: r["lv"])
        carried = {}
        for r in rows:
            cur = {(mi, g): q for mi, g, q in r["req"]}
            for slot, prev in carried.items():
                if cur.get(slot, 0) < prev:
                    repairs.append((key[0], key[1], r["lv"], slot, cur.get(slot, 0), prev))
                    cur[slot] = prev
            r["req"] = [[mi, g, q] for (mi, g), q in sorted(cur.items())]
            carried = cur

    if repairs:
        print(f"Cumulative repairs: {len(repairs)} (previous level's value carried forward):")
        for name, skill, lv, (mi, g), was, now in repairs:
            print(f"    {name} {skill} Lv{lv}  material {mi} grade {g}: {was} -> {now}")
    return costs


def extract_cumulative(ws1):
    """자료1 — these are all cumulative tables. A value is the total up to level n, so the
    requirement for a span is obtained by subtraction.
    """
    def col_table(key_col, val_cols, r0, r1):
        out = {}
        for r in range(r0, r1 + 1):
            k = _num(ws1.cell(r, key_col).value)
            if k is None:
                continue
            vals = [int(_num(ws1.cell(r, c).value) or 0) for c in val_cols]
            out[int(k)] = vals
        return out

    return {
        # EX Lv -> cumulative BD required [초, 중, 상, 최상]
        "bd": col_table(2, [3, 4, 5, 6], 6, 11),
        # Skill Lv -> cumulative notes required [초, 중, 상, 최상, 비전]
        "note": col_table(8, [9, 10, 11, 12, 13], 6, 16),
        # EX Lv -> cumulative credits
        "creditEx": {k: v[0] for k, v in col_table(15, [16], 6, 11).items()},
        # Skill Lv -> cumulative credits
        "creditSkill": {k: v[0] for k, v in col_table(17, [18], 6, 16).items()},
        # ★ Lv -> cumulative credits
        "creditStar": {k: v[0] for k, v in col_table(15, [16], 21, 30).items()},
        # Character Lv -> cumulative credits [character, unique weapon]
        "creditLevel": col_table(20, [21, 22], 6, 96),
    }


def extract_gear_types(wseq):
    """Read the 9 gear types, in order, from the band labels on the gear sheet.

    B1 `모자,장갑,신발` / B4 `가방,배지,헤어핀` / B7 `부적,시계,목걸이`.
    The 0-8 in the inventory key eq.<type 0-8>.<tier> follows this order.
    """
    types = []
    for r in (1, 4, 7):
        label = wseq.cell(r, 2).value
        if isinstance(label, str):
            types += [t.strip() for t in label.split(",") if t.strip()]
    return types


def extract_gear(wse):
    """자료_장비 — cumulative requirements per tier Lv 0..10 and gear tier 2..10."""
    tiers, credit = {}, {}
    for r in range(6, 17):
        lv = _num(wse.cell(r, 1).value)
        if lv is None:
            continue
        lv = int(lv)
        tiers[lv] = [int(_num(wse.cell(r, c).value) or 0) for c in range(2, 11)]
        credit[lv] = {
            "cum": int(_num(wse.cell(r, 11).value) or 0),
            "levelUp": int(_num(wse.cell(r, 12).value) or 0),
            "tierUp": int(_num(wse.cell(r, 13).value) or 0),
        }
    return {"tierLabels": list(range(2, 11)), "req": tiers, "credit": credit}


# School code in a collab ITEM_CODE -> our school name (short name is canonical)
COLLAB_SCHOOL = {
    "HYAKKIYAKO": "백귀야행", "REDWINTER": "붉은겨울", "TRINITY": "트리니티",
    "GEHENNA": "게헨나", "ABYDOS": "아비도스", "MILLENNIUM": "밀레니엄",
    "ARIUS": "아리우스", "SHANHAIJING": "산해경", "VALKYRIE": "발키리",
    "HIGHLANDER": "하이랜더", "WILDHUNT": "와일드헌트",
}


def resolve_collab_item(code):
    """Resolve a collab ITEM_CODE into the coordinates of an existing material.

    A collab does not use new materials; it asks for existing ones in a different
    combination. A regular student only uses the BD/notes of their own school, whereas
    a collab student takes a little from several schools — which is why the school is
    part of the coordinate.

      BD_<school>_T<0-3>    -> ("bd",   school, grade)
      NOTE_<school>_T<0-3>  -> ("note", school, grade)
      SECRET_NOTE           -> ("note", None, 4)   비전. Not tracked per school.
      CREDIT                -> ("credit", None, None)
    """
    if code == "CREDIT":
        return ("credit", None, None)
    if code == "SECRET_NOTE":
        return ("note", None, 4)
    parts = code.split("_")
    if len(parts) == 3 and parts[0] in ("BD", "NOTE") and parts[2].startswith("T"):
        school = COLLAB_SCHOOL.get(parts[1])
        if school is None:
            return None
        return (parts[0].lower(), school, int(parts[2][1:]))
    return None


def extract_collab(wsc, reg):
    """자료_콜라보 — the source is already long form. Header on row 4, data from row 5 on."""
    rows = []
    for r in range(5, wsc.max_row + 1):
        code = wsc.cell(r, 1).value
        if not code:
            continue
        name = wsc.cell(r, 2).value
        qty = _num(wsc.cell(r, 7).value)
        item = wsc.cell(r, 6).value
        target = resolve_collab_item(item) if item else None
        rows.append({
            "event": code,
            "sid": resolve(reg, name),
            "name": name,
            "skill": wsc.cell(r, 3).value,
            "fromLv": _num(wsc.cell(r, 4).value),
            "toLv": _num(wsc.cell(r, 5).value),
            "item": item,
            "kind": target[0] if target else None,
            "school": target[1] if target else None,
            "grade": target[2] if target else None,
            "qty": int(qty) if qty else 0,
        })
    unresolved = sorted({r["item"] for r in rows if r["kind"] is None})
    if unresolved:
        raise SystemExit(
            "Could not resolve these collab ITEM_CODEs to an existing material: "
            + ", ".join(unresolved)
            + "\n  -> add a rule to resolve_collab_item / COLLAB_SCHOOL."
        )
    return rows


def extract_schools(wss):
    out = {}
    for r in range(2, wss.max_row + 1):
        n, s = wss.cell(r, 1).value, wss.cell(r, 2).value
        if n and s:
            out[n] = canon_school(s)
    return out


def canon_school(label):
    """The canonical form of a school name — keep only the first word.

    Inside the sheet a school is called by two different names. The block header uses
    the formal name (`<붉은겨울 연방학원>`), while the holdings table at the top uses the
    short name (`붉은겨울`). Leave both as they are and the inventory key (short name)
    drifts away from the aggregation key (formal name), so 9 of the 12 schools have
    their holdings read as 0 with no error at all — the stock is there, but it shows up
    as a shortfall. So the short name is taken as canonical and both are folded onto it.
    """
    return str(label).strip().split(" ")[0]


def extract_school_order(wsbd):
    """The order school blocks appear in on the calculation sheet — the in-game order.

    The student order in 자료2 is not by school, so without this order the UI cannot
    group students by school.
    """
    order = []
    for r in range(14, 371):
        b = wsbd.cell(r, 2).value
        if isinstance(b, str) and b.startswith("<") and b.endswith(">"):
            name = canon_school(b[1:-1])
            if name not in order:
                order.append(name)
    return order


def extract_schools_from_calc(wsbd):
    """Read student->school out of the school blocks on the calculation sheet.

    This is a more authoritative source than the 학생_학교 sheet — it is the split the
    calculator actually aggregates by, and it is the place that gets updated first when
    a new student is added.
    A block starts with a header such as `<백귀야행 연합학원>`, and a row that has column A
    (the "owned" checkbox) is a student.
    """
    out, current = {}, None
    for r in range(14, 371):
        b = wsbd.cell(r, 2).value
        if isinstance(b, str) and b.startswith("<") and b.endswith(">"):
            current = canon_school(b[1:-1])
            continue
        if wsbd.cell(r, 1).value is not None and isinstance(b, str) and b:
            if current:
                out[b] = current
    return out


def resolve_school(name, schools, collab_schools):
    """The 학생_학교 sheet does not carry skin variants or collab characters.

    A skin variant (`코유키(파자마)`) follows the school of the original student — strip the
    parentheses and look it up again.
    A collab character (미쿠, 미사카 …) has no original, so the SCHOOL_CODE from 자료_콜라보
    is used instead.
    """
    if name in schools:
        return schools[name], "direct"
    base = name.split("(")[0].strip()
    if base != name and base in schools:
        return schools[base], "variant"
    if name in collab_schools:
        return collab_schools[name], "collab"
    return None, "unresolved"


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(p)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: extract_game.py <release.xlsx>")
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=False)
    reg = load_reg()

    print("자료2 …", flush=True)
    mats, students, order, costs = extract_students_and_costs(wb["자료2"], reg)
    print(f"  {len(mats)} materials, {len(costs)} requirement rows", flush=True)
    print("Other sheets …", flush=True)
    school_order = extract_school_order(wb["1. BD·노트·크레딧 계산"])
    schools = extract_schools_from_calc(wb["1. BD·노트·크레딧 계산"])
    for n, sc in extract_schools(wb["학생_학교"]).items():
        schools.setdefault(n, sc)   # fall back to 학생_학교 if not on the calculation sheet
    cum = extract_cumulative(wb["자료1"])
    gear = extract_gear(wb["자료_장비"])
    gear["types"] = extract_gear_types(wb["3. 장비 계산"])
    collab = extract_collab(wb["자료_콜라보"], reg)
    wb.close()

    errs = verify(reg)
    if errs:
        raise SystemExit("Registry error: " + "; ".join(errs))
    save_reg(reg)

    collab_schools = {}
    for row in collab:
        if row["name"] and row.get("event"):
            collab_schools.setdefault(row["name"], "콜라보")

    roster = []
    src_count = {}
    for n in order:
        school, src = resolve_school(n, schools, collab_schools)
        src_count[src] = src_count.get(src, 0) + 1
        roster.append({**students[n], "school": school, "schoolSrc": src})
    sizes = {
        "students.json":    write("students.json", roster),
        "schools.json":     write("schools.json", school_order),
        "materials.json":   write("materials.json", {"opart": mats, "grades": 4,
                                          "bdGrades": ["기초", "일반", "상급", "최상"],
                                          "noteGrades": ["기초", "일반", "상급", "최상", "비전"]}),
        "skill_costs.json": write("skill_costs.json", costs),
        "cumulative.json":  write("cumulative.json", cum),
        "gear.json":        write("gear.json", gear),
        "collab.json":      write("collab.json", collab),
    }

    print(f"{len(roster)} students / {len(mats)} materials"
          f" / {len(costs)} skill requirement rows / {len(collab)} collab rows")
    print("School source:", ", ".join(f"{k} {v}" for k, v in sorted(src_count.items())))
    unresolved = [s["name"] for s in roster if not s["school"]]
    if unresolved:
        print(f"  {len(unresolved)} unresolved: {unresolved}")
    total = 0
    for k, v in sizes.items():
        print(f"  {k:20} {v:>9,} B")
        total += v
    print(f"  {'Total':20} {total:>9,} B")
