"""Combine data/*.json into site/topics.json, copy photos, and fetch YouTube thumbnails."""
import json, pathlib, re, shutil, subprocess, urllib.request

ROOT = pathlib.Path(__file__).parent
SITE = ROOT / "site"
(SITE / "images").mkdir(parents=True, exist_ok=True)
(SITE / "thumbs").mkdir(exist_ok=True)

topics, problems = [], []
for f in sorted((ROOT / "data").glob("*.json")):
    t = json.loads(f.read_text())
    for p in t["photos"]:
        src = ROOT / "images" / p["file"]
        if src.exists():
            shutil.copy(src, SITE / "images" / p["file"])
        else:
            problems.append(f"{t['slug']}: missing photo {p['file']}")
    for v in t["videos"]:
        m = re.search(r"(?:v=|youtu\.be/|shorts/)([\w-]{11})", v["url"])
        if not m:
            problems.append(f"{t['slug']}: bad video url {v['url']}")
            continue
        out = SITE / "thumbs" / f"{m.group(1)}.jpg"
        if not out.exists():
            try:
                urllib.request.urlretrieve(f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg", out)
                subprocess.run(["sips", "-s", "formatOptions", "70", "-Z", "640", str(out)], capture_output=True)
            except Exception as e:
                problems.append(f"{t['slug']}: thumbnail failed {e}")
        if out.exists():
            v["thumb"] = out.name
    for s in t["sections"]:
        for i in s.get("from", []):
            if i >= len(t["sources"]):
                problems.append(f"{t['slug']}: section {s['key']} cites missing source {i}")
    ep = ROOT / "data" / "epic" / f.name
    t["books"] = json.loads(ep.read_text()).get("books", []) if ep.exists() else []
    topics.append(t)

(SITE / "topics.json").write_text(json.dumps(topics, ensure_ascii=False))
print(f"{len(topics)} topics built")
print("\n".join(problems) or "no problems")

# file map for publishing
files = {"topics.json": "topics.json"}
for d in ("images", "thumbs"):
    for p in sorted((SITE / d).iterdir()):
        files[f"{d}/{p.name}"] = f"{d}/{p.name}"
(ROOT / "publish_files.json").write_text(json.dumps(files))
print(f"{len(files)} files to publish")
