from flask import Flask, request, jsonify, render_template, session
import sqlite3
import uuid
import time
import os
import hashlib
import hmac
from datetime import date, timedelta

app = Flask(__name__)
import os
app.secret_key = os.environ.get("SECRET_KEY")

DB_PATH = os.path.join(os.path.dirname(__file__), "database.db")


# -------------------------------------------------------
# DATABASE
# -------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                email      TEXT NOT NULL UNIQUE,
                password   TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS medicines (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                name       TEXT NOT NULL,
                dosage     TEXT NOT NULL,
                notes      TEXT DEFAULT '',
                times      TEXT NOT NULL,
                color      TEXT DEFAULT 'blue',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dose_logs (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                medicine_id TEXT NOT NULL,
                date        TEXT NOT NULL,
                time        TEXT NOT NULL,
                status      TEXT NOT NULL,
                logged_at   INTEGER NOT NULL
            );
        """)


init_db()


def new_id():
    return uuid.uuid4().hex[:12]


def today():
    return date.today().isoformat()


def hash_password(password):
    salt = "medminder_salt_v2"
    return hashlib.sha256((password + salt).encode()).hexdigest()


def require_login():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return user_id


# -------------------------------------------------------
# PAGE
# -------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# -------------------------------------------------------
# AUTH
# -------------------------------------------------------

@app.route("/api/register", methods=["POST"])
def register():
    data   = request.get_json()
    name   = data.get("name", "").strip()
    email  = data.get("email", "").strip().lower()
    passwd = data.get("password", "")

    if not name or not email or not passwd:
        return jsonify({"error": "All fields are required."}), 400
    if len(passwd) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if "@" not in email:
        return jsonify({"error": "Invalid email address."}), 400

    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({"error": "An account with this email already exists."}), 409
        user = {
            "id":         new_id(),
            "name":       name,
            "email":      email,
            "password":   hash_password(passwd),
            "created_at": int(time.time() * 1000),
        }
        db.execute(
            "INSERT INTO users (id, name, email, password, created_at) VALUES (:id,:name,:email,:password,:created_at)",
            user
        )

    session["user_id"] = user["id"]
    return jsonify({"id": user["id"], "name": user["name"], "email": user["email"]}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data   = request.get_json()
    email  = data.get("email", "").strip().lower()
    passwd = data.get("password", "")

    if not email or not passwd:
        return jsonify({"error": "Email and password are required."}), 400

    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not row or row["password"] != hash_password(passwd):
        return jsonify({"error": "Incorrect email or password."}), 401

    session["user_id"] = row["id"]
    return jsonify({"id": row["id"], "name": row["name"], "email": row["email"]}), 200


@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.route("/api/me", methods=["GET"])
def me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"user": None})
    with get_db() as db:
        row = db.execute("SELECT id, name, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        session.pop("user_id", None)
        return jsonify({"user": None})
    return jsonify({"user": dict(row)})


# -------------------------------------------------------
# MEDICINES
# -------------------------------------------------------

@app.route("/api/medicines", methods=["GET"])
def list_medicines():
    user_id = require_login()
    if not user_id:
        return jsonify([])
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM medicines WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,)
        ).fetchall()
    result = []
    for row in rows:
        med = dict(row)
        med["times"] = med["times"].split(",")
        result.append(med)
    return jsonify(result)


@app.route("/api/medicines", methods=["POST"])
def add_medicine():
    user_id = require_login()
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data  = request.get_json()
    times = sorted(set(data.get("times", ["08:00"])))
    med   = {
        "id":         new_id(),
        "user_id":    user_id,
        "name":       data.get("name", "").strip(),
        "dosage":     data.get("dosage", "").strip(),
        "notes":      data.get("notes", "").strip(),
        "times":      ",".join(times),
        "color":      data.get("color", "blue"),
        "created_at": int(time.time() * 1000),
    }
    if not med["name"] or not med["dosage"]:
        return jsonify({"error": "Name and dosage are required"}), 400
    with get_db() as db:
        db.execute(
            "INSERT INTO medicines (id,user_id,name,dosage,notes,times,color,created_at) "
            "VALUES (:id,:user_id,:name,:dosage,:notes,:times,:color,:created_at)",
            med
        )
    med["times"] = med["times"].split(",")
    return jsonify(med), 201


@app.route("/api/medicines/<med_id>", methods=["DELETE"])
def delete_medicine(med_id):
    user_id = require_login()
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    with get_db() as db:
        db.execute("DELETE FROM medicines WHERE id = ? AND user_id = ?", (med_id, user_id))
        db.execute("DELETE FROM dose_logs WHERE medicine_id = ?", (med_id,))
    return jsonify({"ok": True})


# -------------------------------------------------------
# DOSE LOGS
# -------------------------------------------------------

@app.route("/api/logs", methods=["GET"])
def list_logs():
    user_id = require_login()
    if not user_id:
        return jsonify([])
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM dose_logs WHERE user_id = ? ORDER BY logged_at DESC",
            (user_id,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/logs", methods=["POST"])
def set_log():
    user_id = require_login()
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data        = request.get_json()
    medicine_id = data["medicine_id"]
    log_date    = data.get("date", today())
    log_time    = data["time"]
    status      = data["status"]
    log_id      = "{}-{}-{}".format(medicine_id, log_date, log_time)
    log = {
        "id":          log_id,
        "user_id":     user_id,
        "medicine_id": medicine_id,
        "date":        log_date,
        "time":        log_time,
        "status":      status,
        "logged_at":   int(time.time() * 1000),
    }
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO dose_logs "
            "(id,user_id,medicine_id,date,time,status,logged_at) "
            "VALUES (:id,:user_id,:medicine_id,:date,:time,:status,:logged_at)",
            log
        )
    return jsonify(log), 200


# -------------------------------------------------------
# ANALYTICS
# -------------------------------------------------------

@app.route("/api/analytics", methods=["GET"])
def analytics():
    user_id = require_login()
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401

    # last 30 days
    end_date   = date.today()
    start_date = end_date - timedelta(days=29)

    with get_db() as db:
        logs = db.execute(
            "SELECT * FROM dose_logs WHERE user_id = ? AND date >= ? ORDER BY date ASC",
            (user_id, start_date.isoformat())
        ).fetchall()
        meds = db.execute(
            "SELECT * FROM medicines WHERE user_id = ?",
            (user_id,)
        ).fetchall()

    logs = [dict(l) for l in logs]
    meds = [dict(m) for m in meds]
    for m in meds:
        m["times"] = m["times"].split(",")

    # daily breakdown for last 7 days
    weekly = []
    for i in range(6, -1, -1):
        d = (end_date - timedelta(days=i)).isoformat()
        day_logs  = [l for l in logs if l["date"] == d]
        taken  = sum(1 for l in day_logs if l["status"] == "taken")
        missed = sum(1 for l in day_logs if l["status"] == "missed")
        total_scheduled = sum(len(m["times"]) for m in meds)
        weekly.append({
            "date":      d,
            "label":     (end_date - timedelta(days=i)).strftime("%a"),
            "taken":     taken,
            "missed":    missed,
            "scheduled": total_scheduled,
        })

    # overall 30-day stats
    taken_total  = sum(1 for l in logs if l["status"] == "taken")
    missed_total = sum(1 for l in logs if l["status"] == "missed")
    total_logged = taken_total + missed_total
    adherence    = round(taken_total / total_logged * 100) if total_logged else 0

    # per-medicine stats
    med_stats = []
    for med in meds:
        med_logs  = [l for l in logs if l["medicine_id"] == med["id"]]
        t = sum(1 for l in med_logs if l["status"] == "taken")
        m = sum(1 for l in med_logs if l["status"] == "missed")
        total = t + m
        med_stats.append({
            "name":      med["name"],
            "color":     med["color"],
            "taken":     t,
            "missed":    m,
            "adherence": round(t / total * 100) if total else 0,
        })

    return jsonify({
        "weekly":       weekly,
        "taken_total":  taken_total,
        "missed_total": missed_total,
        "adherence":    adherence,
        "med_stats":    med_stats,
        "streak":       compute_streak(logs, meds, end_date),
    })


def compute_streak(logs, meds, end_date):
    """Count consecutive days where all scheduled doses were taken."""
    if not meds:
        return 0
    streak = 0
    d = end_date
    for _ in range(30):
        day_str   = d.isoformat()
        scheduled = []
        for m in meds:
            for t in m["times"]:
                scheduled.append((m["id"], t))
        day_logs = {(l["medicine_id"], l["time"]): l["status"] for l in logs if l["date"] == day_str}
        all_taken = all(day_logs.get(s) == "taken" for s in scheduled)
        if all_taken and scheduled:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(debug=False, host="0.0.0.0", port=port)