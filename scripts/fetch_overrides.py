"""
Turn the opart requirements of cross-checked students into overrides.

Background: the workbook and schaledb disagreed on 61 entries, and re-checking
them against a third source (bluearchive.wiki, CC BY-SA) came out as **wiki =
schaledb on all 130 entries, with 0 counterexamples**. The errors are on the
workbook's side, from data entry.

We do not edit the workbook itself. The workbook remains the source of truth and
only the confirmed students are overridden here — a single file records what was
taken from where, and it can be reverted at any time.

Covers:
  - students whose values disagreed (only where the wiki confirmed it)
  - students missing from the workbook entirely (new ones)

Level 10: schaledb's SkillMaterial only goes up to 8 steps (levels 2-9). Level 10
of the normal skill does not require any more oparts, so the level 9 cumulative
total is carried over as is — the workbook has the same shape.
"""
import collections, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(HERE, "..", "data", "game")
sys.path.insert(0, HERE)
from student_ids import load as load_reg

NAME_FIX = {"시로코 테러": "시로코*테러"}

# Students who have no bluearchive.wiki article, so the automatic comparison cannot
# cover them, and whom a human has verified against another source instead. The
# supporting evidence is recorded with them so it stays clear later why they were added.
MANUAL_CONFIRMED = {
    "에이미(무장)": ("cross-checked against the namu.wiki skill material table - 11/11 agree; "
                 "only the workbook differs, ether g1=18 (correct: 16)"),
}
UA = "ba-skillup-calc/0.1"

# A student who is missing from the workbook has no student record at all, so the
# equipment slots and the school are stored along with the requirements.
EQUIP_KO = {"Hat": "모자", "Gloves": "장갑", "Shoes": "신발", "Bag": "가방",
            "Badge": "배지", "Hairpin": "헤어핀", "Charm": "부적",
            "Watch": "시계", "Necklace": "목걸이"}
SCHOOL_KO = {"Hyakkiyako": "백귀야행", "RedWinter": "붉은겨울", "Trinity": "트리니티",
             "Gehenna": "게헨나", "Abydos": "아비도스", "Millennium": "밀레니엄",
             "Arius": "아리우스", "Shanhaijing": "산해경", "Valkyrie": "발키리",
             "Highlander": "하이랜더", "WildHunt": "와일드헌트",
             "SRT": "콜라보", "Tokiwadai": "콜라보", "Sakugawa": "콜라보",
             "Odyssey": "콜라보", "ETC": "콜라보"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def opart(ids, amts):
    out = collections.Counter()
    for i, a in zip(ids or [], amts or []):
        if 100 <= i < 400:
            mi, g = divmod(i - 100, 10)
            if g < 4:
                out[(mi, g)] += a
    return out


def rows_for(s):
    """A schaledb student -> a list of cumulative rows in our own format."""
    rows = []
    for skill, K, A, maxlv in (("EX", "SkillExMaterial", "SkillExMaterialAmount", 5),
                               ("일반", "SkillMaterial", "SkillMaterialAmount", 10)):
        if not s.get(K):
            continue
        acc = collections.Counter()
        last = None
        for k, (ids, amts) in enumerate(zip(s[K], s[A])):
            acc.update(opart(ids, amts))
            lv = k + 2
            last = {kk: v for kk, v in acc.items() if v}
            if last:
                rows.append({"skill": skill, "lv": lv,
                             "req": [[mi, g, q] for (mi, g), q in sorted(last.items())]})
        # Level 10 of the "일반" skill consumes no further oparts — carry the level 9
        # cumulative total over.
        if skill == "일반" and last and rows and rows[-1]["lv"] == maxlv - 1:
            rows.append({"skill": skill, "lv": maxlv,
                         "req": [[mi, g, q] for (mi, g), q in sorted(last.items())]})
    return rows


def main():
    cc = os.path.join(HERE, "..", "data", "crosscheck_opart.json")
    wk = os.path.join(HERE, "..", "data", "crosscheck_wiki.json")
    if not (os.path.exists(cc) and os.path.exists(wk)):
        raise SystemExit("Run crosscheck_opart.py and crosscheck_wiki.py first.")
    conflicts = json.load(open(cc, encoding="utf-8"))
    wiki = json.load(open(wk, encoding="utf-8"))

    # Only trust the entries where the wiki came down on schaledb's side.
    confirmed = {d["sid"] for d in wiki["details"]
                 if d["wiki"] == d["schaledb"] and d["wiki"] != d["workbook"]}
    contested = {d["sid"] for d in wiki["details"] if d["wiki"] == d["workbook"]}
    confirmed -= contested
    missing = {m["sid"] for m in conflicts["missingInWorkbook"]}

    reg_early = load_reg()
    sid_by_name = reg_early["byName"]
    manual = {sid_by_name[n] for n in MANUAL_CONFIRMED if n in sid_by_name}
    confirmed |= manual

    raw = get("https://schaledb.com/data/kr/students.min.json")
    items = list(raw.values()) if isinstance(raw, dict) else raw
    by_name = {s["Name"]: s for s in items}
    reg = load_reg()
    name_of = {v: k for k, v in reg["byName"].items()}

    out, skipped = {}, []
    for sid in sorted(confirmed | missing):
        name = name_of.get(sid)
        s = by_name.get(NAME_FIX.get(name, name))
        if not s:
            skipped.append(name); continue
        rows = rows_for(s)
        if rows:
            out[str(sid)] = {
                "name": name,
                "reason": ("manual" if name in MANUAL_CONFIRMED
                           else "conflict" if sid in confirmed else "missing"),
                "confirmedBy": MANUAL_CONFIRMED.get(name),
                "star": s.get("StarGrade"),
                "gear": [EQUIP_KO.get(e, e) for e in (s.get("Equipment") or [])],
                "school": SCHOOL_KO.get(s.get("School"), s.get("School")),
                "rows": rows,
            }

    # Merge with the existing overrides. This file must not be rebuilt from the
    # report every time: once an override fills a gap, the next cross-check reports
    # that there is no gap, which means the next generation leaves that student out
    # and the gap comes back. It is a self-erasing feedback loop. An entry that has
    # been confirmed once stays until a human removes it.
    prev_path = os.path.join(GAME, "skill_costs_override.json")
    if os.path.exists(prev_path):
        with open(prev_path, encoding="utf-8") as f:
            prev = json.load(f).get("students", {})
        readded = [v["name"] for k, v in prev.items() if k not in out]
        for k, v in prev.items():
            out.setdefault(k, v)
        if readded:
            print(f"  kept {len(readded)} existing overrides: {sorted(readded)}")

    doc = {
        "source": "schaledb.com/data/kr/students.min.json",
        "verifiedWith": "bluearchive.wiki (CC BY-SA 4.0)",
        "fetchedAt": time.strftime("%Y-%m-%d"),
        "note": ("Only students whose workbook value was contradicted and then confirmed "
                 "by a third source, plus students absent from the workbook entirely."),
        "students": out,
    }
    p = os.path.join(GAME, "skill_costs_override.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    n_conf = sum(1 for v in out.values() if v["reason"] == "conflict")
    n_miss = sum(1 for v in out.values() if v["reason"] == "missing")
    n_man = sum(1 for v in out.values() if v["reason"] == "manual")
    print(f"overrides for {len(out)} students (values corrected {n_conf}, newly added {n_miss}, manually confirmed {n_man})")
    for v in out.values():
        if v["reason"] == "manual":
            print(f"    [manual] {v['name']}: {v['confirmedBy']}")
    print(f"  corrected: {sorted(v['name'] for v in out.values() if v['reason']=='conflict')}")
    print(f"  added: {sorted(v['name'] for v in out.values() if v['reason']=='missing')}")
    if skipped:
        print(f"  skipped: {skipped}")
    print(f"-> {os.path.relpath(p)} ({os.path.getsize(p):,} B)")


if __name__ == "__main__":
    main()
