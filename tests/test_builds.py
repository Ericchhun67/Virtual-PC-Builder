import sqlite3
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from app import app


class SavedBuildTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Path(directory.name) / "builds.sqlite3"
        original_config = dict(app.config)
        self.addCleanup(app.config.update, original_config)
        app.config.update(TESTING=True, BUILDS_DB=self.database)
        self.client = app.test_client()
        self.configuration = {
            "version": 1,
            "profiles": {
                "motherboard": "am5", "cpu": "am5", "ram": "ddr5",
                "gpu": "standard", "psu": "standard", "storage": "nvme",
            },
            "parts": [{"id": "frontFan", "screws": [0, 2]}],
            "firmware": {"order": ["usb", "ssd"], "usbConnected": True},
        }

    def test_named_build_is_saved_and_reloaded(self):
        saved = self.client.post("/api/builds", json={"name": "  Test PC  ", "configuration": self.configuration})
        self.assertEqual(saved.status_code, 201)
        build_id = saved.json["id"]

        with sqlite3.connect(self.database) as database:
            self.assertEqual(database.execute("SELECT id, name FROM builds").fetchone(), (build_id, "Test PC"))
        reloaded = app.test_client().get("/api/builds/" + build_id)
        self.assertEqual(reloaded.status_code, 200)
        self.assertEqual(reloaded.json, {"id": build_id, "name": "Test PC", "configuration": self.configuration})

    def test_snapshots_are_independent(self):
        api = "/api/builds"
        first = self.client.post(api, json={"name": "PC", "configuration": self.configuration})
        revised = {**self.configuration, "parts": []}
        second = self.client.post(api, json={"name": "PC", "configuration": revised})
        self.assertNotEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.client.get(api + "/" + first.json["id"]).json["configuration"], self.configuration)
        self.assertEqual(self.client.get(api + "/" + second.json["id"]).json["configuration"], revised)

    def test_invalid_and_missing_builds(self):
        self.assertEqual(self.client.get("/api/builds/" + str(uuid4())).status_code, 404)
        self.assertEqual(self.client.post("/api/builds", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/api/builds", json={"name": " "}).status_code, 400)
        for invalid in ({"version": True}, {"parts": [{"id": "psu", "screws": [False]}]},
                        {"firmware": {"order": ["usb", "usb"], "usbConnected": False}}):
            configuration = {**self.configuration, **invalid}
            self.assertEqual(self.client.post("/api/builds", json={"name": "PC", "configuration": configuration}).status_code, 400)

    def test_saved_build_interface_is_served(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="demo-build"', response.data)
        self.assertIn(b'id="load-build"', response.data)
        self.assertLess(response.data.index(b"saved-builds.js"), response.data.index(b"viewer.js"))
        with self.client.get("/static/saved-builds.js") as asset:
            self.assertEqual(asset.status_code, 200)
