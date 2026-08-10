"""Smoke-Test nach Deploy (Plan 8.5): make smoke BASE_URL=https://...

Bewusst ohne Login und ohne echten Mailversand in PROD; auf einer Umgebung mit
Mailpit prüft --with-mail zusätzlich den Versandpfad-Endpunkt-Roundtrip nicht —
das bleibt den Integrationstests vorbehalten (nur Reachability-Checks hier).
Exit-Code != 0 bei jedem Fehlschlag → in Deploy-Skripte einhängbar.
"""

import argparse
import sys

import httpx

CHECKS_FAILED = 0


def check(name: str, ok: bool, extra: str = "") -> None:
    global CHECKS_FAILED
    status = "OK  " if ok else "FAIL"
    print(f"[{status}] {name}" + (f" - {extra}" if extra else ""))
    if not ok:
        CHECKS_FAILED += 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--expect-version", default=None)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    with httpx.Client(timeout=10, follow_redirects=False, verify=True) as client:
        try:
            r = client.get(f"{base}/healthz")
            body = r.json() if r.status_code == 200 else {}
            check("healthz erreichbar (via NGINX)", r.status_code == 200, f"HTTP {r.status_code}")
            if args.expect_version:
                check(
                    "Version stimmt",
                    body.get("version") == args.expect_version,
                    f"läuft: {body.get('version')}",
                )
            else:
                print(f"       Version: {body.get('version')} ({body.get('git_sha')})")
        except httpx.HTTPError as exc:
            check("healthz erreichbar", False, str(exc))
            return 1  # ohne Basis-Erreichbarkeit ist der Rest sinnlos

        r = client.get(f"{base}/readyz")
        check("readyz ok (DB, SMTP, Outbox)", r.status_code == 200, r.text[:200])

        r = client.get(f"{base}/api/v1/me")
        check("Auth nicht versehentlich offen (/me ohne Session -> 401)", r.status_code == 401)

        r = client.get(f"{base}/")
        check(
            "Frontend erreichbar",
            r.status_code == 200 and "Störungsinfo" in r.text,
            f"HTTP {r.status_code}",
        )

        r = client.get(f"{base}/nginx-health")
        check("NGINX-Stub", r.status_code == 200)

    print(f"\n{'SMOKE FEHLGESCHLAGEN' if CHECKS_FAILED else 'SMOKE GRUEN'} ({CHECKS_FAILED} Fehler)")
    return 1 if CHECKS_FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
