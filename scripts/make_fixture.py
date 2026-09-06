"""
Anonymous fixture generator for the tests.

Real account state (state_sample.json) is never committed to the repository.
The tests, however, need data shaped the way real data is — with fully synthetic data the
sparsity pattern and the compression ratio come out unlike the real thing, and a size
regression slips through unnoticed.

So only the *structure* of the real data is kept (student count, owned ratio, the set of
inventory keys, the spread of the values) and the values themselves are regenerated. The
seed is deterministic so that the fixture does not wobble from commit to commit.
"""
import json, os, random, sys

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "..", "data", "state_sample.json")
DST = os.path.join(HERE, "..", "data", "state_fixture.json")
SEED = 20260829


def anonymize(state, seed=SEED):
    rng = random.Random(seed)
    students = {}
    for sid, arr in state["students"].items():
        own = arr[0]
        if not own:
            students[sid] = [0]
            continue
        star = rng.randint(1, 8)
        students[sid] = [
            1,
            star,
            rng.choice([1, 25, 50, 70, 85, 90]),
            {8: 60, 7: 50, 6: 40, 5: 30}.get(star, 0),
            rng.randint(1, 5), rng.randint(1, 10), rng.randint(1, 10), rng.randint(1, 10),
            star,
            90,
            rng.randint(1, 5), rng.randint(1, 10), rng.randint(1, 10), rng.randint(1, 10),
            rng.randint(0, 10), rng.randint(0, 10), rng.randint(0, 10),
            rng.randint(0, 10), rng.randint(0, 10), rng.randint(0, 10),
        ]
    inv = {k: rng.randint(0, 6000) for k in state["inv"]}
    schools = dict(state["schools"])
    return {"v": state["v"], "students": students, "inv": inv, "schools": schools}


if __name__ == "__main__":
    if not os.path.exists(SRC):
        raise SystemExit(
            f"{SRC} does not exist.\n"
            "run this first: python3 scripts/extract_state.py <workbook.xlsx> data/state_sample.json"
        )
    with open(SRC, encoding="utf-8") as f:
        real = json.load(f)
    fake = anonymize(real)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(fake, f, ensure_ascii=False, separators=(",", ":"))
    owned = sum(1 for a in fake["students"].values() if a[0])
    print(f"fixture written: {len(fake['students'])} students ({owned} owned) / {len(fake['inv'])} inventory entries")
    print(f"-> {DST} ({os.path.getsize(DST):,} bytes)")
