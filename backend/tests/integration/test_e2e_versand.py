"""End-to-End (M3a-Abnahmekriterium): Login → Abo → Versand → Mails in Mailpit."""

import time
import uuid

import httpx
import pytest

from tests.integration.conftest import BASE_URL, keycloak_login

pytestmark = pytest.mark.integration


def wait_for(condition, timeout_s=60, interval_s=1.0, message="Bedingung"):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        result = condition()
        if result:
            return result
        time.sleep(interval_s)
    raise AssertionError(f"Timeout ({timeout_s}s): {message}")


def test_healthchecks_kette(http):
    with http() as client:
        assert client.get(f"{BASE_URL}/healthz").status_code == 200
        assert client.get(f"{BASE_URL}/readyz").status_code == 200
        assert client.get(f"{BASE_URL}/nginx-health").status_code == 200


def test_login_roundtrip_und_me(http):
    with http() as client:
        keycloak_login(client, "mitarbeiter1", "test")
        me = client.get(f"{BASE_URL}/api/v1/me")
        assert me.status_code == 200
        assert me.json()["email"] == "mitarbeiter1@example.corp"
        assert "admin" not in me.json()["roles"]


def test_admin_rolle_aus_keycloak(http):
    with http() as client:
        keycloak_login(client, "admin1", "test")
        me = client.get(f"{BASE_URL}/api/v1/me")
        assert "admin" in me.json()["roles"]


def test_e2e_versand_nur_an_abonnenten(http, mailpit):
    marker = uuid.uuid4().hex[:10]
    mailpit.clear()

    # Mitarbeiter 1 abonniert KAP, Mitarbeiter 2 bestellt KAP explizit ab
    with http() as m1:
        keycloak_login(m1, "mitarbeiter1", "test")
        assert m1.put(f"{BASE_URL}/api/v1/me/subscriptions/kap").status_code == 204
    with http() as m2:
        keycloak_login(m2, "mitarbeiter2", "test")
        assert m2.delete(f"{BASE_URL}/api/v1/me/subscriptions/kap").status_code == 204

    # Admin versendet an KAP
    with http() as admin:
        keycloak_login(admin, "admin1", "test")
        created = admin.post(
            f"{BASE_URL}/api/v1/admin/dispatches",
            json={
                "topic_id": "kap",
                "severity": "stoerung",
                "title": f"E2E-Test {marker}",
                "body": "Automatisierter Integrationstest.\nZweite Zeile.",
            },
        )
        assert created.status_code == 201, created.text
        dispatch_id = created.json()["id"]

        # Auf Abschluss warten (Worker pollt alle 5 s)
        def finished():
            detail = admin.get(f"{BASE_URL}/api/v1/admin/dispatches/{dispatch_id}").json()
            return detail if detail["status"] not in ("pending", "sending") else None

        detail = wait_for(finished, timeout_s=60, message="Versand abgeschlossen")
        assert detail["status"] == "completed", detail
        assert detail["failed_count"] == 0

    # Mailpit-Assertions (Plan 8.4)
    messages = wait_for(
        lambda: mailpit.search(f'subject:"{marker}"') or None,
        timeout_s=30,
        message="Mails in Mailpit",
    )
    recipients = sorted(m["To"][0]["Address"] for m in messages)
    assert "mitarbeiter1@example.corp" in recipients
    assert "mitarbeiter2@example.corp" not in recipients  # kein Abo → keine Mail

    first = messages[0]
    assert first["Subject"] == f"[STÖRUNG] KAP Störungsmeldungen: E2E-Test {marker}"
    html_body = mailpit.message_html(first["ID"])
    assert "#C0392B" in html_body  # Farbbalken Störung
    assert "Einstellungen verwalten" in html_body
    assert "abos.html" in html_body


def test_pflicht_topic_api_lehnt_ab(http):
    with http() as client:
        keycloak_login(client, "mitarbeiter1", "test")
        response = client.delete(f"{BASE_URL}/api/v1/me/subscriptions/zentrale-stoerungen")
        assert response.status_code == 409


def test_csrf_wird_am_echten_stack_erzwungen(http):
    with httpx.Client(timeout=15) as client:  # bewusst OHNE X-Requested-With
        keycloak_login(client, "mitarbeiter1", "test")
        response = client.put(f"{BASE_URL}/api/v1/me/subscriptions/kap")
        assert response.status_code == 403
