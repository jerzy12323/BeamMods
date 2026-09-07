import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import time
import uuid
import zipfile
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
DB_PATH = DATA / "beammods.sqlite3"
MAX_ZIP_SIZE = 2 * 1024 * 1024 * 1024
SESSIONS = {}

DATA.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with db() as connection:
        connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
              email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
              is_owner INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mods (
              id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
              name TEXT NOT NULL, category TEXT NOT NULL, author TEXT NOT NULL,
              description TEXT NOT NULL, version TEXT NOT NULL, configs INTEGER NOT NULL,
              image_path TEXT, approved INTEGER NOT NULL DEFAULT 0,
              download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mod_versions (
              id INTEGER PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              version TEXT NOT NULL, zip_path TEXT NOT NULL, sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comments (
              id INTEGER PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ratings (
              mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL,
              PRIMARY KEY (mod_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS favorites (
              mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              user_id INTEGER NOT NULL REFERENCES users(id),
              PRIMARY KEY (mod_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS bug_reports (
              id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
              mod_id INTEGER REFERENCES mods(id), title TEXT NOT NULL,
              body TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180000).hex()
    return f"{salt}${digest}"


def verify_password(password, stored):
    salt, expected = stored.split("$", 1)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180000).hex()
    return secrets.compare_digest(actual, expected)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "BeamMods/1.0"

    def send_json(self, status, value, session_token=None):
        payload = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if session_token:
            self.send_header("Set-Cookie", f"beammods_session={session_token}; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1024 * 1024:
            raise ValueError("Request is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def user(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        jar.load(header)
        token = jar.get("beammods_session")
        if not token:
            return None
        user_id = SESSIONS.get(token.value)
        if not user_id:
            return None
        with db() as connection:
            return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    def require_user(self):
        user = self.user()
        if not user:
            self.send_json(401, {"error": "Sign in required"})
        return user

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/mods":
            with db() as connection:
                rows = connection.execute(
                    "SELECT m.*, u.username FROM mods m JOIN users u ON u.id=m.owner_id "
                    "WHERE m.approved=1 ORDER BY m.created_at DESC"
                ).fetchall()
            self.send_json(200, [dict(row) for row in rows])
            return
        if parsed.path.startswith("/api/mods/") and parsed.path.endswith("/comments"):
            mod_id = parsed.path.split("/")[3]
            with db() as connection:
                rows = connection.execute(
                    "SELECT c.*, u.username FROM comments c JOIN users u ON u.id=c.user_id "
                    "WHERE c.mod_id=? ORDER BY c.created_at ASC", (mod_id,)
                ).fetchall()
            self.send_json(200, [dict(row) for row in rows])
            return
        if parsed.path == "/api/me":
            user = self.user()
            self.send_json(200, dict(user) if user else None)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/auth/register":
                data = self.read_json()
                username, email, password = data["username"].strip(), data["email"].strip(), data["password"]
                if len(username) < 3 or len(password) < 8:
                    return self.send_json(400, {"error": "Username or password is too short"})
                with db() as connection:
                    cursor = connection.execute(
                        "INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)",
                        (username, email, password_hash(password), now()),
                    )
                    user_id = cursor.lastrowid
                return self.send_json(201, {"username": username, "email": email}, self.start_session(user_id))
            if parsed.path == "/api/auth/login":
                data = self.read_json()
                with db() as connection:
                    user = connection.execute("SELECT * FROM users WHERE email=?", (data["email"],)).fetchone()
                if not user or not verify_password(data["password"], user["password_hash"]):
                    return self.send_json(401, {"error": "Invalid email or password"})
                return self.send_json(200, dict(user), self.start_session(user["id"]))
            if parsed.path == "/api/auth/logout":
                self.clear_session()
                return self.send_json(204, {})
            user = self.require_user()
            if not user:
                return
            if parsed.path.startswith("/api/mods/") and parsed.path.endswith("/comments"):
                mod_id = parsed.path.split("/")[3]
                data = self.read_json()
                if not data.get("body", "").strip():
                    return self.send_json(400, {"error": "Comment cannot be empty"})
                with db() as connection:
                    connection.execute(
                        "INSERT INTO comments(mod_id,user_id,body,created_at) VALUES(?,?,?,?)",
                        (mod_id, user["id"], data["body"].strip(), now()),
                    )
                return self.send_json(201, {"ok": True})
            if parsed.path.startswith("/api/mods/") and parsed.path.endswith("/rate"):
                mod_id = parsed.path.split("/")[3]
                rating = int(self.read_json().get("rating", 0))
                if rating < 1 or rating > 5:
                    return self.send_json(400, {"error": "Rating must be between 1 and 5"})
                with db() as connection:
                    connection.execute(
                        "INSERT INTO ratings(mod_id,user_id,rating) VALUES(?,?,?) "
                        "ON CONFLICT(mod_id,user_id) DO UPDATE SET rating=excluded.rating",
                        (mod_id, user["id"], rating),
                    )
                return self.send_json(200, {"ok": True})
            if parsed.path.startswith("/api/mods/") and parsed.path.endswith("/favorite"):
                mod_id = parsed.path.split("/")[3]
                with db() as connection:
                    exists = connection.execute(
                        "SELECT 1 FROM favorites WHERE mod_id=? AND user_id=?", (mod_id, user["id"])
                    ).fetchone()
                    if exists:
                        connection.execute("DELETE FROM favorites WHERE mod_id=? AND user_id=?", (mod_id, user["id"]))
                        favorite = False
                    else:
                        connection.execute("INSERT INTO favorites(mod_id,user_id) VALUES(?,?)", (mod_id, user["id"]))
                        favorite = True
                return self.send_json(200, {"favorite": favorite})
        except (KeyError, ValueError, sqlite3.IntegrityError) as error:
            self.send_json(400, {"error": str(error)})

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = user_id
        return token

    def clear_session(self):
        token = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        jar.load(token)
        if jar.get("beammods_session"):
            SESSIONS.pop(jar["beammods_session"].value, None)
        self.send_response(204)
        self.send_header("Set-Cookie", "beammods_session=; Max-Age=0; Path=/")
        self.end_headers()

    def serve_static(self, path):
        requested = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in requested.parents and requested != ROOT:
            return self.send_error(403)
        if requested.is_dir():
            requested = ROOT / "index.html"
        if not requested.exists():
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8" if requested.suffix == ".html" else "text/plain")
        self.end_headers()
        with requested.open("rb") as stream:
            shutil.copyfileobj(stream, self.wfile)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"BeamMods backend: http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
