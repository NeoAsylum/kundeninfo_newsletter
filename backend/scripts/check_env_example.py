"""CI-Gate (Plan 3.4/9.2): Jedes Settings-Feld muss in .env.example dokumentiert sein.

Aufruf aus dem Repo-Root: python backend/scripts/check_env_example.py
Bewusst aus dem Settings-Objekt generiert — kein zweiter Doku-Ort, kein Parser.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402


def main() -> int:
    env_example = pathlib.Path(__file__).resolve().parents[2] / ".env.example"
    text = env_example.read_text(encoding="utf-8")
    missing = [
        name.upper()
        for name in Settings.model_fields
        if f"{name.upper()}=" not in text and f"#{name.upper()}=" not in text
    ]
    if missing:
        print("FEHLER: Diese Settings-Felder fehlen in .env.example:")
        for name in missing:
            print(f"  - {name}")
        return 1
    print(
        f"OK: alle {len(Settings.model_fields)} Settings-Felder sind in .env.example dokumentiert"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
