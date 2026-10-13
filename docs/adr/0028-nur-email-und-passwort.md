# [ADR-0028] Nur E-Mail und Passwort — keine Namen, auch nicht im mitlaufenden IdP

* **Status:** Akzeptiert (löst den Absatz „Was nicht dazugehört“ aus [ADR-0025](0025-keine-personennamen.md) ab)
* **Datum:** 2026-10-07
* **Kontext:** ADR-0025 hat die Personennamen aus dem Portal genommen, den mitlaufenden
  Keycloak (DEV und Pilot) aber bewusst so gelassen: Vor- und Nachname blieben Pflichtfelder,
  weil sonst jeder Login an `VERIFY_PROFILE` hängen blieb. Die Folgen: Das
  Registrierungsformular fragte Namen ab, `create-user.sh` erfand welche aus der Adresse, und
  der Client bekam über den Default-Scope `profile` in **jedes** Token `name`, `given_name`,
  `family_name` und `preferred_username` — gleichgültig, welchen Scope die Anwendung anfragt.
  Entscheidung des Auftraggebers: Namen werden nicht gebraucht, E-Mail und Passwort genügen.

## Entscheidung

* **Anwendung:** fragt nur noch `openid email` an. Der Wert steht in `OIDC_SCOPES`
  (`openid` ist Pflicht) und nicht fest im Code — siehe Risiken.
* **Realm (`deploy/keycloak/realm-dev.json`):** Benutzerprofil ohne `firstName`/`lastName`;
  Client ohne den Default-Scope `profile` (explizite Liste `acr`, `basic`, `email`, `roles`,
  `web-origins`); Fixture-Konten ohne Namen.
* **Bestehende Realms:** Keycloak importiert einen vorhandenen Realm nicht neu. Deshalb zieht
  `deploy/vm/configure-realm.sh` denselben Stand nach — in dieser Reihenfolge: gespeicherte
  Namen leeren, Profil ändern, Scope vom Client nehmen. Fordert die laufende Anwendung
  `profile` noch an, bricht das Skript vorher ab.
* **Konto-Skripte:** `create-user.sh --name` und die Namensoptionen von
  `ops/create_dev_user.py` entfallen.

## Konsequenzen

* **Positiv:** Die Registrierung besteht aus E-Mail und Passwort. Das ID-Token trägt keine
  Namens-Claims mehr — nachgemessen an Keycloak 26.4 für frisch registrierte, per Skript
  angelegte und umgestellte Konten. Der Datenschutzhinweis nennt keinen Namen mehr.
* **Negativ / Risiken:**
  * **Anwendung und Realm hängen zusammen.** Ein Realm ohne `profile` lehnt eine Anfrage, die
    `profile` enthält, mit `invalid_scope` ab. Die Anwendung muss also zuerst ausgerollt sein
    (`deploy.sh` hält die Reihenfolge ein); ein Zurückrollen auf einen älteren Stand bricht
    die Anmeldung, bis der Scope dem Client wieder zugewiesen ist.
  * **Ein IdP, der die Adresse nur über `profile` liefert**, braucht den Scope weiterhin
    (`.env.example` nennt Entra mit `preferred_username`). Dann kommen Namens-Claims mit, die
    das Portal ignoriert. Welcher Fall beim Konzern-IdP gilt, ist offen (Frage B1).
  * **Reihenfolge auf bestehenden Realms.** Wird das Profil vor dem Leeren geändert, zeigt die
    Admin-API die Namen nicht mehr an und überschreibt sie auch nicht mehr — sie bleiben
    unsichtbar gespeichert. Ausweg: Profil vorübergehend mit
    `unmanagedAttributePolicy: ADMIN_EDIT` setzen, Namen leeren, Profil zurücksetzen.
  * **Ältere Sicherungen** der Keycloak-Datenbank enthalten die Namen weiter, bis sie aus
    der Aufbewahrung fallen — auch der Dump, den `deploy.sh` unmittelbar vor der Umstellung
    zieht.
  * Die explizite Scope-Liste nimmt Default-Scopes einer späteren Keycloak-Version nicht von
    selbst auf. Das Image ist per Digest gepinnt, es betrifft also nur ein bewusstes Upgrade.
  * `username` und `email` lassen sich aus dem Keycloak-Profil nicht entfernen; das Formular
    zeigt `username` nicht, weil die E-Mail der Anmeldename ist.

## Verworfene Alternativen

* **`profile` nur zum optionalen Scope machen:** hält ältere Anwendungsstände lauffähig,
  liefert auf Anfrage aber weiter `preferred_username` und gespeicherte Namen.
* **Scopes fest im Code:** einfacher, bricht aber `OIDC_EMAIL_CLAIM=preferred_username` ohne
  Ausweg — die IdP-Anbindung ist bewusst reine Konfiguration.
* **Namen weiter nur in der Anwendung ignorieren:** war der Stand nach ADR-0025; der IdP
  erhob und verschickte sie trotzdem.
