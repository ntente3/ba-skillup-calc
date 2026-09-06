"""
Re-check the mismatched entries against a third source (bluearchive.wiki).

Why this is needed: schaledb and the workbook disagreed on 61 entries. Two
sources alone cannot settle which of them is right. bluearchive.wiki is a
community-maintained Miraheze wiki, and it is independent of schaledb.

Access rules:
  - robots.txt blocks `/w/` (the API) and allows `/wiki/` (articles) -> read only articles
  - licensed CC BY-SA 4.0
  - fetch only the student pages we need, with a delay between requests

The icon file names map directly onto schaledb's Icon field (only the casing
differs), so identifying a material needs no separate mapping table:
    Item_Icon_Material_Nimrud_0.png  <->  item_icon_material_nimrud_0  <->  item 130

Client data dumps such as Dimbreath/BlueArchiveData are not used — they have been
taken down over DMCA.
"""
import collections, html, json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(HERE, "..", "data", "game")
UA = "ba-skillup-calc/0.1 (personal calculator cross-check; low volume)"
WIKI = "https://bluearchive.wiki/wiki/"
DELAY = 1.5

sys.path.insert(0, HERE)
from student_ids import load as load_reg


def get(url, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read().decode("utf-8", "ignore")
    return data if raw else json.loads(data)


def opart_of(item_id):
    """Item ID -> (material index, grade). Oparts (100-399) only."""
    if not (100 <= item_id < 400):
        return None
    mi, g = divmod(item_id - 100, 10)
    return (mi, g) if g < 4 else None


# Normal, Passive and Sub all share the same material table (both 자료2 and
# schaledb have a single '일반' entry for them). The wiki presents it split into
# three tables, so exactly one of them must be read — adding all three up gives
# precisely triple the real cost.
# Cases where the wiki article title differs from schaledb's English name.
WIKI_NAME = {
    "Shiroko (Cycling)": "Shiroko (Riding)",
    "Toki (Bunny)": "Toki (Bunny Girl)",
    "Kotama (Camp)": "Kotama (Camping)",
}

SKILL_TABLE = {"EX Skill": "EX", "Normal Skill": "일반"}
SKILL_SKIP = ("Passive Skill", "Sub Skill")


def parse_page(page_html, icon_to_id):
    """Extract (skill, level) -> {(material, grade): quantity} from an article. The wiki lists these per level step."""
    out = collections.defaultdict(collections.Counter)
    for table in re.findall(r"<table[^>]*>.*?</table>", page_html, re.S):
        if "Item_Icon_Material_" not in table:
            continue
        # Strip the tags first, then look at the front of the result. Slicing the raw
        # HTML first would cut off nothing but attributes, and the table heading
        # ("EX Skill" and so on) would not land inside the window.
        #
        # Why the window is kept narrow: the unique-weapon table contains phrases
        # like "T2 Normal Skill changes to ...", so a wider window would pick that
        # table up as a skill table too. A skill table has its heading right at the
        # front, so only the head is examined.
        head = html.unescape(re.sub(r"<[^>]+>", " ", table)).strip()[:60]
        if any(k in head for k in SKILL_SKIP):
            continue
        skill = next((v for k, v in SKILL_TABLE.items() if k in head), None)
        if not skill:
            continue
        for row in re.findall(r"<tr>.*?</tr>", table, re.S):
            if "Item_Icon_Material_" not in row:
                continue
            # A row starts with <tr>, so find the first <td> and read the level from it.
            lv = re.match(r"\s*<tr>\s*<td>\s*(\d+)", row)
            if not lv:
                continue
            lv = int(lv.group(1))
            # Walk the quantities and the icons in document order and pair each quantity
            # with the icon that comes immediately after it. They must not be paired
            # in one go with a regex — the note icon is Item_Icon_SkillBook_*, so it
            # does not match the Material pattern, and the note quantity then gets
            # paired with the material after it by mistake (the note quantity 8 for
            # 코노카 ended up attached to 로마 12면체).
            toks = [(m.start(), "Q", m.group(1))
                    for m in re.finditer(r'item-quantity[^"]*">([\d,]+)</span>', row)]
            for m in re.finditer(r"<img\b[^>]*>", row):
                icon = re.search(r'src="[^"]*?(?:\d+px-)?([A-Za-z0-9_]+)\.png"', m.group(0))
                if icon:
                    toks.append((m.start(), "I", icon.group(1)))
            toks.sort()

            pending = None
            for _, kind, val in toks:
                if kind == "Q":
                    pending = val
                elif pending is not None:
                    iid = icon_to_id.get(val.lower())
                    key = opart_of(iid) if iid else None
                    if key:
                        out[(skill, lv)][key] += int(pending.replace(",", ""))
                    pending = None
    return out


def to_cumulative(per_step):
    """Per step -> cumulative. Accumulates in level order, separately for each skill."""
    cum = {}
    by_skill = collections.defaultdict(dict)
    for (skill, lv), d in per_step.items():
        by_skill[skill][lv] = d
    for skill, lvmap in by_skill.items():
        acc = collections.Counter()
        for lv in sorted(lvmap):
            acc.update(lvmap[lv])
            cum[(skill, lv)] = {k: v for k, v in acc.items() if v}
    return cum


def main():
    report_path = os.path.join(HERE, "..", "data", "crosscheck_opart.json")
    if not os.path.exists(report_path):
        raise SystemExit("Run scripts/crosscheck_opart.py first.")
    with open(report_path, encoding="utf-8") as f:
        report = json.load(f)

    items = get("https://schaledb.com/data/kr/items.min.json")
    items = list(items.values()) if isinstance(items, dict) else items
    icon_to_id = {str(i.get("Icon", "")).lower(): i["Id"] for i in items if i.get("Icon")}

    en = get("https://schaledb.com/data/en/students.min.json")
    en = list(en.values()) if isinstance(en, dict) else en
    id_to_en = {s["Id"]: s["Name"] for s in en}

    reg = load_reg()
    official = reg.get("officialId", {})
    with open(os.path.join(GAME, "skill_costs.json"), encoding="utf-8") as f:
        ours_rows = json.load(f)
    with open(os.path.join(GAME, "materials.json"), encoding="utf-8") as f:
        mats = json.load(f)["opart"]
    mine = collections.defaultdict(dict)
    for r in ours_rows:
        for mi, g, q in r["req"]:
            mine[(r["sid"], r["skill"], r["lv"])][(mi, g)] = q

    targets = sorted({(c["sid"], c["name"]) for c in report["conflicts"]})
    print(f"Re-checking {len(targets)} mismatched students against the wiki.\n")

    verdict = collections.Counter()
    details = []
    for sid, name in targets:
        en_name = id_to_en.get(official.get(str(sid)))
        if not en_name:
            print(f"  {name}: no English name found"); verdict["no english name"] += 1; continue
        page = WIKI_NAME.get(en_name, en_name).replace(" ", "_")
        try:
            body = get(WIKI + urllib.parse.quote(page), raw=True)
        except Exception as e:
            print(f"  {name} ({page}): page fetch failed {e}"); verdict["page fetch failed"] += 1; continue
        time.sleep(DELAY)
        cum = to_cumulative(parse_page(body, icon_to_id))
        if not cum:
            print(f"  {name} ({page}): no material table found"); verdict["parse failed"] += 1; continue

        for c in [x for x in report["conflicts"] if x["sid"] == sid]:
            key = (c["skill"], c["lv"])
            wiki = cum.get(key)
            if wiki is None:
                verdict["level absent from wiki"] += 1; continue
            for d in c["delta"]:
                mi = mats.index(d["material"]); g = d["grade"]
                w = wiki.get((mi, g), 0)
                if w == d["schaledb"] and w != d["workbook"]:
                    verdict["wiki=schaledb (workbook wrong)"] += 1
                elif w == d["workbook"] and w != d["schaledb"]:
                    verdict["wiki=workbook (schaledb wrong)"] += 1
                else:
                    verdict["all three differ"] += 1
                details.append({"sid": sid, "name": name, "skill": c["skill"], "lv": c["lv"],
                                "material": d["material"], "grade": g,
                                "workbook": d["workbook"], "schaledb": d["schaledb"], "wiki": w})

    print("\n=== verdict ===")
    for k, v in verdict.most_common():
        print(f"  {k:28} {v}")
    p = os.path.join(HERE, "..", "data", "crosscheck_wiki.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"verdict": dict(verdict), "details": details}, f, ensure_ascii=False, indent=1)
    print(f"\n-> {os.path.relpath(p)}")
    for d in details[:8]:
        print(f"  {d['name']} {d['skill']} Lv{d['lv']} {d['material']} g{d['grade']}: "
              f"workbook {d['workbook']} / schaledb {d['schaledb']} / wiki {d['wiki']}")


if __name__ == "__main__":
    import urllib.parse
    main()
