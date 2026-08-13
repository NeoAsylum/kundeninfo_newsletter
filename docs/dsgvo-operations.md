# DSGVO Operational Runbook (Auskunft & Löschung)

Dieses Dokument enthält Prozeduren zur Erfüllung von Betroffenenrechten nach Art. 15 (Auskunft) und Art. 17 (Löschung) DSGVO.

---

## 1. Datenauskunft (Art. 15 DSGVO)

Export aller zu einer E-Mail-Adresse gespeicherten Daten als JSON:

```sql
-- Nutzerstamm & Abos abfragen
SELECT 
    u.id, u.oidc_sub, u.email, u.created_at, u.last_login_at,
    u.is_active, u.is_admin,
    GROUP_CONCAT(s.topic_id) AS active_subscriptions
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id
WHERE u.email = 'betroffener@example.corp'
GROUP BY u.id;

-- Versand-Empfängerhistorie abfragen
SELECT dr.dispatch_id, dr.status, dr.attempts, dr.sent_at, dr.last_error
FROM dispatch_recipients dr
WHERE dr.email = 'betroffener@example.corp';

-- Audit-Einträge mit Personenbezug: als Handelnder (actor_email) und als Betroffener
-- eines Admin-Eingriffs (detail.email, seit ADR-0022 auch admin_granted/admin_revoked).
-- Dieselbe Abfrage steht in Abschnitt 2 Step 4 — Auskunft und Löschung müssen dieselben
-- Tabellen abdecken, sonst ist die Auskunft unrichtig.
SELECT id, ts, action, actor_email, detail FROM audit_log
WHERE actor_email = 'betroffener@example.corp'
   OR JSON_EXTRACT(detail, '$.email') = 'betroffener@example.corp';
```

Vollständigkeit: Damit sind alle Tabellen erfasst, die einen Personenbezug tragen —
`users` (inklusive `is_admin`, seit [ADR-0022](adr/0022-adminrechte-im-portal.md)),
`subscriptions`, `dispatch_recipients` und `audit_log`. `dispatches` enthält nur die
Meldung selbst und die id des Erstellers, `topics` keine personenbezogenen Daten.

---

## 2. Recht auf Vergessenwerden / Löschung (Art. 17 DSGVO)

Nutzerkonto anonymisieren bzw. löschen:

```sql
-- Step 1: Subscriptions entfernen
DELETE FROM subscriptions 
WHERE user_id = (SELECT id FROM users WHERE email = 'betroffener@example.corp');

-- Step 2: Empfängerhistorie anonymisieren (E-Mail entfernen). last_error MUSS mit:
-- dort steht die Fehlerantwort des Mailservers, die die Adresse üblicherweise
-- wiederholt ("550 ... <adresse> unknown") — sonst bleibt sie nach der Löschung stehen.
-- Der Platzhalter MUSS die Zeilen-id enthalten: dispatch_recipients hat
-- UNIQUE (dispatch_id, email), und bei einem Pflicht-Verteiler ist jeder Beschäftigte
-- Empfänger DESSELBEN Versands. Ein konstanter Platzhalter kollidiert ab dem zweiten
-- Löschantrag mit einem Unique-Verstoß (PostgreSQL: unique_violation, SQLSTATE 23505) —
-- die Anonymisierung findet dann nicht statt.
UPDATE dispatch_recipients 
SET email = CONCAT('deleted-', id, '@anonymized.local'), user_id = NULL, last_error = NULL
WHERE email = 'betroffener@example.corp';

-- Step 3a: Hat die Person je eine Meldung VERSENDET? dispatches.created_by_user_id
-- ist ein Fremdschlüssel mit ON DELETE RESTRICT (die Versandhistorie ist
-- unveränderlich) — bei einem Zähler > 0 scheitert Step 3b mit einem Fremdschlüssel-
-- Verstoß (PostgreSQL: foreign_key_violation, SQLSTATE 23503).
SELECT COUNT(*) FROM dispatches d JOIN users u ON u.id = d.created_by_user_id
WHERE u.email = 'betroffener@example.corp';

-- Step 3b: NUR bei Zähler 0 — Konto löschen (subscriptions folgen per CASCADE).
DELETE FROM users WHERE email = 'betroffener@example.corp';

-- Step 3c: Bei Zähler > 0 (Problemmanagement-Mitarbeiter) bleibt die Zeile als Anker
-- der Historie bestehen und wird stattdessen anonymisiert. Das ist keine Umgehung von
-- Art. 17: Die Zuordnung „wer hat diese Meldung verantwortet" ist eine
-- Rechenschaftspflicht-Aufzeichnung. Mit dem DSB abstimmen und im Change vermerken.
UPDATE users SET
    email = CONCAT('deleted-', id, '@anonymized.local'),
    oidc_sub = CONCAT('deleted-', id),
    is_active = 0,
    is_admin = 0,
    last_login_at = NULL
WHERE email = 'betroffener@example.corp';

-- Step 4: audit_log prüfen — es speichert die E-Mail des HANDELNDEN (actor_email)
-- und im JSON-Detail die des betroffenen Empfängers. Beides ist eine
-- Rechenschaftspflicht-Aufzeichnung; löschen nur nach Abstimmung mit dem DSB:
SELECT id, ts, action, actor_email, detail FROM audit_log
WHERE actor_email = 'betroffener@example.corp'
   OR JSON_EXTRACT(detail, '$.email') = 'betroffener@example.corp';
```

Zusätzlich im IdP löschen: Das Konto selbst liegt dort, nicht im Portal. Ohne diesen
Schritt legt die nächste Anmeldung den Portal-Datensatz per JIT neu an (ADR-0010).

---

## 3. Automatische Data-Retention

In `.env` einstellbar:
* `RETENTION_DAYS_RECIPIENTS`: Automatisches Aufräumen von `dispatch_recipients` Zeilen älter als N Tage.
* `RETENTION_DAYS_AUDIT`: Automatisches Aufräumen von `audit_log` Zeilen älter als N Tage.
