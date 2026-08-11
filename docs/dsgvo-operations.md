# DSGVO Operational Runbook (Auskunft & Löschung)

Dieses Dokument enthält Prozeduren zur Erfüllung von Betroffenenrechten nach Art. 15 (Auskunft) und Art. 17 (Löschung) DSGVO.

---

## 1. Datenauskunft (Art. 15 DSGVO)

Export aller zu einer E-Mail-Adresse gespeicherten Daten als JSON:

```sql
-- Nutzerstamm & Abos abfragen
SELECT 
    u.id, u.oidc_sub, u.email, u.display_name, u.created_at, u.last_login_at,
    GROUP_CONCAT(s.topic_id) AS active_subscriptions
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id
WHERE u.email = 'betroffener@example.corp'
GROUP BY u.id;

-- Versand-Empfängerhistorie abfragen
SELECT dr.dispatch_id, dr.status, dr.attempts, dr.sent_at
FROM dispatch_recipients dr
WHERE dr.email = 'betroffener@example.corp';
```

---

## 2. Recht auf Vergessenwerden / Löschung (Art. 17 DSGVO)

Nutzerkonto anonymisieren bzw. löschen:

```sql
-- Step 1: Subscriptions entfernen
DELETE FROM subscriptions 
WHERE user_id = (SELECT id FROM users WHERE email = 'betroffener@example.corp');

-- Step 2: Empfängerhistorie anonymisieren (E-Mail entfernen)
UPDATE dispatch_recipients 
SET email = 'deleted-user@anonymized.local', user_id = NULL
WHERE email = 'betroffener@example.corp';

-- Step 3: Nutzerkonto löschen (subscriptions folgen per ON DELETE CASCADE)
DELETE FROM users WHERE email = 'betroffener@example.corp';

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
