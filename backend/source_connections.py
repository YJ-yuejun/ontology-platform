"""Design-time database connections and physical-schema snapshots.

Credentials never enter enterprise resource payloads or API responses. The
local prototype uses a protected Fernet key file; a deployed service should
replace this adapter with its credential vault.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

import repository as repo


def init_tables() -> None:
    conn = repo.get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS source_connection_secrets (
          source_id TEXT PRIMARY KEY, password_token TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(source_id) REFERENCES enterprise_data_sources(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS source_schema_snapshots (
          id TEXT PRIMARY KEY, source_id TEXT NOT NULL, ontology_id TEXT NOT NULL,
          captured_at TEXT NOT NULL, schema_hash TEXT NOT NULL, schema_json TEXT NOT NULL,
          FOREIGN KEY(source_id) REFERENCES enterprise_data_sources(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_source_snapshots ON source_schema_snapshots(source_id, captured_at DESC);
    """)
    conn.commit()
    conn.close()


def _cipher():
    from cryptography.fernet import Fernet

    configured = os.environ.get("ONTOLOGY_CREDENTIAL_KEY")
    if configured:
        return Fernet(configured.encode())
    key_path = Path(repo.DB_PATH).with_suffix(".credential.key")
    key_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(key_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "wb") as handle:
            handle.write(Fernet.generate_key())
    return Fernet(key_path.read_bytes().strip())


def set_password(source_id: str, password: str) -> None:
    if not password:
        raise repo.ValidationError("密码不能为空；保留原密码时不要提交密码字段")
    token = _cipher().encrypt(password.encode()).decode()
    conn = repo.get_conn()
    conn.execute("""INSERT INTO source_connection_secrets(source_id,password_token,updated_at)
        VALUES (?,?,?) ON CONFLICT(source_id) DO UPDATE SET
        password_token=excluded.password_token, updated_at=excluded.updated_at""",
        (source_id, token, repo.now()))
    conn.commit()
    conn.close()


def has_password(source_id: str) -> bool:
    conn = repo.get_conn()
    row = conn.execute("SELECT 1 FROM source_connection_secrets WHERE source_id=?", (source_id,)).fetchone()
    conn.close()
    return bool(row)


def _source(ontology_id: str, source_id: str) -> Dict[str, Any]:
    conn = repo.get_conn()
    row = conn.execute("SELECT * FROM enterprise_data_sources WHERE id=? AND ontology_id=?", (source_id, ontology_id)).fetchone()
    conn.close()
    if not row:
        raise repo.NotFoundError("数据源不存在")
    data = dict(row)
    data.update(json.loads(data.pop("payload") or "{}"))
    return data


def _connect(source: Dict[str, Any]):
    if source.get("driver") != "mysql":
        raise repo.ValidationError("当前仅支持 MySQL 直连结构采集；其他来源可登记并导入数据字典")
    required = {"host": "主机地址", "port": "端口", "database": "数据库名称", "username": "用户名"}
    missing = [label for key, label in required.items() if not source.get(key)]
    if missing:
        raise repo.ValidationError("连接配置缺少：" + "、".join(missing))
    if not has_password(source["id"]):
        raise repo.ValidationError("尚未配置连接密码")
    try:
        import pymysql
    except ImportError as exc:
        raise repo.ValidationError("MySQL 驱动尚未安装，请安装项目 requirements.txt") from exc
    conn = repo.get_conn()
    row = conn.execute("SELECT password_token FROM source_connection_secrets WHERE source_id=?", (source["id"],)).fetchone()
    conn.close()
    password = _cipher().decrypt(row["password_token"].encode()).decode()
    try:
        return pymysql.connect(
            host=source["host"], port=int(source["port"]), user=source["username"],
            password=password, database=source["database"],
            connect_timeout=5, read_timeout=8, write_timeout=8,
            charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        )
    except (pymysql.MySQLError, OSError, ValueError) as exc:
        raise repo.ValidationError("连接失败：" + str(exc)) from exc


def test_connection(ontology_id: str, source_id: str) -> Dict[str, Any]:
    source = _source(ontology_id, source_id)
    try:
        with _connect(source) as remote:
            with remote.cursor() as cursor:
                cursor.execute("""SELECT COUNT(*) AS total FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA=%s""", (source["database"],))
                count = cursor.fetchone()["total"]
    except Exception as exc:
        _store_connection_check(source_id, {"status": "failed", "checked_at": repo.now()})
        if isinstance(exc, repo.ValidationError):
            raise
        raise repo.ValidationError("连接失败或无权读取元数据；请检查地址、账号与权限") from exc
    checked_at = repo.now()
    _store_connection_check(source_id, {"status": "passed", "checked_at": checked_at, "table_count": count})
    return {"status": "passed", "checked_at": checked_at, "table_count": count}


def _store_connection_check(source_id: str, value: Dict[str, Any]) -> None:
    conn = repo.get_conn()
    payload = json.loads(conn.execute("SELECT payload FROM enterprise_data_sources WHERE id=?", (source_id,)).fetchone()["payload"])
    payload["connection_check"] = value
    conn.execute("UPDATE enterprise_data_sources SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), source_id))
    conn.commit()
    conn.close()


def list_remote_tables(ontology_id: str, source_id: str) -> Dict[str, Any]:
    source = _source(ontology_id, source_id)
    if source.get("connection_check", {}).get("status") != "passed":
        raise repo.ValidationError("请先测试连接")
    try:
        with _connect(source) as remote:
            with remote.cursor() as cursor:
                cursor.execute("""SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
                    FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME""", (source["database"],))
                rows = cursor.fetchall()
    except repo.ValidationError:
        raise
    except Exception as exc:
        raise repo.ValidationError("表目录读取失败，请检查元数据权限") from exc
    return {"tables": [{"name": row["TABLE_NAME"], "type": row["TABLE_TYPE"],
                        "comment": row["TABLE_COMMENT"]} for row in rows]}


def discover_schema(ontology_id: str, source_id: str, table_names: Optional[list[str]] = None) -> Dict[str, Any]:
    source = _source(ontology_id, source_id)
    if not source.get("connection_check") or source["connection_check"].get("status") != "passed":
        raise repo.ValidationError("请先测试连接")
    try:
        with _connect(source) as remote:
            with remote.cursor() as cursor:
                cursor.execute("""SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
                FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME""", (source["database"],))
                available = cursor.fetchall()
                if not table_names:
                    raise repo.ValidationError("请选择至少一张表后再获取结构")
                chosen = set(table_names)
                unknown = chosen - {item["TABLE_NAME"] for item in available}
                if unknown:
                    raise repo.ValidationError("所选表不存在或不可读取：" + "、".join(sorted(unknown)))
                tables = []
                for table in available:
                    name = table["TABLE_NAME"]
                    if name not in chosen:
                        continue
                    cursor.execute("""SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
                    COLUMN_KEY, COLUMN_COMMENT, ORDINAL_POSITION
                    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
                    ORDER BY ORDINAL_POSITION""", (source["database"], name))
                    columns = [{"name": col["COLUMN_NAME"], "data_type": col["DATA_TYPE"],
                                "column_type": col["COLUMN_TYPE"], "nullable": col["IS_NULLABLE"] == "YES",
                                "key": col["COLUMN_KEY"], "comment": col["COLUMN_COMMENT"]} for col in cursor.fetchall()]
                    cursor.execute("""SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
                    AND REFERENCED_TABLE_NAME IS NOT NULL""", (source["database"], name))
                    references = [{"column": ref["COLUMN_NAME"], "table": ref["REFERENCED_TABLE_NAME"],
                                   "target_column": ref["REFERENCED_COLUMN_NAME"]} for ref in cursor.fetchall()]
                    tables.append({"name": name, "type": table["TABLE_TYPE"],
                                   "comment": table["TABLE_COMMENT"], "columns": columns, "references": references})
    except repo.ValidationError:
        raise
    except Exception as exc:
        raise repo.ValidationError("结构采集失败，请检查所选表的元数据权限") from exc
    return save_snapshot(ontology_id, source_id, {"database": source["database"], "tables": tables, "origin": "mysql"})


def save_snapshot(ontology_id: str, source_id: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    _source(ontology_id, source_id)
    if not isinstance(schema.get("tables"), list):
        raise repo.ValidationError("结构快照必须包含 tables 列表")
    for table in schema["tables"]:
        if not isinstance(table, dict) or not re.fullmatch(r"[\w.\-]+", str(table.get("name", ""))) or not isinstance(table.get("columns"), list):
            raise repo.ValidationError("表结构中的表名或字段列表无效")
        for column in table["columns"]:
            if not isinstance(column, dict) or not column.get("name") or not column.get("data_type"):
                raise repo.ValidationError("字段必须包含名称和数据类型")
    raw = json.dumps(schema, ensure_ascii=False, sort_keys=True)
    snapshot_id = hashlib.sha256((source_id + repo.now() + raw).encode()).hexdigest()[:24]
    captured_at = repo.now()
    conn = repo.get_conn()
    conn.execute("""INSERT INTO source_schema_snapshots
        (id,source_id,ontology_id,captured_at,schema_hash,schema_json) VALUES (?,?,?,?,?,?)""",
        (snapshot_id, source_id, ontology_id, captured_at, hashlib.sha256(raw.encode()).hexdigest(), raw))
    conn.commit()
    conn.close()
    return {"id": snapshot_id, "captured_at": captured_at, "table_count": len(schema["tables"]), "schema": schema}


def parse_mysql_ddl(text: str) -> Dict[str, Any]:
    """Parse a bounded CREATE TABLE subset; never execute the supplied SQL."""
    if len(text) > 2_000_000:
        raise repo.ValidationError("DDL 文件超过 2 MB，请按库表拆分")

    def split_columns(body: str) -> list[str]:
        parts, start, depth, quote = [], 0, 0, None
        for index, char in enumerate(body):
            if quote:
                if char == quote and (index == 0 or body[index - 1] != "\\"):
                    quote = None
            elif char in "'\"`": quote = char
            elif char == "(": depth += 1
            elif char == ")": depth -= 1
            elif char == "," and depth == 0:
                parts.append(body[start:index].strip()); start = index + 1
        parts.append(body[start:].strip())
        return [part for part in parts if part]

    tables = []
    pattern = re.compile(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`\w.]+)\s*\(", re.I)
    for match in pattern.finditer(text):
        name = match.group(1).split(".")[-1].strip("`")
        depth, close = 1, match.end()
        while close < len(text) and depth:
            if text[close] == "(": depth += 1
            elif text[close] == ")": depth -= 1
            close += 1
        if depth:
            raise repo.ValidationError(f"表 {name} 的括号未闭合")
        columns, references, primary, unique = [], [], set(), set()
        for clause in split_columns(text[match.end():close - 1]):
            key = re.search(r"\bPRIMARY\s+KEY\s*\(([^)]*)\)", clause, re.I)
            if key:
                primary.update(value.strip(" `") for value in key.group(1).split(","))
                continue
            key = re.search(r"\bUNIQUE\s+(?:KEY|INDEX)?\s*(?:[`\w]+)?\s*\(([^)]*)\)", clause, re.I)
            if key:
                unique.update(value.strip(" `") for value in key.group(1).split(","))
                continue
            ref = re.search(r"\bFOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([`\w.]+)\s*\(([^)]*)\)", clause, re.I)
            if ref:
                references.append({"column": ref.group(1).strip(" `"), "table": ref.group(2).split(".")[-1].strip("`"),
                                   "target_column": ref.group(3).strip(" `")})
                continue
            column = re.match(r"^`?([A-Za-z_][\w]*)`?\s+([A-Za-z][\w]*(?:\([^)]*\))?)", clause)
            if not column:
                continue
            comment = re.search(r"\bCOMMENT\s+'((?:[^'\\]|\\.)*)'", clause, re.I)
            columns.append({"name": column.group(1), "data_type": column.group(2).split("(")[0].lower(),
                            "column_type": column.group(2), "nullable": not bool(re.search(r"\bNOT\s+NULL\b", clause, re.I)),
                            "key": "", "comment": comment.group(1) if comment else ""})
        for column in columns:
            column["key"] = "PRI" if column["name"] in primary else "UNI" if column["name"] in unique else ""
        if not columns:
            raise repo.ValidationError(f"未从表 {name} 识别出字段，请检查 DDL 格式")
        tables.append({"name": name, "type": "BASE TABLE", "comment": "", "columns": columns, "references": references})
    if not tables:
        raise repo.ValidationError("未找到可解析的 MySQL CREATE TABLE 定义")
    return {"origin": "mysql-ddl", "tables": tables}


def latest_snapshot(ontology_id: str, source_id: str) -> Optional[Dict[str, Any]]:
    _source(ontology_id, source_id)
    conn = repo.get_conn()
    row = conn.execute("""SELECT * FROM source_schema_snapshots WHERE ontology_id=? AND source_id=?
        ORDER BY captured_at DESC, rowid DESC LIMIT 1""", (ontology_id, source_id)).fetchone()
    conn.close()
    return ({"id": row["id"], "captured_at": row["captured_at"],
             "schema_hash": row["schema_hash"], "schema": json.loads(row["schema_json"])} if row else None)
