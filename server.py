"""Small, dependency-free BeamMods API.

If DATABASE_URL is set we use psycopg/psycopg2 when either is already installed.
Without a driver (or when the connection fails) the service deliberately falls
back to its local SQLite database, so a bad production setting cannot prevent
the application from starting.
"""
import io
import hashlib
from html import escape
import json
import mimetypes
import os
import secrets
import smtplib
import shutil
import sqlite3
import time
import uuid
import zipfile
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal
from email.message import EmailMessage
from email import policy
from email.parser import BytesParser
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DATA_DIR", str(ROOT / "data")))
UPLOADS = DATA / "uploads"
DB_PATH = DATA / "beammods.sqlite3"
MAX_UPLOAD = 95 * 1024 * 1024
SESSIONS = {}
GOOGLE_STATES = {}
PG = None

DATA.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)


def _postgres():
    global PG
    if PG is not None:
        return PG
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg
        PG = ("psycopg", psycopg)
    except ImportError:
        try:
            import psycopg2
            PG = ("psycopg2", psycopg2)
        except ImportError:
            PG = False
    return PG or None


def db():
    driver = _postgres()
    if driver:
        try:
            if driver[0] == "psycopg":
                from psycopg.rows import dict_row
                connection = driver[1].connect(os.environ["DATABASE_URL"], row_factory=dict_row)
            else:
                connection = driver[1].connect(os.environ["DATABASE_URL"],
                                                cursor_factory=driver[1].extras.RealDictCursor)
            if driver[0] == "psycopg2":
                connection.autocommit = False
            return connection
        except Exception:
            if os.environ.get("DATABASE_URL"):
                raise
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def execute(connection, sql, args=()):
    if not isinstance(connection, sqlite3.Connection):
        sql = sql.replace("?", "%s")
    return connection.execute(sql, args)


def rows(cursor):
    if isinstance(cursor, sqlite3.Cursor):
        return [dict(row) for row in cursor.fetchall()]
    return [dict(row) for row in cursor.fetchall()]


def inserted_id(connection, cursor):
    if isinstance(connection, sqlite3.Connection):
        return cursor.lastrowid
    row = cursor.fetchone()
    return row["id"] if isinstance(row, dict) else row[0]


OWNER_EMAIL = "beammodshub@gmail.com"
OWNER_USERNAME = "jerzy"
OWNER_USERNAMES = {"jerzy", "beamowner"}
PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://beammods.onrender.com").rstrip("/")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", f"{PUBLIC_URL}/api/auth/google/callback")


def is_owner_user(user):
    return bool(user and (user.get("is_owner") or
                          user.get("username", "").lower() in OWNER_USERNAMES or
                          user.get("email", "").lower() == OWNER_EMAIL))


def send_email(recipient, subject, body, html=None):
    host = os.environ.get("SMTP_HOST")
    username = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("MAIL_FROM", username or "")
    if not host or not username or not password or not sender:
        raise RuntimeError("Email service is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in Render.")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)


def init_db():
    with db() as connection:
        if isinstance(connection, sqlite3.Connection):
            schema = """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL, is_owner INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 0,
              activation_token TEXT, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mods (
              id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
              name TEXT NOT NULL, category TEXT NOT NULL, author TEXT NOT NULL, description TEXT NOT NULL,
              version TEXT NOT NULL, configs INTEGER NOT NULL DEFAULT 0, image_path TEXT,
              download_url TEXT, approved INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mod_versions (
              id INTEGER PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              version TEXT NOT NULL, zip_path TEXT NOT NULL, original_filename TEXT, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS comments (
              id INTEGER PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ratings (
              mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
              rating INTEGER NOT NULL, PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS favorites (
              mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
              PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS mod_downloads (
              mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
              created_at TEXT NOT NULL, PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS bug_reports (
              id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), mod_id INTEGER REFERENCES mods(id),
              title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL);
            """
        else:
            schema = """
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL, is_owner INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 0,
              activation_token TEXT, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mods (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
              category TEXT NOT NULL, author TEXT NOT NULL, description TEXT NOT NULL, version TEXT NOT NULL, configs INTEGER NOT NULL DEFAULT 0,
              image_path TEXT, download_url TEXT, approved INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mod_versions (id SERIAL PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              version TEXT NOT NULL, zip_path TEXT NOT NULL, original_filename TEXT, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS comments (id SERIAL PRIMARY KEY, mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
              user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ratings (mod_id INTEGER REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id),
              rating INTEGER NOT NULL, PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS favorites (mod_id INTEGER REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id),
              PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS mod_downloads (mod_id INTEGER REFERENCES mods(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id),
              created_at TEXT NOT NULL, PRIMARY KEY(mod_id,user_id));
            CREATE TABLE IF NOT EXISTS bug_reports (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
              mod_id INTEGER REFERENCES mods(id), title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL);
            """
        if isinstance(connection, sqlite3.Connection):
            connection.executescript(schema)
        else:
            for statement in schema.split(";"):
                if statement.strip():
                    execute(connection, statement)
        if isinstance(connection, sqlite3.Connection):
            columns = {row[1] for row in connection.execute("PRAGMA table_info(mod_versions)")}
            if "original_filename" not in columns:
                connection.execute("ALTER TABLE mod_versions ADD COLUMN original_filename TEXT")
            mod_columns = {row[1] for row in connection.execute("PRAGMA table_info(mods)")}
            if "download_url" not in mod_columns:
                connection.execute("ALTER TABLE mods ADD COLUMN download_url TEXT")
            user_columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
            if "is_active" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0")
            if "activation_token" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN activation_token TEXT")
            if "reset_token" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN reset_token TEXT")
            if "reset_expires_at" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN reset_expires_at TEXT")
            mod_columns = {row[1] for row in connection.execute("PRAGMA table_info(mods)")}
            if "download_url" not in mod_columns:
                connection.execute("ALTER TABLE mods ADD COLUMN download_url TEXT")
        else:
            column = execute(connection, "SELECT 1 FROM information_schema.columns "
                              "WHERE table_name='mod_versions' AND column_name='original_filename'").fetchone()
            if not column:
                execute(connection, "ALTER TABLE mod_versions ADD COLUMN original_filename TEXT")
            column = execute(connection, "SELECT 1 FROM information_schema.columns "
                              "WHERE table_name='mods' AND column_name='download_url'").fetchone()
            if not column:
                execute(connection, "ALTER TABLE mods ADD COLUMN download_url TEXT")
            for name, definition in (("is_active", "INTEGER NOT NULL DEFAULT 0"), ("activation_token", "TEXT")):
                column = execute(connection, "SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name=?", (name,)).fetchone()
                if not column:
                    execute(connection, f"ALTER TABLE users ADD COLUMN {name} {definition}")
            for name, definition in (("reset_token", "TEXT"), ("reset_expires_at", "TEXT")):
                column = execute(connection, "SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name=?", (name,)).fetchone()
                if not column:
                    execute(connection, f"ALTER TABLE users ADD COLUMN {name} {definition}")
            column = execute(connection, "SELECT 1 FROM information_schema.columns WHERE table_name='mods' AND column_name='download_url'").fetchone()
            if not column:
                execute(connection, "ALTER TABLE mods ADD COLUMN download_url TEXT")
        if not isinstance(connection, sqlite3.Connection):
            connection.commit()


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180000).hex()
    return f"{salt}${digest}"


def verify_password(password, stored):
    salt, expected = stored.split("$", 1)
    return secrets.compare_digest(hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180000).hex(), expected)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, default=json_value).encode("utf-8")


def json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


class Handler(BaseHTTPRequestHandler):
    server_version = "BeamMods/1.1"

    def send_json(self, status, value, session_token=None):
        payload = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if session_token:
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
            self.send_header("Set-Cookie", f"beammods_session={session_token}; HttpOnly; SameSite=Lax; Path=/{secure}")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 4 * 1024 * 1024:
            raise ValueError("Request is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def user(self):
        jar = cookies.SimpleCookie()
        jar.load(self.headers.get("Cookie", ""))
        token = jar.get("beammods_session")
        user_id = SESSIONS.get(token.value) if token else None
        if not user_id and token:
            with db() as connection:
                session = execute(connection, "SELECT user_id FROM sessions WHERE token=?", (token.value,)).fetchone()
                user_id = session["user_id"] if isinstance(session, dict) else (session[0] if session else None)
        if not user_id:
            return None
        with db() as connection:
            cursor = execute(connection, "SELECT * FROM users WHERE id=?", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def public_user(self):
        user = self.user()
        if not user:
            return None
        return {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "is_owner": int(is_owner_user(user)),
            "created_at": user["created_at"],
        }

    def require_user(self):
        user = self.user()
        if not user:
            self.send_json(401, {"error": "Sign in required"})
        return user

    def mod(self, mod_id, include_unapproved=False):
        with db() as connection:
            where = "" if include_unapproved else " AND m.approved=1"
            cursor = execute(connection, "SELECT m.*, (SELECT original_filename FROM mod_versions WHERE mod_id=m.id ORDER BY id DESC LIMIT 1) AS original_filename, COALESCE(AVG(r.rating),0) AS rating, "
                "COUNT(DISTINCT r.user_id) AS rating_count, COUNT(DISTINCT f.user_id) AS favorite_count "
                "FROM mods m JOIN users u ON u.id=m.owner_id LEFT JOIN ratings r ON r.mod_id=m.id "
                "LEFT JOIN favorites f ON f.mod_id=m.id WHERE m.id=?"+where+" GROUP BY m.id,u.username", (mod_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self.send_json(200, {"status": "ok"})
        if parsed.path == "/api/auth/google":
            client_id = os.environ.get("GOOGLE_CLIENT_ID")
            client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
            if not client_id or not client_secret:
                return self.send_json(503, {"error": "Google login is not configured on the server"})
            state = secrets.token_urlsafe(32)
            GOOGLE_STATES[state] = time.time()
            query = urllib.parse.urlencode({
                "client_id": client_id,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "access_type": "online",
                "prompt": "select_account",
            })
            self.send_response(302)
            self.send_header("Location", f"https://accounts.google.com/o/oauth2/v2/auth?{query}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if parsed.path == "/api/auth/google/callback":
            return self.google_callback(parsed)
        if parsed.path == "/api/me":
            return self.send_json(200, self.public_user())
        if parsed.path == "/api/auth/activate":
            token = parse_qs(urlparse(self.path).query).get("token", [""])[0]
            if not token:
                return self.send_json(400, {"error": "Activation token is missing"})
            with db() as connection:
                user = execute(connection, "SELECT id,email,username FROM users WHERE activation_token=?", (token,)).fetchone()
                if not user:
                    return self.send_json(400, {"error": "This activation link is invalid or already used"})
                user_id = user["id"] if isinstance(user, dict) else user[0]
                email = user["email"] if isinstance(user, dict) else user[1]
                username = user["username"] if isinstance(user, dict) else user[2]
                execute(connection, "UPDATE users SET is_active=1, activation_token=NULL WHERE id=?", (user_id,))
            try:
                send_email(email, "BeamMods account activated", f"Hi {username},\n\nYour BeamMods account is now active. You can sign in at {PUBLIC_URL}/")
            except RuntimeError:
                pass
            return self.send_json(200, {"ok": True, "message": "Your account is active. You can now sign in."})
        if parsed.path == "/api/mods/pending":
            user = self.require_user()
            if not is_owner_user(user):
                return self.send_json(403, {"error": "Owner access required"})
            with db() as connection:
                result = rows(execute(connection, "SELECT m.*, "
                    "(SELECT original_filename FROM mod_versions WHERE mod_id=m.id ORDER BY id DESC LIMIT 1) AS original_filename, "
                    "u.username FROM mods m JOIN users u ON u.id=m.owner_id WHERE m.approved=0 "
                    "ORDER BY m.created_at ASC"))
            return self.send_json(200, result)
        if parsed.path == "/api/mods/mine":
            user = self.require_user()
            if not user:
                return
            with db() as connection:
                result = rows(execute(connection, "SELECT m.*, "
                    "(SELECT original_filename FROM mod_versions WHERE mod_id=m.id ORDER BY id DESC LIMIT 1) AS original_filename, "
                    "u.username, COALESCE(AVG(r.rating),0) AS rating, COUNT(DISTINCT f.user_id) AS favorite_count "
                    "FROM mods m JOIN users u ON u.id=m.owner_id LEFT JOIN ratings r ON r.mod_id=m.id "
                    "LEFT JOIN favorites f ON f.mod_id=m.id WHERE m.owner_id=? "
                    "GROUP BY m.id,u.username ORDER BY m.created_at DESC", (user["id"],)))
            return self.send_json(200, result)
        if parsed.path == "/api/mods":
            with db() as connection:
                result = rows(execute(connection, "SELECT m.*, (SELECT original_filename FROM mod_versions WHERE mod_id=m.id ORDER BY id DESC LIMIT 1) AS original_filename, u.username, COALESCE(AVG(r.rating),0) AS rating, "
                    "COUNT(DISTINCT f.user_id) AS favorite_count FROM mods m JOIN users u ON u.id=m.owner_id "
                    "LEFT JOIN ratings r ON r.mod_id=m.id LEFT JOIN favorites f ON f.mod_id=m.id WHERE m.approved=1 "
                    "GROUP BY m.id,u.username ORDER BY m.created_at DESC"))
            return self.send_json(200, result)
        if parsed.path == "/api/reports":
            user = self.require_user()
            if not is_owner_user(user):
                return self.send_json(403, {"error": "Owner access required"})
            with db() as connection:
                return self.send_json(200, rows(execute(connection,
                    "SELECT r.*, u.username, u.email FROM bug_reports r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC")))
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "mods":
            mod_id = parts[2]
            if len(parts) == 4 and parts[3] == "download":
                return self.download(mod_id)
            if len(parts) == 4 and parts[3] in ("comments", "ratings", "favorites"):
                table = parts[3]
                with db() as connection:
                    if table == "comments":
                        result = rows(execute(connection, "SELECT c.*,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.mod_id=? ORDER BY c.created_at", (mod_id,)))
                    elif table == "ratings":
                        result = rows(execute(connection, "SELECT rating,COUNT(*) AS count FROM ratings WHERE mod_id=? GROUP BY rating ORDER BY rating", (mod_id,)))
                    else:
                        result = rows(execute(connection, "SELECT COUNT(*) AS count FROM favorites WHERE mod_id=?", (mod_id,)))
                        user = self.user()
                        result = {"count": result[0]["count"] if result else 0,
                                  "liked": bool(user and execute(connection, "SELECT 1 FROM favorites WHERE mod_id=? AND user_id=?", (mod_id,)).fetchone())}
                return self.send_json(200, result)
            item = self.mod(mod_id)
            if item:
                return self.send_json(200, item)
            return self.send_json(404, {"error": "Mod not found"})
        return self.serve_static(parsed.path)

    def google_callback(self, parsed):
        state = parse_qs(parsed.query).get("state", [""])[0]
        code = parse_qs(parsed.query).get("code", [""])[0]
        error = parse_qs(parsed.query).get("error", [""])[0]
        issued_at = GOOGLE_STATES.pop(state, None)
        if error:
            return self.redirect_home("google_error=" + urllib.parse.quote(error))
        if not code or not issued_at or time.time() - issued_at > 600:
            return self.redirect_home("google_error=invalid_state")
        client_id = os.environ.get("GOOGLE_CLIENT_ID")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
        if not client_id or not client_secret:
            return self.redirect_home("google_error=not_configured")
        try:
            token_request = urllib.request.Request(
                "https://oauth2.googleapis.com/token",
                data=urllib.parse.urlencode({
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                }).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib.request.urlopen(token_request, timeout=20) as response:
                token_data = json.loads(response.read())
            access_token = token_data.get("access_token")
            if not access_token:
                raise ValueError("Google did not return an access token")
            profile_request = urllib.request.Request(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            with urllib.request.urlopen(profile_request, timeout=20) as response:
                profile = json.loads(response.read())
            email = str(profile.get("email", "")).strip().lower()
            if not email or not profile.get("email_verified"):
                raise ValueError("Google account email is not verified")
            display_name = str(profile.get("name") or email.split("@", 1)[0]).strip()
            username = self.google_username(display_name, email)
            created_account = False
            with db() as connection:
                user = execute(connection, "SELECT * FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
                if user:
                    user_id = user["id"] if isinstance(user, dict) else user[0]
                    if not user["is_active"]:
                        return self.redirect_home("google_error=activation_required")
                else:
                    password = secrets.token_urlsafe(32)
                    owner = username.lower() == OWNER_USERNAME or email == OWNER_EMAIL
                    activation_token = secrets.token_urlsafe(32)
                    statement = "INSERT INTO users(username,email,password_hash,is_owner,is_active,activation_token,created_at) VALUES(?,?,?,?,?,?,?)"
                    if not isinstance(connection, sqlite3.Connection):
                        statement += " RETURNING id"
                    cursor = execute(connection, statement, (username, email, password_hash(password), int(owner), 0, activation_token, now()))
                    user_id = inserted_id(connection, cursor)
                    created_account = True
                    activation_url = f"{PUBLIC_URL}/?activation={quote(activation_token)}"
                    send_email(
                        email,
                        "Welcome to BeamMods — activate your Google account",
                        f"Welcome to BeamMods, {username}!\n\nConfirm your email to finish signing in:\n\n{activation_url}\n\n"
                        "This link can be used once. If you did not create this account, you can ignore this email.\n\nBeamMods",
                        f"""<!doctype html><html lang="en"><body style="margin:0;background:#0d1520;color:#e9eef2;font-family:Arial,sans-serif;">
<div style="padding:42px 18px;background:#0d1520;"><div style="max-width:540px;margin:0 auto;text-align:center;">
<div style="font-size:28px;font-weight:800;color:#ff6746;">Beam<span style="color:#f5f7f8;">Mods</span></div>
<div style="margin-top:26px;padding:34px 30px;border:1px solid #314256;border-radius:18px;background:#172334;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9aaebe;">Google account setup</div>
<h1 style="margin:14px 0 12px;color:#f5f7f8;">Confirm your email</h1>
<p style="color:#b8c6d0;font-size:15px;line-height:1.65;">Your Google account is almost ready. Confirm your email before you enter the BeamMods garage.</p>
<a href="{activation_url}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#ff6746;color:#101923;text-decoration:none;font-weight:800;">Activate account&nbsp; ↗</a>
<p style="margin:25px 0 0;color:#8293a1;font-size:12px;">This link can be used once.</p></div>
<p style="margin:24px 0 0;color:#718393;font-size:12px;">BeamMods · Your garage. Unlimited.</p></div></div></body></html>"""
                    )
            if created_account:
                return self.redirect_home("google_error=activation_required")
            return self.redirect_home("", self.start_session(user_id))
        except (urllib.error.URLError, json.JSONDecodeError, ValueError, sqlite3.Error, OSError) as error:
            print(f"Google OAuth failed: {error}")
            return self.redirect_home("google_error=login_failed")

    def google_username(self, display_name, email):
        base = "".join(character for character in display_name if character.isalnum() or character in "_-").lower()[:20] or "googleuser"
        candidate = base
        suffix = 2
        with db() as connection:
            while execute(connection, "SELECT 1 FROM users WHERE lower(username)=lower(?)", (candidate,)).fetchone():
                candidate = f"{base[:max(3, 24 - len(str(suffix)) - 1)]}-{suffix}"
                suffix += 1
        return candidate

    def redirect_home(self, query="", session_token=None):
        self.send_response(302)
        self.send_header("Location", f"{PUBLIC_URL}/" + (f"?{query}" if query else ""))
        if session_token:
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
            self.send_header("Set-Cookie", f"beammods_session={session_token}; HttpOnly; SameSite=Lax; Path=/{secure}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def parse_upload(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_UPLOAD:
            raise ValueError("Invalid upload size")
        body = self.rfile.read(length)
        if "multipart/form-data" not in self.headers.get("Content-Type", ""):
            return json.loads(body or b"{}"), None, None
        message = BytesParser(policy=policy.default).parsebytes(
            ("Content-Type: " + self.headers["Content-Type"] +
             "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
        fields = {}
        files = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            filename = part.get_filename()
            if filename:
                files[name] = type("Upload", (), {
                    "filename": filename, "file": io.BytesIO(part.get_payload(decode=True) or b"")
                })()
            else:
                fields[name] = part.get_payload(decode=True).decode("utf-8", "replace")
        data = fields
        upload = files.get("zip") or files.get("file")
        preview = files.get("preview") or files.get("image")
        return data, upload, preview

    def save_upload(self, upload, preview, mod_id):
        zip_path = image_path = None
        if upload is not None and getattr(upload, "filename", None):
            if not str(upload.filename).lower().endswith(".zip"):
                raise ValueError("Only ZIP uploads are supported")
            content = upload.file.read()
            if not zipfile.is_zipfile(io.BytesIO(content)):
                raise ValueError("Invalid ZIP archive")
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                for name in archive.namelist():
                    if Path(name).is_absolute() or ".." in Path(name).parts:
                        raise ValueError("Unsafe ZIP path")
            zip_path = f"uploads/{uuid.uuid4().hex}.zip"
            (DATA / zip_path).write_bytes(content)
        if preview is not None and getattr(preview, "filename", None):
            ext = Path(preview.filename).suffix.lower()
            if ext not in (".png", ".jpg", ".jpeg", ".webp"):
                raise ValueError("Unsupported preview image")
            image_path = f"uploads/{uuid.uuid4().hex}{ext}"
            (DATA / image_path).write_bytes(preview.file.read())
        return zip_path, image_path

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/auth/register":
                data = self.read_json()
                email = str(data.get("email", "")).strip()
                if len(data["username"].strip()) < 3 or len(data["password"]) < 8:
                    return self.send_json(400, {"error": "Username or password is too short"})
                if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
                    return self.send_json(400, {"error": "A valid email address is required"})
                activation_token = secrets.token_urlsafe(32)
                with db() as connection:
                    existing = execute(connection, "SELECT 1 FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)",
                                       (data["username"].strip(), email)).fetchone()
                    if existing:
                        return self.send_json(409, {"error": "That username or email is already registered"})
                    owner = data["username"].strip().lower() == OWNER_USERNAME or email.lower() == OWNER_EMAIL
                    statement = "INSERT INTO users(username,email,password_hash,is_owner,is_active,activation_token,created_at) VALUES(?,?,?,?,?,?,?)"
                    if not isinstance(connection, sqlite3.Connection):
                        statement += " RETURNING id"
                    cursor = execute(connection, statement,
                                     (data["username"].strip(), email, password_hash(data["password"]), int(owner), 0, activation_token, now()))
                    uid = inserted_id(connection, cursor)
                    activation_url = f"{PUBLIC_URL}/?activation={quote(activation_token)}"
                    username_display = data["username"].strip()
                    username_html = escape(username_display)
                    send_email(email, "Welcome to BeamMods — activate your account",
                               f"Welcome to BeamMods, {username_display}!\n\n"
                               "Your account is almost ready. Confirm your email here:\n\n"
                               f"{activation_url}\n\n"
                               "This activation link can be used once. If you did not create this account, you can safely ignore this message.\n\n"
                               "BeamMods\nYour garage. Unlimited.",
                               f"""<!doctype html>
<html lang="en">
<body style="margin:0;background:#0d1520;color:#e9eef2;font-family:Arial,sans-serif;">
  <div style="padding:42px 18px;background:#0d1520;">
    <div style="max-width:540px;margin:0 auto;text-align:center;">
      <div style="font-size:28px;font-weight:800;letter-spacing:-1px;color:#ff6746;">Beam<span style="color:#f5f7f8;">Mods</span></div>
      <div style="margin-top:26px;padding:34px 30px;border:1px solid #314256;border-radius:18px;background:#172334;text-align:center;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9aaebe;">Welcome to the garage</div>
        <h1 style="margin:14px 0 12px;font-size:28px;color:#f5f7f8;">Confirm your account</h1>
        <p style="margin:0 auto 26px;max-width:410px;color:#b8c6d0;font-size:15px;line-height:1.65;">
          Hi {username_html}, your BeamMods account is almost ready. Confirm your email to start publishing and discovering mods.
        </p>
        <a href="{activation_url}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#ff6746;color:#101923;text-decoration:none;font-weight:800;font-size:14px;">Confirm email address&nbsp; ↗</a>
        <p style="margin:25px 0 0;color:#8293a1;font-size:12px;line-height:1.6;">This link can be used once. If you did not create this account, you can ignore this email.</p>
      </div>
      <p style="margin:24px 0 0;color:#718393;font-size:12px;">BeamMods · Your garage. Unlimited.</p>
    </div>
  </div>
</body>
</html>""")
                    send_email(email, "BeamMods registration received",
                               f"We received your BeamMods registration for {data['username'].strip()}.\n\n"
                               "Use the activation email to finish creating your account.")
                return self.send_json(201, {"username": data["username"], "email": email, "is_owner": owner,
                                            "message": "Account created. Check your inbox for your BeamMods activation link."})
            if parsed.path == "/api/auth/forgot-password":
                data = self.read_json()
                email = str(data.get("email", "")).strip().lower()
                if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
                    return self.send_json(400, {"error": "Enter a valid email address."})
                with db() as connection:
                    user = execute(connection, "SELECT id,username FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
                    if not user:
                        return self.send_json(404, {"error": "No BeamMods account was found with that email."})
                    token = secrets.token_urlsafe(32)
                    expires = str(int(time.time()) + 3600)
                    execute(connection, "UPDATE users SET reset_token=?, reset_expires_at=? WHERE lower(email)=lower(?)",
                            (token, expires, email))
                    username = user["username"] if isinstance(user, dict) else user[1]
                reset_url = f"{PUBLIC_URL}/?reset={quote(token)}"
                username_html = escape(username)
                send_email(email, "Reset your BeamMods password",
                           f"Hi {username},\n\n"
                           "We received a request to reset your BeamMods password.\n\n"
                           "Use this secure link within the next hour:\n\n"
                           f"{reset_url}\n\n"
                           "If you did not request this, you can ignore this email. Your current password will remain unchanged.\n\n"
                           "BeamMods\nYour garage. Unlimited.",
                           f"""<!doctype html>
<html lang="en">
<body style="margin:0;background:#0d1520;color:#e9eef2;font-family:Arial,sans-serif;">
  <div style="padding:42px 18px;background:#0d1520;">
    <div style="max-width:540px;margin:0 auto;text-align:center;">
      <div style="font-size:28px;font-weight:800;letter-spacing:-1px;color:#ff6746;">Beam<span style="color:#f5f7f8;">Mods</span></div>
      <div style="margin-top:26px;padding:34px 30px;border:1px solid #314256;border-radius:18px;background:#172334;text-align:center;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9aaebe;">Account recovery</div>
        <h1 style="margin:14px 0 12px;font-size:28px;color:#f5f7f8;">Reset your password</h1>
        <p style="margin:0 auto 26px;max-width:410px;color:#b8c6d0;font-size:15px;line-height:1.65;">
          Hi {username_html}, we received a request to create a new password for your BeamMods account.
        </p>
        <a href="{reset_url}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#ff6746;color:#101923;text-decoration:none;font-weight:800;font-size:14px;">Reset password&nbsp; ↗</a>
        <p style="margin:25px 0 0;color:#8293a1;font-size:12px;line-height:1.6;">This secure link expires in one hour and can only be used once.</p>
      </div>
      <p style="margin:24px 0 0;color:#718393;font-size:12px;">If you did not request this, your current password remains unchanged.</p>
      <p style="margin:8px 0 0;color:#718393;font-size:12px;">BeamMods · Your garage. Unlimited.</p>
    </div>
  </div>
</body>
</html>""")
                return self.send_json(200, {"message": "A password reset link has been sent to your email."})
            if parsed.path == "/api/auth/reset-password":
                data = self.read_json()
                token = str(data.get("token", "")).strip()
                password = str(data.get("password", ""))
                if len(password) < 8:
                    return self.send_json(400, {"error": "Password must be at least 8 characters."})
                with db() as connection:
                    user = execute(connection, "SELECT id FROM users WHERE reset_token=? AND reset_expires_at IS NOT NULL",
                                   (token,)).fetchone()
                    if not user:
                        return self.send_json(400, {"error": "This password reset link is invalid or expired."})
                    user_id = user["id"] if isinstance(user, dict) else user[0]
                    expires = execute(connection, "SELECT reset_expires_at FROM users WHERE id=?", (user_id,)).fetchone()
                    expires_value = expires["reset_expires_at"] if isinstance(expires, dict) else expires[0]
                    if int(expires_value) < int(time.time()):
                        return self.send_json(400, {"error": "This password reset link has expired. Request a new one."})
                    execute(connection, "UPDATE users SET password_hash=?, reset_token=NULL, reset_expires_at=NULL WHERE id=?",
                            (password_hash(password), user_id))
                return self.send_json(200, {"message": "Your password has been changed. You can now sign in."})
            if parsed.path == "/api/auth/login":
                data = self.read_json()
                with db() as connection:
                    user = execute(connection, "SELECT * FROM users WHERE lower(email)=lower(?) OR lower(username)=lower(?)",
                                   (data.get("identifier", data.get("email", "")), data.get("identifier", data.get("email", "")))).fetchone()
                if not user:
                    return self.send_json(404, {"error": "No BeamMods account was found with that email or username. Create an account first."})
                if not verify_password(data["password"], user["password_hash"]):
                    return self.send_json(401, {"error": "Invalid email or password"})
                if not user["is_active"]:
                    return self.send_json(403, {"error": "Activate your account using the link sent to your email first."})
                return self.send_json(200, dict(user), self.start_session(user["id"]))
            if parsed.path == "/api/auth/logout":
                self.clear_session()
                return
            user = self.require_user()
            if not user:
                return
            parts = parsed.path.strip("/").split("/")
            if parsed.path == "/api/reports":
                data = self.read_json()
                if not str(data.get("modName", "")).strip() or not str(data.get("details", "")).strip():
                    raise ValueError("Mod name and details are required")
                with db() as connection:
                    execute(connection, "INSERT INTO bug_reports(user_id,title,body,created_at) VALUES(?,?,?,?)",
                            (user["id"], str(data["modName"]).strip(), f"{data.get('type', 'Other')}: {data['details'].strip()}", now()))
                return self.send_json(201, {"ok": True})
            if parsed.path == "/api/mods":
                data, upload, preview = self.parse_upload()
                required = ("name", "category", "author", "description", "version")
                if any(not str(data.get(k, "")).strip() for k in required):
                    raise ValueError("name, category, author, description and version are required")
                if not upload and not str(data.get("downloadUrl", "")).strip():
                    raise ValueError("Choose a ZIP file or provide a download link")
                zip_path, image_path = self.save_upload(upload, preview, None)
                with db() as connection:
                    statement = "INSERT INTO mods(owner_id,name,category,author,description,version,configs,image_path,download_url,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
                    if not isinstance(connection, sqlite3.Connection):
                        statement += " RETURNING id"
                    cur = execute(connection, statement,
                                  (user["id"], *(str(data[k]).strip() for k in required), int(data.get("configs", 0)), image_path,
                                   str(data.get("downloadUrl", "")).strip() or None, 0, now()))
                    mod_id = inserted_id(connection, cur)
                    if zip_path:
                        execute(connection, "INSERT INTO mod_versions(mod_id,version,zip_path,original_filename,sha256,created_at) VALUES(?,?,?,?,?,?)",
                                (mod_id, data["version"], zip_path, upload.filename, hashlib.sha256((DATA / zip_path).read_bytes()).hexdigest(), now()))
                return self.send_json(201, {
                    "id": mod_id,
                    "name": str(data["name"]).strip(),
                    "category": str(data["category"]).strip(),
                    "author": str(data["author"]).strip(),
                    "description": str(data["description"]).strip(),
                    "version": str(data["version"]).strip(),
                    "configs": int(data.get("configs", 0)),
                    "download_url": str(data.get("downloadUrl", "")).strip(),
                    "approved": 0,
                    "created_at": now(),
                    "username": user["username"],
                    "image_path": image_path,
                    "original_filename": upload.filename if upload else None
                })
            if len(parts) >= 4 and parts[1] == "mods" and parts[3] == "comments":
                data = self.read_json()
                if not data.get("body", "").strip(): raise ValueError("Comment cannot be empty")
                with db() as c: execute(c, "INSERT INTO comments(mod_id,user_id,body,created_at) VALUES(?,?,?,?)", (parts[2], user["id"], data["body"].strip(), now()))
                return self.send_json(201, {"ok": True})
            if len(parts) >= 4 and parts[1] == "mods" and parts[3] in ("rate", "ratings"):
                rating = int(self.read_json().get("rating", 0))
                if not 1 <= rating <= 5: raise ValueError("Rating must be between 1 and 5")
                with db() as c:
                    execute(c, "INSERT INTO ratings(mod_id,user_id,rating) VALUES(?,?,?) ON CONFLICT(mod_id,user_id) DO UPDATE SET rating=excluded.rating", (parts[2], user["id"], rating))
                return self.send_json(200, {"ok": True})
            if len(parts) >= 4 and parts[1] == "mods" and parts[3] in ("favorite", "favorites"):
                with db() as c:
                    found = execute(c, "SELECT 1 FROM favorites WHERE mod_id=? AND user_id=?", (parts[2], user["id"])).fetchone()
                    if found:
                        state = True
                    else:
                        execute(c, "INSERT INTO favorites(mod_id,user_id) VALUES(?,?)", (parts[2], user["id"])); state = True
                    count = execute(c, "SELECT COUNT(*) AS count FROM favorites WHERE mod_id=?", (parts[2],)).fetchone()
                return self.send_json(200, {"favorite": state, "count": count["count"] if isinstance(count, dict) else count[0]})
            if len(parts) >= 4 and parts[1] == "mods" and parts[3] == "download":
                with db() as c:
                    inserted = execute(c, "INSERT INTO mod_downloads(mod_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT(mod_id,user_id) DO NOTHING",
                                        (parts[2], user["id"], now()))
                    if inserted.rowcount:
                        execute(c, "UPDATE mods SET download_count=download_count+1 WHERE id=?", (parts[2],))
                    count = execute(c, "SELECT download_count FROM mods WHERE id=?", (parts[2],)).fetchone()
                return self.send_json(200, {"count": (count["download_count"] if isinstance(count, dict) else count[0]) if count else 0})
        except RuntimeError as error:
            self.send_json(503, {"error": str(error)})
        except (KeyError, ValueError, sqlite3.IntegrityError, OSError) as error:
            self.send_json(400, {"error": str(error)})

    def do_PATCH(self):
        self.do_PUT()

    def do_PUT(self):
        try:
            parts = self.path.strip("/").split("/")
            user = self.require_user()
            if not user:
                return
            if self.path.split("?", 1)[0] == "/api/me":
                data = self.read_json()
                username = str(data.get("username", "")).strip()
                if not 3 <= len(username) <= 24 or not all(character.isalnum() or character in "_-" for character in username):
                    return self.send_json(400, {"error": "Username must be 3-24 characters and use only letters, numbers, _ or -"})
                with db() as c:
                    existing = execute(c, "SELECT id FROM users WHERE lower(username)=lower(?) AND id<>?",
                                       (username, user["id"])).fetchone()
                    if existing:
                        return self.send_json(409, {"error": "That username is already taken"})
                    execute(c, "UPDATE users SET username=? WHERE id=?", (username, user["id"]))
                return self.send_json(200, self.public_user())
            if len(parts) != 3 or parts[:2] != ["api", "mods"]:
                return
            data = self.read_json()
            with db() as c:
                owner = execute(c, "SELECT owner_id FROM mods WHERE id=?", (parts[2],)).fetchone()
                if not owner:
                    return self.send_json(404, {"error": "Mod not found"})
                owner_id = owner["owner_id"] if isinstance(owner, dict) else owner[0]
                if owner_id != user["id"] and not is_owner_user(user):
                    return self.send_json(403, {"error": "Owner access required"})
                allowed = ("name", "category", "author", "description", "version", "configs", "approved")
                values = [(k, data[k]) for k in allowed if k in data]
                if values:
                    execute(c, "UPDATE mods SET "+",".join(k+"=?" for k, _ in values)+" WHERE id=?",
                            [v for _, v in values]+[parts[2]])
            updated = self.mod(parts[2], True)
            if not updated:
                return self.send_json(404, {"error": "Mod not found"})
            return self.send_json(200, updated)
        except (KeyError, ValueError, sqlite3.Error, OSError) as error:
            return self.send_json(400, {"error": str(error)})

    def do_DELETE(self):
        try:
            parts = self.path.strip("/").split("/")
            user = self.require_user()
            if not user:
                return
            if self.path.split("?", 1)[0] == "/api/me":
                with db() as connection:
                    mod_ids = [row["id"] if isinstance(row, dict) else row[0]
                               for row in execute(connection, "SELECT id FROM mods WHERE owner_id=?", (user["id"],)).fetchall()]
                    for mod_id in mod_ids:
                        execute(connection, "DELETE FROM bug_reports WHERE mod_id=?", (mod_id,))
                        execute(connection, "DELETE FROM comments WHERE mod_id=?", (mod_id,))
                        execute(connection, "DELETE FROM ratings WHERE mod_id=?", (mod_id,))
                        execute(connection, "DELETE FROM favorites WHERE mod_id=?", (mod_id,))
                        execute(connection, "DELETE FROM mod_downloads WHERE mod_id=?", (mod_id,))
                        execute(connection, "DELETE FROM mod_versions WHERE mod_id=?", (mod_id,))
                    execute(connection, "DELETE FROM mods WHERE owner_id=?", (user["id"],))
                    execute(connection, "DELETE FROM comments WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM ratings WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM favorites WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM mod_downloads WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM bug_reports WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM sessions WHERE user_id=?", (user["id"],))
                    execute(connection, "DELETE FROM users WHERE id=?", (user["id"],))
                return self.clear_session()
            if len(parts) == 3 and parts[:2] == ["api", "reports"]:
                if not is_owner_user(user):
                    return self.send_json(403, {"error": "Owner access required"})
                with db() as c:
                    deleted = execute(c, "DELETE FROM bug_reports WHERE id=?", (parts[2],))
                    if deleted.rowcount == 0:
                        return self.send_json(404, {"error": "Report not found"})
                self.send_response(204)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if len(parts) != 3 or parts[:2] != ["api", "mods"]:
                return
            with db() as c:
                owner = execute(c, "SELECT owner_id FROM mods WHERE id=?", (parts[2],)).fetchone()
                if not owner:
                    return self.send_json(404, {"error": "Mod not found"})
                owner_id = owner["owner_id"] if isinstance(owner, dict) else owner[0]
                if owner_id != user["id"] and not is_owner_user(user):
                    return self.send_json(403, {"error": "Owner access required"})
                execute(c, "DELETE FROM mods WHERE id=?", (parts[2],))
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except (sqlite3.Error, OSError, ValueError) as error:
            return self.send_json(400, {"error": str(error)})

    def download(self, mod_id):
        user = self.require_user()
        if not user:
            return
        with db() as c:
            version = execute(c, "SELECT v.zip_path, v.original_filename, m.name AS mod_name "
                                "FROM mod_versions v JOIN mods m ON m.id=v.mod_id "
                                "WHERE v.mod_id=? ORDER BY v.id DESC", (mod_id,)).fetchone()
            if not version: return self.send_json(404, {"error": "Download not found"})
            inserted = execute(c, "INSERT INTO mod_downloads(mod_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT(mod_id,user_id) DO NOTHING",
                               (mod_id, user["id"], now()))
            if inserted.rowcount:
                execute(c, "UPDATE mods SET download_count=download_count+1 WHERE id=?", (mod_id,))
        zip_path = version["zip_path"] if isinstance(version, dict) else version[0]
        original_filename = version["original_filename"] if isinstance(version, dict) else version[1]
        mod_name = version["mod_name"] if isinstance(version, dict) else version[2]
        filename = Path(original_filename or "").name
        if not filename.lower().endswith(".zip"):
            filename = f"{mod_name or 'beammods-mod'}.zip"
        path = DATA / zip_path
        if not path.is_file(): return self.send_json(404, {"error": "Download not found"})
        self.send_response(200); self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(filename)}")
        self.send_header("Content-Length", str(path.stat().st_size)); self.end_headers()
        with path.open("rb") as stream: shutil.copyfileobj(stream, self.wfile)

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = user_id
        with db() as connection:
            execute(connection, "INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)", (token, user_id, now()))
        return token

    def clear_session(self):
        jar = cookies.SimpleCookie(); jar.load(self.headers.get("Cookie", ""))
        if jar.get("beammods_session"):
            token = jar["beammods_session"].value
            SESSIONS.pop(token, None)
            with db() as connection:
                execute(connection, "DELETE FROM sessions WHERE token=?", (token,))
        self.send_response(204); self.send_header("Set-Cookie", "beammods_session=; Max-Age=0; Path=/"); self.end_headers()

    def serve_static(self, path):
        if path.startswith("/uploads/"):
            requested = (DATA / path.lstrip("/")).resolve()
            if DATA not in requested.parents:
                return self.send_error(403)
        else:
            requested = (ROOT / path.lstrip("/")).resolve()
            if ROOT not in requested.parents and requested != ROOT: return self.send_error(403)
        if requested.is_dir(): requested = ROOT / "index.html"
        if not requested.exists(): return self.send_error(404)
        self.send_response(200); self.send_header("Content-Type", mimetypes.guess_type(str(requested))[0] or "application/octet-stream"); self.end_headers()
        with requested.open("rb") as stream: shutil.copyfileobj(stream, self.wfile)


if __name__ == "__main__":
    for attempt in range(12):
        try:
            init_db()
            print("Database schema ready")
            break
        except Exception:
            if attempt == 11:
                raise
            time.sleep(5)
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"BeamMods backend: http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
