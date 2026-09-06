"""
Pull user state out of the distributed workbook and move it into schema v1 JSON.

Existing users have to be able to bring their own workbook across as it is.
Without this script, that means re-entering the input for 269 students by hand.

Excel -> state mapping (sheets 1. BD·노트·크레딧 계산 / 3. 장비 계산):
  A          owned checkbox               -> own
  L,M,N      current ★/char Lv/unique Lv  -> curStar, curLv, curUniq
  O,P,Q,R    current EX/normal/passive/sub
  E          target ★ (formula =L, a mirror) -> tgtStar
  F,H,I,J,K  target char Lv/EX/normal/passive/sub
  AT,AU,AV   current gear tier 1/2/3      (gear sheet)
  AQ,AR,AS   target gear tier 1/2/3       (gear sheet)

Not stored: G (target unique Lv, derived from ★), the whole 2. 오파츠 계산 sheet
(a dynamic array spill), and D/E/F on the gear sheet (gear kind, fixed per student
in 자료2).
"""
import json, os, sys
import openpyxl
from student_ids import load as load_reg, save as save_reg, register, resolve, verify

BD_SHEET = "1. BD·노트·크레딧 계산"
EQ_SHEET = "3. 장비 계산"
OP_SHEET = "2. 오파츠 계산"


def _int(v, default=0):
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else default


def extract(path, reg):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    bd, eq, op = wb[BD_SHEET], wb[EQ_SHEET], wb[OP_SHEET]

    # A student row is one where column A (the owned checkbox) exists. School header
    # rows and total rows do not have it.
    brows = [r for r in range(19, 371) if bd.cell(r, 1).value is not None]
    erows = [r for r in range(13, 285) if eq.cell(r, 1).value is not None]
    if len(brows) != len(erows):
        raise SystemExit(f"sheet row counts disagree: BD {len(brows)} vs gear {len(erows)}")

    names = [bd.cell(r, 2).value for r in brows]
    added = register(reg, names)

    students, unknown = {}, []
    for rb, re_ in zip(brows, erows):
        name = bd.cell(rb, 2).value
        sid = resolve(reg, name)
        if sid is None:
            unknown.append(name)
            continue
        arr = [
            1 if bd.cell(rb, 1).value is True else 0,      # own
            _int(bd.cell(rb, 12).value),                    # L current star
            _int(bd.cell(rb, 13).value),                    # M current char Lv
            _int(bd.cell(rb, 14).value),                    # N current unique Lv
            _int(bd.cell(rb, 15).value),                    # O current EX
            _int(bd.cell(rb, 16).value),                    # P current normal
            _int(bd.cell(rb, 17).value),                    # Q current passive
            _int(bd.cell(rb, 18).value),                    # R current sub
            _int(bd.cell(rb, 5).value),                     # E target star
            _int(bd.cell(rb, 6).value),                     # F target char Lv
            _int(bd.cell(rb, 8).value),                     # H target EX
            _int(bd.cell(rb, 9).value),                     # I target normal
            _int(bd.cell(rb, 10).value),                    # J target passive
            _int(bd.cell(rb, 11).value),                    # K target sub
            _int(eq.cell(re_, 46).value),                   # AT current gear1
            _int(eq.cell(re_, 47).value),                   # AU current gear2
            _int(eq.cell(re_, 48).value),                   # AV current gear3
            _int(eq.cell(re_, 43).value),                   # AQ target gear1
            _int(eq.cell(re_, 44).value),                   # AR target gear2
            _int(eq.cell(re_, 45).value),                   # AS target gear3
        ]
        students[str(sid)] = arr

    # Inventory keys are built out of meaning, not position. Putting the sheet layout
    # (band / column offset) into the key would mean that the slightest change to that
    # layout makes a user's saved file point at the wrong cells.
    #   bd.<school>.<grade 0-3>        basic/normal/advanced/superior
    #   note.<school>.<grade 0-3>      basic/normal/advanced/superior
    #                                  (secret notes are not tracked per school)
    #   op.<material 0-19>.<grade 0-3>
    #   eq.<gear kind 0-8>.<tier 2-10>
    inv = {}
    for r in range(3, 14):
        school = bd.cell(r, 2).value
        if not school:
            continue
        for g, c in enumerate(range(5, 9)):
            inv[f"bd.{school}.{g}"] = _int(bd.cell(r, c).value)
        for g, c in enumerate(range(9, 13)):
            inv[f"note.{school}.{g}"] = _int(bd.cell(r, c).value)

    # Orbs: sheet row 3 holds materials 0-9, row 7 holds materials 10-19. Within a band
    # each material takes 4 cells, one per grade.
    for band, r in enumerate((3, 7)):
        for local in range(10):
            for g in range(4):
                v = op.cell(r, 12 + local * 4 + g).value
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    inv[f"op.{band * 10 + local}.{g}"] = int(v)

    # Gear: 3 bands (hat·gloves·shoes / bag·badge·hairpin / charm·watch·necklace),
    # each band 3 gear kinds x 9 tiers (2..10) = 27 cells. Kind is major, tier is minor.
    for band, r in enumerate((2, 5, 8)):
        for local in range(3):
            for t in range(9):
                v = eq.cell(r, 43 + local * 9 + t).value
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    inv[f"eq.{band * 3 + local}.{t + 2}"] = int(v)

    schools = {
        bd.cell(r, 2).value: (1 if bd.cell(r, 1).value is True else 0)
        for r in range(3, 14) if bd.cell(r, 2).value
    }
    wb.close()
    return {"v": 1, "students": students, "inv": inv, "schools": schools}, added, unknown


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: extract_state.py <workbook.xlsx> [output.json]")
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "state.json"

    reg = load_reg()
    state, added, unknown = extract(src, reg)
    errs = verify(reg)
    if errs:
        raise SystemExit("registry errors: " + "; ".join(errs))
    save_reg(reg)

    with open(out, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, separators=(",", ":"))

    # If a school name in an inventory key drifts away from the one in the game data, that
    # school's holdings quietly read as 0. That is the kind of failure that produces wrong
    # numbers without raising anything, so it has to be caught right here.
    gpath = os.path.join(os.path.dirname(__file__), "..", "data", "game", "schools.json")
    if os.path.exists(gpath):
        with open(gpath, encoding="utf-8") as f:
            known = set(json.load(f))
        used = {k.split(".")[1] for k in state["inv"] if k.startswith(("bd.", "note."))}
        stray = sorted(used - known)
        if stray:
            raise SystemExit(
                "school names in inventory keys disagree with game/schools.json: "
                + ", ".join(stray)
                + "\nWhen the two names diverge, that school's holdings read as 0 with no error."
            )
        print(f"school names consistent: all {len(used)} schools in inventory match the game data")

    print(f"{len(state['students'])} students / {len(state['inv'])} inventory entries / {len(state['schools'])} schools")
    if added:
        print(f"{len(added)} new sid(s) assigned: {added[:3]}{' ...' if len(added) > 3 else ''}")
    if unknown:
        print(f"warning: {len(unknown)} unresolved name(s) — {unknown[:5]}")
    print(f"-> {out} ({os.path.getsize(out):,} bytes)")
