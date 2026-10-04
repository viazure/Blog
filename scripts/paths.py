"""Locate the life-data checkout and the folder the processed JSON goes to."""

from __future__ import annotations

import os
import re
import sys
from html import escape
from pathlib import Path
from urllib.parse import urlparse

BLOG = Path(__file__).resolve().parents[1]
SCHEMA = 2


def _env_path(name: str) -> Path | None:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else None


def life_data_root() -> Path:
    env = _env_path("LIFE_DATA_DIR")
    if env:
        return env
    # In CI the checkout is always the repository root.
    workspace = _env_path("GITHUB_WORKSPACE")
    candidates = [BLOG / "life-data", BLOG.parent / "life-data"]
    if workspace:
        candidates.insert(0, workspace / "life-data")
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise SystemExit("life-data not found; set LIFE_DATA_DIR or check out viazure/life-data")


def data_dir() -> Path:
    """Where the processed JSON for Hugo is written."""
    return _env_path("DATA_OUT_DIR") or BLOG / "data"


def load_json(path: Path):
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def load_archive(path: Path) -> dict:
    """Read one life-data archive.

    The fetchers write a `source` + `items` envelope and stamp no schema
    version, so a missing field is normal. Only a *present but different*
    value means the shape changed under us, which is worth stopping for.
    """
    data = load_json(path)
    schema = data.get("schema") if isinstance(data, dict) else None
    if schema is not None and schema != SCHEMA:
        raise SystemExit(f"{path.name} schema is {schema}, expected {SCHEMA}")
    if schema is None:
        print(f"note: {path.name} carries no schema field, reading as v{SCHEMA}", file=sys.stderr)
    return data


def field_text(value) -> str:
    if isinstance(value, dict):
        return field_text(value.get("#text") or value.get("name") or "")
    if value is None:
        return ""
    return str(value).strip()


def note_text(text: str) -> str:
    """A shelf comment as plain text, its markdown links flattened to labels.

    The comment is prose the reader wrote, so it is shown verbatim. Markdown
    syntax is flattened rather than rendered: `[label](url)` becomes `label`,
    which reads fine inline and keeps the template free of raw HTML.
    """
    if not text:
        return ""
    flattened = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"\s+", " ", flattened).strip()


def note_html(text: str, limit: int = 40) -> str:
    """The comment as escaped HTML, turning a link into an anchor.

    Links are lifted out *before* escaping so the anchor markup survives, then
    everything else is escaped and the anchors are pasted back. A markdown link
    with a short label becomes a real link; a bare URL shows just its host.
    """
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    holes: list[str] = []

    def anchor(label: str, url: str) -> str:
        holes.append(
            '<a href="%s" rel="nofollow noopener" target="_blank">%s</a>'
            % (escape(url, quote=True), escape(label or url))
        )
        return "\x00%d\x00" % (len(holes) - 1)

    def markdown(match: re.Match) -> str:
        label, url = match.group(1), match.group(2)
        return anchor(label if len(label) <= limit else "", url)

    def bare(match: re.Match) -> str:
        url = match.group(0).rstrip(".,;、。")
        return anchor(urlparse(url).netloc.removeprefix("www."), url)

    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", markdown, text)
    text = re.sub(r"https?://[^\s<>\"）)]+", bare, text)
    text = escape(text)
    for index, tag in enumerate(holes):
        text = text.replace("\x00%d\x00" % index, tag)
    return text


def dump(path: Path, obj) -> None:
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def dump_data(name: str, obj) -> Path:
    """Write one processed file into the data folder Hugo reads."""
    path = data_dir() / name
    dump(path, obj)
    return path
