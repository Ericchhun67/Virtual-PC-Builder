import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config.from_mapping(
    BUILDS_DB=os.environ.get("BUILDS_DB", str(Path(app.instance_path) / "builds.sqlite3")),
    MAX_CONTENT_LENGTH=8 * 1024,
)

CREATE_BUILDS = """
CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    configuration TEXT NOT NULL
)
"""


def open_database():
    path = Path(app.config["BUILDS_DB"])
    path.parent.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(path)
    database.execute(CREATE_BUILDS)
    return database


def valid_configuration(configuration):
    if not isinstance(configuration, dict) or type(configuration.get("version")) is not int:
        return False
    if configuration["version"] != 1:
        return False
    profiles = configuration.get("profiles")
    parts = configuration.get("parts")
    firmware = configuration.get("firmware")
    if not isinstance(profiles, dict) or not isinstance(parts, list) or not isinstance(firmware, dict):
        return False
    return (
        set(profiles) == {"motherboard", "cpu", "ram", "gpu", "psu", "storage"}
        and all(isinstance(profile, str) and 0 < len(profile) <= 30 for profile in profiles.values())
        and len(parts) <= 13
        and all(
            isinstance(part, dict)
            and isinstance(part.get("id"), str)
            and 0 < len(part["id"]) <= 30
            and isinstance(part.get("screws"), list)
            and len(part["screws"]) <= 4
            and all(type(screw) is int and 0 <= screw < 4 for screw in part["screws"])
            for part in parts
        )
        and isinstance(firmware.get("order"), list)
        and len(firmware["order"]) == 2
        and firmware["order"][0] in ("ssd", "usb")
        and firmware["order"][1] in ("ssd", "usb", "")
        and firmware["order"][0] != firmware["order"][1]
        and type(firmware.get("usbConnected")) is bool
    )


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/builds")
def save_build():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Send a build name and configuration."), 400
    name = payload.get("name")
    configuration = payload.get("configuration")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or not valid_configuration(configuration):
        return jsonify(error="The build name or configuration is invalid."), 400

    build_id = str(uuid4())
    with closing(open_database()) as database, database:
        database.execute(
            "INSERT INTO builds (id, name, configuration) VALUES (?, ?, ?)",
            (build_id, name.strip(), json.dumps(configuration)),
        )
    return jsonify(id=build_id, name=name.strip()), 201


@app.get("/api/builds/<uuid:build_id>")
def load_build(build_id):
    with closing(open_database()) as database:
        row = database.execute(
            "SELECT name, configuration FROM builds WHERE id = ?", (str(build_id),)
        ).fetchone()
    if row is None:
        return jsonify(error="Saved build not found."), 404
    return jsonify(id=str(build_id), name=row[0], configuration=json.loads(row[1]))


if __name__ == "__main__":
    app.run(port=5000)
