"""
Stable student id registry (append-only)

Student identity is the most fragile point in this project.
The original workbook looks students up by their Korean name —
MATCH($B13, 자료2!$A$3:$A$10074, 0). If a name changes (a translation fix, a change of
spelling) the lookup turns into #N/A and everything the user entered for that student
silently disappears. With no server, there is no way to get it back either.

So an integer sid is used instead of the name. There is exactly one rule:

    A sid, once assigned, is never changed. A new student gets max+1.

The registry is committed to git. This file *is* the contract, which means it must never
be sorted, regenerated, or compacted to close up the gaps.
"""
import json, os, sys

REGISTRY = os.path.join(os.path.dirname(__file__), "..", "data", "student_ids.json")


def load():
    if not os.path.exists(REGISTRY):
        return {"next": 1, "byName": {}, "aliases": {}}
    with open(REGISTRY, encoding="utf-8") as f:
        return json.load(f)


def save(reg):
    os.makedirs(os.path.dirname(REGISTRY), exist_ok=True)
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=1, sort_keys=False)


def resolve(reg, name):
    """Name -> sid. Aliases (former names) are looked up as well."""
    if name in reg["byName"]:
        return reg["byName"][name]
    alias = reg["aliases"].get(name)
    if alias and alias in reg["byName"]:
        return reg["byName"][alias]
    return None


def register(reg, names):
    """Assign a sid only to names that are new. Existing sids are left untouched."""
    added = []
    for n in names:
        if resolve(reg, n) is None:
            reg["byName"][n] = reg["next"]
            added.append((n, reg["next"]))
            reg["next"] += 1
    return added


def add_alias(reg, old_name, current_name):
    """Call this when a name has changed, so saved files from the old one can still be restored."""
    if current_name not in reg["byName"]:
        raise KeyError(f"'{current_name}' is not in the registry")
    reg["aliases"][old_name] = current_name


def verify(reg):
    """Integrity check — run in CI to stop an accidental sid reshuffle."""
    errs = []
    ids = list(reg["byName"].values())
    if len(ids) != len(set(ids)):
        dup = {i for i in ids if ids.count(i) > 1}
        errs.append(f"duplicate sid: {sorted(dup)}")
    if ids and reg["next"] <= max(ids):
        errs.append(f"next({reg['next']}) is not above the largest sid({max(ids)}) — risk of reuse")
    for old, cur in reg["aliases"].items():
        if cur not in reg["byName"]:
            errs.append(f"alias '{old}' points at '{cur}', which does not exist")
        if old in reg["byName"]:
            errs.append(f"'{old}' is both an alias and a canonical name")
    return errs


if __name__ == "__main__":
    reg = load()
    errs = verify(reg)
    if errs:
        print("registry errors:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    print(f"{len(reg['byName'])} students, {len(reg['aliases'])} aliases, next sid {reg['next']} — all clear")
