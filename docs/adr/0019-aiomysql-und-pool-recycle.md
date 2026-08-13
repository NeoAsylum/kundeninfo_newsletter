# [ADR-0019] aiomysql + pool_recycle statt asyncmy + pool_pre_ping

* **Status:** **Abgelöst durch [ADR-0027](0027-postgresql-statt-mariadb.md)** (Wechsel auf PostgreSQL/psycopg3). Historischer Stand, solange der MySQL-Treiber im Einsatz war.
* **Datum:** 2026-08-10 (abgelöst 2026-08-13)
* **Kontext:** Der Plan nannte beispielhaft `mysql+asyncmy://`. Entwicklung findet auf Windows statt (Wheel-Verfügbarkeit), Laufzeit auf Linux im Container.

> **Hinweis (2026-08-13):** Mit dem Umstieg auf PostgreSQL entfällt die Grundlage dieser
> Entscheidung. psycopg3 deckt Laufzeit *und* Alembic mit **einem** Treiber ab (kein
> `+aiomysql`→`+pymysql`-Rewrite mehr), und `pool_pre_ping` ist wieder aktiv, weil die
> aiomysql-Ping-Inkompatibilität dort nicht existiert. Details in ADR-0027.

## Entscheidung

Async-Treiber **aiomysql** (Laufzeit) + **PyMySQL** (Alembic, synchron; `env.py` ersetzt `+aiomysql` → `+pymysql`). `pool_pre_ping` ist **deaktiviert**: SQLAlchemys MySQL-Ping ruft `ping()` ohne das von aiomysql geforderte `reconnect`-Argument auf (`TypeError` — real aufgetreten). Stattdessen `pool_recycle=1800`, das abgestandene Verbindungen abdeckt (Konzern-Firewalls trennen Idle-Connections gern).

## Konsequenzen

* **Positiv:** Identischer Treiberstack auf Windows-Dev und Linux-PROD; reine Python-Treiber ohne Kompilierung.
* **Negativ:** Eine seit > 30 min tote Verbindung fällt erst beim ersten Statement auf (ein Retry auf App-Ebene bzw. der nächste Request heilt das); bei Bedarf ist ein eigener Ping-Event-Handler der Erweiterungspunkt.

## Verworfene Alternativen

* **asyncmy:** schnell, aber Kompilat/Wheel-Risiko auf Windows; kein Messbedarf bei unserem Lastprofil.
* **pool_pre_ping erzwingen:** erfordert Workaround gegen die SQLAlchemy/aiomysql-Inkompatibilität — mehr Mechanik ohne Not.
