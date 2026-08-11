# [ADR-0022] Adminrechte im Portal — die Datenbank ist die einzige Quelle

* **Status:** Akzeptiert (löst [ADR-0013](0013-rollen-aus-idp-claims.md) für die Autorisierung ab)
* **Datum:** 2026-08-11
* **Kontext:** Der Auftraggeber will Adminrechte selbst vergeben können, ohne für jede
  Personalie einen IAM-Antrag zu stellen. Bisher kam die Rolle ausschließlich aus dem
  IdP-Claim ([ADR-0013]), im Pilotbetrieb also aus einem Keycloak, dessen Adminkonsole von
  außen bewusst nicht erreichbar ist. Wer dort Rechte vergeben wollte, brauchte einen
  SSH-Zugang zur VM — praktisch heißt das: der Entwickler, nicht das Problemmanagement.

## Entscheidung

Das Adminrecht steht **allein in der Datenbank** (`users.is_admin`, additive Migration 0003,
[ADR-0011]). Rollen aus dem OIDC-Token werden **nicht mehr gelesen**:

```python
def is_admin(user: User) -> bool:
    return user.is_admin
```

`require_admin` hängt an `get_current_user` und liest damit **bei jeder Anfrage** die
Datenbank — die Autorisierung steht nicht mehr im Session-Cookie. Das Cookie trägt nur
noch Identität (`sub`, E-Mail — keinen Namen, [ADR-0025]) und die Basisrolle `employee`; `/api/v1/me`
leitet die Rollen aus derselben Funktion ab, die auch autorisiert.

Gepflegt wird das Recht über `PUT`/`DELETE /api/v1/admin/users/{id}/admin` und die Maske
**„Rollen"** ([ADR-0024] beschreibt die Schwester-Maske für Verteiler).

### Warum nicht in den IdP zurückschreiben

Der naheliegende Weg — die Maske schreibt die Rolle per Admin-API in Keycloak — kostet
genau die Dinge, die dieses Projekt bewusst klein hält: Das Backend bräuchte Zugangsdaten
für den `master`-Realm im internetseitigen Container, eine neue Egress-Verbindung zum IdP
und eine Lockerung der NGINX-Allowlist auf `/idp`, die die Admin-API im öffentlichen Pilot
absichtlich auf 404 legt. Am Konzern-IdP wäre der Weg ohnehin tot: dort vergibt der
IAM-Prozess die App-Rollen, nicht eine Fachanwendung (offene Frage A2).

### Warum die IdP-Rolle gar nicht mehr gilt

Zwischenzeitlich waren beide Quellen ODER-verknüpft. Das ist auf Entscheidung des
Auftraggebers entfallen: **Eine Berechtigung soll genau einen Ort haben.** Eine Rolle im
Token wäre daneben eine zweite Wahrheit, die die Rollen-Maske weder anzeigen noch
entziehen kann — sie gehört dem IdP. Die Folge wäre ein Recht, das ein Admin sichtbar
entzieht, ohne dass es verschwindet.

Der Preis ist eine Verschiebung von Betriebspflichten, die im Betrieb bekannt sein muss:

* Eine Deaktivierung im Verzeichnisdienst entzieht das Adminrecht **nicht** mehr von
  selbst. Offboarding läuft über das Portal — Empfänger deaktivieren (das sperrt
  jeden Zugriff sofort, `401 SESSION_STALE`) oder das Adminrecht entziehen.
* Die Konzern-IT kann Adminrechte nicht über AD-Gruppen steuern. Frage A2 ist damit für
  das Portal beantwortet, nicht mehr offen: die Antwort lautet „keine von beiden".
* `ADMIN_ROLE_VALUE` und `OIDC_ROLES_CLAIM` sind entfallen. Eine im IdP gepflegte Rolle
  hat keine Wirkung mehr — auch keine versteckte, weil der Claim nicht gelesen wird.

### Der erste Admin (und der Weg zurück nach einer Aussperrung)

Weil das Recht nur in der Datenbank existiert, hat eine frische Instanz **niemanden**, der
es vergeben könnte. Dafür gibt es zwei Wege, beide bewusst schmal:

1. **Migration 0003** setzt das Kennzeichen für alle, die **belegbar bereits als Admin
   gehandelt haben**: Ersteller von Versänden (`dispatches.created_by_user_id`) und Akteure
   der Admin-Aktionen im `audit_log`. Beides ist nur hinter dem Admin-Gate möglich, taugt
   also als Nachweis. Das trägt bestehende Instanzen über den Umstieg.
2. **`ADMIN_BOOTSTRAP_EMAILS`** (kommagetrennt, Default leer): Diese Adressen bekommen beim
   Login das Adminrecht — **aber nur, solange kein aktiver Admin existiert.** Genau diese
   Bedingung macht die Liste im Normalbetrieb wirkungslos und verhindert, dass sie zur
   Hintertür wird: Bei offener Selbstregistrierung könnte sich sonst jemand mit einer
   gelisteten Adresse anmelden und wäre Admin. Sobald ein aktiver Admin da ist, wird die
   Liste ignoriert; ist keiner mehr übrig, greift sie wieder — das ist der Notfall, für den
   sie gedacht ist. Prozedur: [RUNBOOK 6b](../RUNBOOK.md).

Wer ein IdP-Konto anlegt, vergibt damit **keine** Rechte mehr. Der Schalter `--admin` in
`deploy/vm/create-user.sh` und `ops/create_dev_user.py` ist deshalb entfallen, statt eine
Realm-Rolle ohne Wirkung zu setzen — ein Schalter, der scheinbar funktioniert, wäre
schlimmer als keiner.

## Konsequenzen

* **Positiv:** Rechtevergabe ist eine Fachaufgabe des Problemmanagements geworden — kein
  IAM-Antrag, kein SSH-Zugang, keine neue Netzverbindung, kein zusätzliches Geheimnis im
  internetseitigen Container. Und genau ein Ort, an dem man nachsieht, wer Admin ist.
* **Wirkung ist sofort**, in beide Richtungen: Weil jede Anfrage die Datenbank prüft, wirkt
  ein Entzug mit dem nächsten Klick statt erst mit dem Cookie-Ablauf — selbst gegenüber
  einem alten Cookie, das noch die Rolle `admin` aus der Zeit vor diesem ADR enthält. Nur
  die **Navigation** der betroffenen Person erscheint erst nach einem Neuladen der Seite,
  weil `/me` einmalig beim Seitenaufbau gelesen wird.
* **Aussperr-Schutz:** Der Selbstentzug ist gesperrt (`409 CANNOT_REVOKE_OWN_ADMIN`). Wer
  entziehen darf, ist selbst Admin und bleibt es — nach jedem erlaubten Entzug ist also
  mindestens ein Admin übrig.
* **Negativ:** Das Portal ist jetzt ein eigener Ort für Berechtigungen. Ein
  Berechtigungsreview des Konzerns muss ihn kennen; ein AD-Offboarding allein genügt nicht.
  Das gehört ins Betriebsrats-/DSB-Briefing und in die Betriebsübergabe.
* **Negativ:** Deaktivierte Empfänger können das Recht nicht bekommen (`409 USER_INACTIVE`)
  — es hätte keine Wirkung, weil die Anmeldung vorher an `401 SESSION_STALE` scheitert.
  Erst reaktivieren, dann vergeben.
* Vergabe und Entzug landen im `audit_log` (`admin_granted` / `admin_revoked`, [ADR-0017]).

## Verworfene Alternativen

* **Rollen im IdP setzen (Keycloak-Admin-API):** Master-Realm-Zugangsdaten im
  internetseitigen Container, neue Egress-Verbindung, gelockerte `/idp`-Allowlist — und am
  Konzern-IdP durch die IAM-Prozesse ohnehin nicht gangbar.
* **Beide Quellen ODER-verknüpft:** war der erste Entwurf und hätte die AD-Steuerung
  erhalten. Verworfen, weil eine Berechtigung dann an zwei Orten steht und die Maske nur
  einen davon entziehen kann. Wiederherstellbar durch `identity.is_admin or` in
  `deps.is_admin` — dann brauchen die Tests, die heute „Cookie autorisiert nicht"
  festhalten, die umgekehrte Erwartung.
* **Rollentabelle mit Rollen-Enum statt boolescher Spalte:** Im MVP gibt es genau zwei
  Rollen (`employee`, `admin`); eine Tabelle mit Join wäre Vorratsdatenhaltung für eine
  Feingranularität, die niemand bestellt hat. Der benannte Erweiterungspunkt aus
  [ADR-0013] (`topic_permissions`) bleibt davon unberührt.
* **Rollen weiter ausschließlich aus dem Cookie:** war der Zustand vor diesem ADR. Ein
  Entzug hätte bis zum Cookie-Ablauf gewirkt, also praktisch nicht — für ein Recht, das den
  Versand an ~5.000 Empfänger auslöst, zu wenig.
* **Eine dauerhaft wirksame Admin-Liste in der Konfiguration** statt der
  Bootstrap-Bedingung: einfacher, aber eine unentziehbare Berechtigung in einer Datei —
  und bei offener Selbstregistrierung eine Hintertür.
