"""
Fetch student attribute tags and attach them to our sid.

The distributed workbook has nothing but the school and the ★ rating. Using the
in-game filters (attack type, defense type, weapon, position, role) needs those
attributes, but all four wikis we looked into either block bots or have put their
API behind a paywall (ADR 0004). schaledb.com's repository has been archived, but
its data endpoints are still alive and it uses the Korean names verbatim — 269 of
our 270 registry entries match on the name alone.

The only thing we take from it is the attribute tags. The requirement data stays
as it is, with the workbook as its source of truth — there is no reason to
replace 12,560 verified values with an external source.

Note: this script needs network access. The cloud container's egress proxy blocks
schaledb.com, so it has to be run from the user's device shell (device_bash).
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(HERE, "..", "data", "game")
SRC = "https://schaledb.com/data/kr/students.min.json"

sys.path.insert(0, HERE)
from student_ids import load as load_reg, save as save_reg, resolve

# Cases where the workbook and schaledb spell a name differently. Just one so far.
NAME_FIX = {"시로코 테러": "시로코*테러"}

# schaledb's English enums -> the Korean shown on screen. There are only a handful
# of values and they are fixed game terms, so the table is hard-coded here.
LABELS = {
    "bullet":   {"Explosion": "폭발", "Pierce": "관통", "Mystic": "신비", "Sonic": "진동"},
    "armor":    {"LightArmor": "경장갑", "HeavyArmor": "중장갑", "CompositeArmor": "특수장갑",
                 "ElasticArmor": "탄력장갑", "Unarmed": "없음"},
    "position": {"Front": "전방", "Middle": "중앙", "Back": "후방"},
    "squad":    {"Main": "스트라이커", "Support": "스페셜"},
    "role":     {"DamageDealer": "딜러", "Tanker": "탱커", "Healer": "힐러",
                 "Supporter": "서포터", "Vehicle": "T.S."},
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ba-skillup-calc/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    raw = fetch(SRC)
    items = list(raw.values()) if isinstance(raw, dict) else raw
    by_name = {s["Name"]: s for s in items}

    reg = load_reg()
    tags, official, unmatched = {}, {}, []

    for name in reg["byName"]:
        sid = resolve(reg, name)
        s = by_name.get(NAME_FIX.get(name, name))
        if not s:
            unmatched.append(name)
            continue
        tags[str(sid)] = {
            "bullet":   s.get("BulletType"),
            "armor":    s.get("ArmorType"),
            "weapon":   s.get("WeaponType"),
            "position": s.get("Position"),
            "squad":    s.get("SquadType"),
            "role":     s.get("TacticRole"),
            "star":     s.get("StarGrade"),
        }
        official[str(sid)] = s.get("Id")

    # The official game ID is stored alongside sid, not in place of it (ADR 0002).
    # sid is part of the save-format contract and therefore never changes, while
    # officialId is only there for reference.
    reg["officialId"] = official
    save_reg(reg)

    out = {"labels": LABELS, "tags": tags}
    p = os.path.join(GAME, "tags.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"tags for {len(tags)} students -> {os.path.relpath(p)} ({os.path.getsize(p):,} B)")
    print(f"official ID mappings: {len(official)}")
    if unmatched:
        print(f"unmatched: {len(unmatched)} students: {unmatched}")
        print("  -> add the spelling difference to NAME_FIX, or they may be new students that schaledb does not have yet.")


if __name__ == "__main__":
    main()
