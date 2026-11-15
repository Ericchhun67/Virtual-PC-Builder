# Virtual PC Builder

Virtual PC Builder is a browser-based **3D PC assembly and boot simulator**. Start with an empty case, install components, tighten mounting screws, and connect power and fan cables. Then run a simulated Power-On Self-Test (POST), configure boot priority in UEFI/BIOS, and attempt to boot from the internal SSD or a virtual USB installer.

## Features

- **3D assembly** — Rotate and zoom the case. Drag parts onto their matching mounts or select a part and then its mount. Install the motherboard, CPU, RAM, GPU, M.2 SSD, case fans, and power supply.
- **Screws and wiring** — Fasten both case fans, the power supply, and the M.2 SSD. Connect motherboard, CPU, and GPU power cables and both fan leads.
- **Compatibility checks** — Compare simulated hardware profiles and see why a build is valid, incomplete, or invalid. Checks cover CPU socket, RAM type, GPU clearance, PSU wattage and connectors, storage fit, and required wiring.
- **POST and UEFI/BIOS** — Get diagnostics for startup faults, view installed hardware and simulated temperatures, and save a primary and optional fallback boot device.
- **Saved builds** — Save a named SQLite snapshot and reopen it by link or ID. Each snapshot includes hardware profiles, installed parts, screw progress, and boot settings.

## Quick start

From the project directory, run:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 app.py
```

Open [localhost:5000](http://localhost:5000) in a browser with WebGL enabled.

### Try the demo

1. Select **Load demo build** to load a complete, compatible PC.
2. Enter a build name and select **Save build**. Open the resulting link to reload the snapshot.
3. Select **Power on** and wait for POST to finish.
4. In **UEFI / BIOS setup**, review the hardware and boot priority, then select **Attempt boot**. To try USB boot, connect the virtual USB installer, set it as the first boot device, and select **Save settings** before booting.

Each save creates a separate snapshot. Anyone who can access the running app and has the snapshot link can load it. The database defaults to `instance/builds.sqlite3`. Set `BUILDS_DB` to use a different path.

## Tech stack

| Layer | Tools |
| --- | --- |
| 3D renderer and simulator | JavaScript and WebGL |
| Interface | HTML, CSS, and Jinja |
| Server and saved builds | Flask and SQLite |
| Testing | Python `unittest` and Node.js test runner |
| Deployment configuration | Docker and Gunicorn |

## Run the tests

```sh
python3 -B -m unittest discover -s tests -v
node --test tests/build-flow.test.cjs
```

The Python tests exercise the save and load endpoints against a temporary SQLite database. The JavaScript tests simulate browser interactions, including saving a demo build, reloading it, and booting from the SSD.

## Deploy with Docker

The repository includes a Docker configuration. Hosted deployment is pending.

```sh
docker build -t virtual-pc-builder .
docker run -d --name virtual-pc-builder --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v virtual-pc-builds:/data virtual-pc-builder
```

Test the container at [localhost:8000](http://localhost:8000). On a server, configure an HTTPS reverse proxy to forward requests to port 8000. Keep the `virtual-pc-builds` volume when replacing the container so existing build links continue to work.
