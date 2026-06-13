import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime, timezone

from config import DB_PATH as _CFG_DB_PATH
from config import OUTPUT_DIR as _CFG_OUTPUT_DIR
from config import DB_QUERY_LIMIT as _CFG_QUERY_LIMIT

DB_PATH: Path = _CFG_DB_PATH
OUTPUT_DIR: Path = _CFG_OUTPUT_DIR


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


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
            preset      TEXT NOT NULL DEFAULT 'V4_QUALITY_48',
            seed        INTEGER NOT NULL DEFAULT 0,
            file_path   TEXT NOT NULL,
            prompt_id   INTEGER,
            lora_name   TEXT,
            lora_strength REAL
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
    conn.commit()
    conn.close()


def add_image(hld: str, width: int, height: int, preset: str, seed: int, file_path: str, prompt_id: int | None = None, lora_name: str | None = None, lora_strength: float | None = None) -> int:
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO images (hld, width, height, preset, seed, file_path, prompt_id, lora_name, lora_strength) VALUES (?,?,?,?,?,?,?,?,?)",
        (hld, width, height, preset, seed, file_path, prompt_id, lora_name, lora_strength),
    )
    conn.commit()
    image_id = cur.lastrowid
    conn.close()
    return image_id


def get_images(limit: int = _CFG_QUERY_LIMIT, prompt_id: int | None = None) -> list[dict]:
    conn = _conn()
    if prompt_id is not None:
        rows = conn.execute(
            "SELECT * FROM images WHERE prompt_id = ? ORDER BY created_at DESC LIMIT ?", (prompt_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM images ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_image(image_id: int) -> bool:
    conn = _conn()
    row = conn.execute("SELECT file_path FROM images WHERE id = ?", (image_id,)).fetchone()
    if not row:
        conn.close()
        return False
    fp = row["file_path"]
    conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
    conn.commit()
    conn.close()
    if os.path.exists(fp):
        os.remove(fp)
    return True


def delete_all_images():
    conn = _conn()
    rows = conn.execute("SELECT file_path FROM images").fetchall()
    for r in rows:
        if os.path.exists(r["file_path"]):
            os.remove(r["file_path"])
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
    pid = cur.lastrowid
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
    rows = conn.execute("SELECT file_path FROM images WHERE prompt_id = ?", (prompt_id,)).fetchall()
    for r in rows:
        if os.path.exists(r["file_path"]):
            os.remove(r["file_path"])
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


def get_last_form() -> str | None:
    conn = _conn()
    row = conn.execute("SELECT form_json FROM last_form WHERE id = 1").fetchone()
    conn.close()
    return row["form_json"] if row else None
