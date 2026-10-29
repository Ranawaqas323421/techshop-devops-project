import os
import sqlite3
from functools import wraps
from flask import Flask, g, jsonify, request, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "techshop.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("TECHSHOP_SECRET_KEY", "dev-only-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
CORS(app, supports_credentials=True, origins=["http://localhost:8080", "http://127.0.0.1:8080"])

PRODUCTS = [
    {"id": 1, "name": "AeroBook Pro 14", "category": "Computers", "price": 899, "rating": 4.8, "icon": "💻", "color": "blue", "description": "A powerful everyday laptop with a vivid display, fast storage, and all-day productivity."},
    {"id": 2, "name": "Nova X Smartphone", "category": "Phones", "price": 699, "rating": 4.7, "icon": "📱", "color": "violet", "description": "A sleek smartphone built for sharp photos, smooth multitasking, and a bright edge-to-edge screen."},
    {"id": 3, "name": "Pulse Wireless", "category": "Audio", "price": 199, "rating": 4.6, "icon": "🎧", "color": "pink", "description": "Immersive wireless audio with comfortable cushions and rich, balanced sound."},
    {"id": 4, "name": "Orbit Smartwatch", "category": "Wearables", "price": 249, "rating": 4.5, "icon": "⌚", "color": "cyan", "description": "A lightweight smart watch for daily activity, notifications, and training goals."},
    {"id": 5, "name": "Mechanical RGB", "category": "Accessories", "price": 129, "rating": 4.7, "icon": "⌨️", "color": "orange", "description": "A tactile mechanical keyboard with customizable lighting and a compact desk-friendly layout."},
    {"id": 6, "name": "Studio Mouse", "category": "Accessories", "price": 79, "rating": 4.4, "icon": "🖱️", "color": "green", "description": "Precise tracking, ergonomic comfort, and a clean wireless setup for your workspace."},
]

def connect_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with connect_db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            total REAL NOT NULL,
            items_json TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )""")

def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    with connect_db() as db:
        row = db.execute("SELECT id, name, email FROM users WHERE id = ?", (uid,)).fetchone()
    return dict(row) if row else None

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "Please log in to continue."}), 401
        return fn(*args, **kwargs)
    return wrapper

@app.get("/api/health")
def health():
    return jsonify({"status": "healthy", "service": "techshop-api"})

@app.get("/api/products")
def products():
    category = request.args.get("category", "").strip().lower()
    items = PRODUCTS if not category or category == "all" else [p for p in PRODUCTS if p["category"].lower() == category]
    return jsonify(items)

@app.get("/api/products/<int:product_id>")
def product_detail(product_id):
    item = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if not item:
        return jsonify({"error": "Product not found"}), 404
    return jsonify(item)

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not name or not email or len(password) < 8:
        return jsonify({"error": "Enter your name, a valid email, and a password of at least 8 characters."}), 400
    try:
        with connect_db() as db:
            cur = db.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, generate_password_hash(password))
            )
            uid = cur.lastrowid
        session["user_id"] = uid
        return jsonify({"user": {"id": uid, "name": name, "email": email}}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with that email already exists."}), 409

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    with connect_db() as db:
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Email or password is incorrect."}), 401
    session["user_id"] = user["id"]
    return jsonify({"user": {"id": user["id"], "name": user["name"], "email": user["email"]}})

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"message": "Logged out."})

@app.get("/api/me")
def me():
    user = current_user()
    return jsonify({"user": user})

@app.get("/api/orders")
@login_required
def orders():
    user = current_user()
    with connect_db() as db:
        rows = db.execute(
            "SELECT id, total, items_json, created_at FROM orders WHERE user_id = ? ORDER BY id DESC",
            (user["id"],)
        ).fetchall()
    import json
    return jsonify([{"id": r["id"], "total": r["total"], "items": json.loads(r["items_json"]), "created_at": r["created_at"]} for r in rows])

@app.post("/api/orders")
@login_required
def create_order():
    import json
    user = current_user()
    data = request.get_json(silent=True) or {}
    items = data.get("items", [])
    if not isinstance(items, list) or not items:
        return jsonify({"error": "Your cart is empty."}), 400
    verified = []
    total = 0
    for entry in items:
        try:
            pid, qty = int(entry.get("id")), int(entry.get("quantity", 1))
        except (TypeError, ValueError, AttributeError):
            return jsonify({"error": "Invalid cart item."}), 400
        product = next((p for p in PRODUCTS if p["id"] == pid), None)
        if not product or qty < 1 or qty > 20:
            return jsonify({"error": "Invalid product or quantity."}), 400
        verified.append({"id": pid, "name": product["name"], "price": product["price"], "quantity": qty})
        total += product["price"] * qty
    with connect_db() as db:
        cur = db.execute(
            "INSERT INTO orders (user_id, total, items_json) VALUES (?, ?, ?)",
            (user["id"], total, json.dumps(verified))
        )
        order_id = cur.lastrowid
    return jsonify({"id": order_id, "total": total, "items": verified, "message": "Demo order placed successfully."}), 201

@app.errorhandler(404)
def not_found(_):
    return jsonify({"error": "Endpoint not found"}), 404

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
