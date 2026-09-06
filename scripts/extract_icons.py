"""
Extract the material and gear icons from the distributed workbook.

There is no need to scrape the icons from an external wiki. The workbook already holds
356 of them as 'in-cell images' (Excel rich values), and they sit in the cell right
below the material name, so the label comes along with them. That is more accurate than
digging through a wiki, and it is something the user already had inside their own file.

The chain from a cell to an image file:
  vm="N" on a worksheet cell                    (value metadata index, 1-based)
    -> the Nth <bk><rc v="R"/> in xl/metadata.xml               (rich value index)
    -> the first <v> of the Rth <rv> in xl/richData/rdrichvalue.xml   (rel index)
    -> the <rel r:id=…> at that position in xl/richData/richValueRel.xml
    -> ../media/imageNNN.png via _rels/richValueRel.xml.rels

Layout:
  자료2      80 cells from H2 = 20 materials x 4 grades  -> opart_<material idx>_<grade>.png
  3.장비 계산 from AQ1         = gear type x tier         -> gear_<type idx>_<tier>.png
"""
import json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "icons")

COL_RE = re.compile(r"([A-Z]+)(\d+)")


def col_num(ref):
    letters = COL_RE.match(ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def build_chain(z):
    """vm index -> media file path."""
    meta = z.read("xl/metadata.xml").decode("utf8")
    # the <bk><rc t="1" v="R"/></bk> entries are vm 1,2,3… in order
    rc = [int(m) for m in re.findall(r"<bk><rc[^>]*\sv=\"(\d+)\"", meta)]

    rv = z.read("xl/richData/rdrichvalue.xml").decode("utf8")
    rv_first = [int(m.group(1)) for m in re.finditer(r"<rv[^>]*>\s*<v>(\d+)</v>", rv)]

    rel = z.read("xl/richData/richValueRel.xml").decode("utf8")
    rel_ids = re.findall(r'<rel[^>]*r:id="(rId\d+)"', rel)

    rels = z.read("xl/richData/_rels/richValueRel.xml.rels").decode("utf8")
    id2target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))

    def resolve(vm):
        i = vm - 1
        if not (0 <= i < len(rc)):
            return None
        r = rc[i]
        if not (0 <= r < len(rv_first)):
            return None
        k = rv_first[r]
        if not (0 <= k < len(rel_ids)):
            return None
        target = id2target.get(rel_ids[k])
        return "xl/" + target.replace("../", "") if target else None

    return resolve


def cells_with_images(z, sheet):
    x = z.read(f"xl/worksheets/{sheet}").decode("utf8")
    return re.findall(r'<c r="([A-Z]+\d+)"[^>]*vm="(\d+)"', x)


def main(src):
    z = zipfile.ZipFile(src)
    resolve = build_chain(z)
    os.makedirs(OUT, exist_ok=True)

    game = os.path.join(HERE, "..", "data", "game")
    with open(os.path.join(game, "materials.json"), encoding="utf-8") as f:
        mats = json.load(f)["opart"]
    with open(os.path.join(game, "gear.json"), encoding="utf-8") as f:
        gear = json.load(f)
    types, tiers = gear.get("types", []), gear["tierLabels"]

    written, index = 0, {"opart": {}, "gear": {}}
    missing = []

    # 자료2: from H(8), 20 materials x 4 grades
    for ref, vm in cells_with_images(z, "sheet8.xml"):
        off = col_num(ref) - 8
        if off < 0 or off >= len(mats) * 4:
            continue
        mi, g = divmod(off, 4)
        path = resolve(int(vm))
        if not path:
            missing.append(("opart", ref))
            continue
        name = f"opart_{mi}_{g}.png"
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(z.read(path))
        index["opart"][f"{mi}.{g}"] = name
        written += 1

    # 3.장비: from AQ(43), 3 bands x (3 types x 9 tiers)
    for ref, vm in cells_with_images(z, "sheet4.xml"):
        m = COL_RE.match(ref)
        row = int(m.group(2))
        if row not in (1, 4, 7):
            continue
        band = {1: 0, 4: 1, 7: 2}[row]
        off = col_num(ref) - 43
        if off < 0 or off >= 27:
            continue
        local, t = divmod(off, 9)
        ti, tier = band * 3 + local, tiers[t]
        path = resolve(int(vm))
        if not path:
            missing.append(("gear", ref))
            continue
        name = f"gear_{ti}_{tier}.png"
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(z.read(path))
        index["gear"][f"{ti}.{tier}"] = name
        written += 1

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, n))
                for n in os.listdir(OUT) if n.endswith(".png"))
    print(f"Saved {written} icons -> web/icons/ ({total/1024:.0f} KB)")
    print(f"  O-Parts {len(index['opart'])}/{len(mats)*4}"
          f"  gear {len(index['gear'])}/{len(types)*len(tiers)}")
    if missing:
        print(f"  {len(missing)} failed to resolve: {missing[:5]}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: extract_icons.py <release.xlsx>")
    main(sys.argv[1])
