import math
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from config import DB_PATH as _CFG_DB_PATH
from config import OUTPUT_DIR as _CFG_OUTPUT_DIR
from config import DB_QUERY_LIMIT as _CFG_QUERY_LIMIT

DB_PATH: Path = _CFG_DB_PATH
OUTPUT_DIR: Path = _CFG_OUTPUT_DIR
IMAGE_SUFFIXES = {".png", ".webp", ".jpeg", ".jpg"}
HISTORY_PREVIEW_GRACE_MS = 120_000


def _parse_server_timestamp(value: str) -> float:
    trimmed = value.strip()
    if not trimmed:
        return math.nan
    if re.search(r"[zZ]|[+-]\d{2}:\d{2}$", trimmed):
        dt = datetime.fromisoformat(trimmed.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp() * 1000
    normalized = trimmed if "T" in trimmed else trimmed.replace(" ", "T")
    dt = datetime.fromisoformat(f"{normalized}+00:00")
    return dt.timestamp() * 1000


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def _require_lastrowid(cur: sqlite3.Cursor) -> int:
    row_id = cur.lastrowid
    if row_id is None:
        raise RuntimeError("SQLite INSERT did not return a row id")
    return int(row_id)



def _output_root() -> Path:
    return OUTPUT_DIR.resolve()


def normalize_image_path_for_storage(file_path: str | Path) -> str:
    path = Path(file_path)
    root = _output_root()
    if path.is_absolute():
        resolved = path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("Image path must be inside IDEOGRAM4_OUTPUT_DIR.")
        path = Path(resolved.name)

    if len(path.parts) > 1:
        basename = Path(path.name)
        if (root / basename).is_file():
            path = basename
        else:
            nested = (root / path).resolve()
            if nested.is_file() and root in nested.parents:
                path = Path(nested.name)
            else:
                raise ValueError("Image path must be a generated image filename.")

    if path.name in {"", ".", ".."} or path.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError("Image path must be a generated image filename.")
    return path.name


def resolve_image_path(file_path: str | Path) -> Path | None:
    try:
        name = normalize_image_path_for_storage(file_path)
    except ValueError:
        return None
    path = (_output_root() / name).resolve()
    root = _output_root()
    if path != root and root in path.parents:
        return path
    return None


def _delete_image_file(file_path: str | Path) -> None:
    path = resolve_image_path(file_path)
    if path and path.is_file():
        path.unlink()


def _public_image_row(row: sqlite3.Row) -> dict:
    data = dict(row)
    path = resolve_image_path(data["file_path"])
    if path:
        data["file_path"] = path.name
    else:
        data["file_path"] = ""
    return data


def _migrate_favorites_to_image_only() -> None:
    """Collapse legacy (kind, target_id) favorites into image_id rows."""
    conn = _conn()
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(favorites)").fetchall()}
        if not cols or "image_id" in cols:
            return
        if "kind" not in cols:
            return

        conn.executescript("""
            CREATE TABLE favorites_v2 (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                image_id    INTEGER NOT NULL UNIQUE
            );
        """)

        conn.execute("""
            INSERT OR IGNORE INTO favorites_v2 (id, created_at, image_id)
            SELECT f.id, f.created_at, f.target_id
            FROM favorites f
            WHERE f.kind = 'image'
              AND EXISTS (SELECT 1 FROM images i WHERE i.id = f.target_id)
        """)

        conn.execute("""
            INSERT OR IGNORE INTO favorites_v2 (created_at, image_id)
            SELECT f.created_at,
                   (SELECT i.id FROM images i
                    WHERE i.prompt_id = f.target_id
                    ORDER BY i.created_at DESC LIMIT 1)
            FROM favorites f
            WHERE f.kind = 'prompt'
              AND EXISTS (
                SELECT 1 FROM images i WHERE i.prompt_id = f.target_id
              )
        """)

        conn.execute("DROP TABLE favorites")
        conn.execute("ALTER TABLE favorites_v2 RENAME TO favorites")
        conn.commit()
    finally:
        conn.close()


def _migrate_legacy_image_paths() -> int:
    conn = _conn()
    rows = conn.execute("SELECT id, file_path FROM images WHERE instr(file_path, '/') > 0").fetchall()
    updated = 0
    for row in rows:
        try:
            normalized = normalize_image_path_for_storage(row["file_path"])
        except ValueError:
            continue
        if normalized != row["file_path"]:
            conn.execute(
                "UPDATE images SET file_path = ? WHERE id = ?",
                (normalized, row["id"]),
            )
            updated += 1
    conn.commit()
    conn.close()
    return updated


def init_db(db_path: str | None = None, output_dir: str | None = None):
    global DB_PATH, OUTPUT_DIR
    if db_path:
        DB_PATH = Path(db_path)
    if output_dir:
        OUTPUT_DIR = Path(output_dir)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS images (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            hld         TEXT NOT NULL DEFAULT '',
            width       INTEGER NOT NULL DEFAULT 1024,
            height      INTEGER NOT NULL DEFAULT 1024,
            preset      TEXT NOT NULL DEFAULT 'V4_TURBO_12',
            seed        INTEGER NOT NULL DEFAULT 0,
            file_path   TEXT NOT NULL,
            prompt_id   INTEGER,
            lora_name   TEXT,
            lora_strength REAL,
            lora_stack_json TEXT
        );

        CREATE TABLE IF NOT EXISTS prompts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            saved_at    TEXT NOT NULL DEFAULT (datetime('now')),
            hld         TEXT NOT NULL DEFAULT '',
            form_json   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS last_form (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            form_json   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            image_id    INTEGER NOT NULL UNIQUE
        );
    """)
    try:
        conn.execute("ALTER TABLE images ADD COLUMN prompt_id INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE images ADD COLUMN lora_name TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE images ADD COLUMN lora_strength REAL")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE images ADD COLUMN lora_stack_json TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()
    _migrate_legacy_image_paths()
    _migrate_favorites_to_image_only()


def add_image(
    hld: str,
    width: int,
    height: int,
    preset: str,
    seed: int,
    file_path: str,
    prompt_id: int | None = None,
    lora_name: str | None = None,
    lora_strength: float | None = None,
    lora_stack_json: str | None = None,
) -> int:
    stored_path = normalize_image_path_for_storage(file_path)
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO images (hld, width, height, preset, seed, file_path, prompt_id, lora_name, lora_strength, lora_stack_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (hld, width, height, preset, seed, stored_path, prompt_id, lora_name, lora_strength, lora_stack_json),
    )
    conn.commit()
    image_id = _require_lastrowid(cur)
    conn.close()
    return image_id


_LINKED_WHERE = """
    prompt_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM prompts p WHERE p.id = images.prompt_id)
"""

_ORPHAN_WHERE = """
    prompt_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM prompts p WHERE p.id = images.prompt_id)
"""


def _images_query(sql: str, params: list, limit: int) -> tuple[str, list]:
    if limit > 0:
        return f"{sql} LIMIT ?", [*params, limit]
    return sql, params


def get_images(
    limit: int = _CFG_QUERY_LIMIT,
    prompt_id: int | None = None,
    *,
    linked_only: bool = False,
    orphans_only: bool = False,
) -> list[dict]:
    conn = _conn()
    if prompt_id is not None:
        sql, params = _images_query(
            "SELECT * FROM images WHERE prompt_id = ? ORDER BY created_at DESC",
            [prompt_id],
            limit,
        )
    elif orphans_only:
        sql, params = _images_query(
            f"SELECT * FROM images WHERE {_ORPHAN_WHERE} ORDER BY created_at DESC",
            [],
            limit,
        )
    elif linked_only:
        sql, params = _images_query(
            f"SELECT * FROM images WHERE {_LINKED_WHERE} ORDER BY created_at DESC",
            [],
            limit,
        )
    else:
        sql, params = _images_query(
            "SELECT * FROM images ORDER BY created_at DESC",
            [],
            limit,
        )
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [_public_image_row(r) for r in rows]


def get_image_stats() -> dict:
    conn = _conn()
    row = conn.execute(
        f"""
        SELECT
            (SELECT COUNT(*) FROM images) AS total,
            (SELECT COUNT(*) FROM images WHERE {_LINKED_WHERE}) AS linked,
            (SELECT COUNT(*) FROM images WHERE prompt_id IS NULL) AS null_prompt_id,
            (SELECT COUNT(*) FROM images WHERE prompt_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM prompts p WHERE p.id = images.prompt_id)) AS dangling
        """
    ).fetchone()
    conn.close()
    orphans = int(row["null_prompt_id"]) + int(row["dangling"])
    return {
        "total": int(row["total"]),
        "linked": int(row["linked"]),
        "orphans": orphans,
        "null_prompt_id": int(row["null_prompt_id"]),
        "dangling": int(row["dangling"]),
    }


def delete_orphan_images() -> int:
    conn = _conn()
    rows = conn.execute(f"SELECT id, file_path FROM images WHERE {_ORPHAN_WHERE}").fetchall()
    for row in rows:
        conn.execute("DELETE FROM favorites WHERE image_id = ?", (row["id"],))
        _delete_image_file(row["file_path"])
    conn.execute(f"DELETE FROM images WHERE {_ORPHAN_WHERE}")
    deleted = conn.total_changes
    conn.commit()
    conn.close()
    return deleted


def get_image(image_id: int) -> dict | None:
    conn = _conn()
    row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
    conn.close()
    return _public_image_row(row) if row else None


def get_image_by_file_path(file_path: str | Path) -> dict | None:
    stored_path = normalize_image_path_for_storage(file_path)
    conn = _conn()
    row = conn.execute("SELECT * FROM images WHERE file_path = ?", (stored_path,)).fetchone()
    conn.close()
    return _public_image_row(row) if row else None


def _link_image_prompt_conn(
    conn: sqlite3.Connection,
    image_id: int,
    prompt_id: int,
) -> bool:
    prompt = conn.execute(
        "SELECT id, saved_at FROM prompts WHERE id = ?", (prompt_id,)
    ).fetchone()
    if not prompt:
        return False
    row = conn.execute("SELECT id FROM images WHERE id = ?", (image_id,)).fetchone()
    if not row:
        return False
    conn.execute(
        "UPDATE images SET prompt_id = NULL WHERE prompt_id = ? AND id != ? AND created_at < ?",
        (prompt_id, image_id, prompt["saved_at"]),
    )
    conn.execute("UPDATE images SET prompt_id = ? WHERE id = ?", (prompt_id, image_id))
    return True


def link_image_prompt(image_id: int, prompt_id: int) -> bool:
    conn = _conn()
    try:
        ok = _link_image_prompt_conn(conn, image_id, prompt_id)
        if ok:
            conn.commit()
        return ok
    finally:
        conn.close()


def attach_image_history(
    image_id: int,
    *,
    hld: str,
    form_json: str,
    prompt_id: int | None = None,
) -> dict | None:
    """Atomically create or update a prompt and link an image."""
    conn = _conn()
    try:
        img = conn.execute("SELECT id FROM images WHERE id = ?", (image_id,)).fetchone()
        if not img:
            return None

        if prompt_id is None:
            cur = conn.execute(
                "INSERT INTO prompts (hld, form_json) VALUES (?,?)",
                (hld, form_json),
            )
            prompt_id = _require_lastrowid(cur)
        else:
            existing = conn.execute(
                "SELECT id FROM prompts WHERE id = ?", (prompt_id,)
            ).fetchone()
            if not existing:
                return None
            conn.execute(
                "UPDATE prompts SET hld = ?, form_json = ? WHERE id = ?",
                (hld, form_json, prompt_id),
            )

        if not _link_image_prompt_conn(conn, image_id, prompt_id):
            conn.rollback()
            return None

        conn.commit()
        return {"ok": True, "prompt_id": prompt_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def delete_image(image_id: int) -> bool:
    conn = _conn()
    row = conn.execute("SELECT file_path FROM images WHERE id = ?", (image_id,)).fetchone()
    if not row:
        conn.close()
        return False
    fp = row["file_path"]
    conn.execute("DELETE FROM favorites WHERE image_id = ?", (image_id,))
    conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
    conn.commit()
    conn.close()
    _delete_image_file(fp)
    return True


def delete_all_images():
    conn = _conn()
    rows = conn.execute("SELECT file_path FROM images").fetchall()
    for r in rows:
        _delete_image_file(r["file_path"])
    conn.execute("DELETE FROM images")
    conn.commit()
    conn.close()


def save_prompt(hld: str, form_json: str) -> int:
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO prompts (hld, form_json) VALUES (?,?)",
        (hld, form_json),
    )
    conn.commit()
    pid = _require_lastrowid(cur)
    conn.close()
    return pid


def get_prompts(limit: int = _CFG_QUERY_LIMIT) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM prompts ORDER BY saved_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_prompt(prompt_id: int) -> dict | None:
    conn = _conn()
    row = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_prompt(prompt_id: int) -> bool:
    conn = _conn()
    image_rows = conn.execute(
        "SELECT id, file_path FROM images WHERE prompt_id = ?", (prompt_id,)
    ).fetchall()
    for row in image_rows:
        conn.execute("DELETE FROM favorites WHERE image_id = ?", (row["id"],))
        _delete_image_file(row["file_path"])
    conn.execute(
        "DELETE FROM favorites WHERE image_id IN (SELECT id FROM images WHERE prompt_id = ?)",
        (prompt_id,),
    )
    conn.execute("DELETE FROM images WHERE prompt_id = ?", (prompt_id,))
    conn.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
    conn.commit()
    affected = conn.total_changes
    conn.close()
    return affected > 0


def save_last_form(form_json: str):
    conn = _conn()
    conn.execute(
        "INSERT OR REPLACE INTO last_form (id, form_json) VALUES (1, ?)",
        (form_json,),
    )
    conn.commit()
    conn.close()


def _prompt_preview_image_id(prompt_id: int) -> int | None:
    """Match webui pickHistoryPreviewImage: latest eligible image for a history row."""
    prompt = get_prompt(prompt_id)
    if prompt is None:
        return None
    conn = _conn()
    rows = conn.execute(
        "SELECT id, created_at FROM images WHERE prompt_id = ?",
        (prompt_id,),
    ).fetchall()
    conn.close()
    if not rows:
        return None

    saved_ms = _parse_server_timestamp(prompt["saved_at"])
    if not math.isfinite(saved_ms):
        return int(rows[0]["id"])

    cutoff_ms = saved_ms - HISTORY_PREVIEW_GRACE_MS
    eligible: list[sqlite3.Row] = []
    for row in rows:
        created_ms = _parse_server_timestamp(row["created_at"])
        if math.isfinite(created_ms) and created_ms >= cutoff_ms:
            eligible.append(row)

    if not eligible:
        return None

    preview = eligible[0]
    preview_ms = _parse_server_timestamp(preview["created_at"])
    for row in eligible[1:]:
        created_ms = _parse_server_timestamp(row["created_at"])
        if math.isfinite(created_ms) and created_ms > preview_ms:
            preview = row
            preview_ms = created_ms
    return int(preview["id"])


def _favorite_row_from_image(image: dict) -> dict:
    raw_prompt_id = image.get("prompt_id")
    preview_prompt_id: int | None = None
    if raw_prompt_id is not None and get_prompt(raw_prompt_id) is not None:
        preview_id = _prompt_preview_image_id(raw_prompt_id)
        if preview_id is not None and preview_id == image["id"]:
            preview_prompt_id = raw_prompt_id
    return {
        "image_id": image["id"],
        "hld": image["hld"],
        "preset": image["preset"],
        "w": image["width"],
        "h": image["height"],
        "prompt_id": preview_prompt_id,
        "history_linked": preview_prompt_id is not None,
    }


def _resolve_favorite_image_id(
    *,
    image_id: int | None = None,
    prompt_id: int | None = None,
) -> int | None:
    if image_id is not None:
        return image_id if get_image(image_id) is not None else None
    if prompt_id is not None:
        if get_prompt(prompt_id) is None:
            return None
        return _prompt_preview_image_id(prompt_id)
    return None


def _enrich_favorite(row: sqlite3.Row) -> dict | None:
    image = get_image(row["image_id"])
    if image is None:
        return None
    data = dict(row)
    data.update(_favorite_row_from_image(image))
    return data


def get_favorites() -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM favorites ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    items: list[dict] = []
    for row in rows:
        enriched = _enrich_favorite(row)
        if enriched is not None:
            items.append(enriched)
    return items


def get_favorite(favorite_id: int) -> dict | None:
    conn = _conn()
    row = conn.execute("SELECT * FROM favorites WHERE id = ?", (favorite_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return _enrich_favorite(row)


def add_favorite(
    *,
    image_id: int | None = None,
    prompt_id: int | None = None,
) -> dict | None:
    resolved_image_id = _resolve_favorite_image_id(
        image_id=image_id,
        prompt_id=prompt_id,
    )
    if resolved_image_id is None:
        return None
    conn = _conn()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO favorites (image_id) VALUES (?)",
            (resolved_image_id,),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM favorites WHERE image_id = ?",
            (resolved_image_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return _enrich_favorite(row)


def remove_favorite(
    *,
    image_id: int | None = None,
    prompt_id: int | None = None,
) -> bool:
    resolved_image_id = _resolve_favorite_image_id(
        image_id=image_id,
        prompt_id=prompt_id,
    )
    if resolved_image_id is None:
        return False
    conn = _conn()
    conn.execute("DELETE FROM favorites WHERE image_id = ?", (resolved_image_id,))
    conn.commit()
    deleted = conn.total_changes > 0
    conn.close()
    return deleted


def get_last_form() -> str | None:
    conn = _conn()
    row = conn.execute("SELECT form_json FROM last_form WHERE id = 1").fetchone()
    conn.close()
    return row["form_json"] if row else None
