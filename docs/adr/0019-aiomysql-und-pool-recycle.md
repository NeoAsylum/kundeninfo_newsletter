# [ADR-0019] aiomysql + pool_recycle statt asyncmy + pool_pre_ping

* **Status:** Akzeptiert (Abweichung vom Plan 3.4-Beispiel)
* **Datum:** 2026-08-10
* **Kontext:** Der Plan nannte beispielhaft `mysql+asyncmy://`. Entwicklung findet auf Windows statt (Wheel-Verfügbarkeit), Laufzeit auf Linux im Container.

## Entscheidung

Async-Treiber **aiomysql** (Laufzeit) + **PyMySQL** (Alembic, synchron; `env.py` ersetzt `+aiomysql` → `+pymysql`). `pool_pre_ping` ist **deaktiviert**: SQLAlchemys MySQL-Ping ruft `ping()` ohne das von aiomysql geforderte `reconnect`-Argument auf (`TypeError` — real aufgetreten). Stattdessen `pool_recycle=1800`, das abgestandene Verbindungen abdeckt (Konzern-Firewalls trennen Idle-Connections gern).

## Konsequenzen

* **Positiv:** Identischer Treiberstack auf Windows-Dev und Linux-PROD; reine Python-Treiber ohne Kompilierung.
* **Negativ:** Eine seit > 30 min tote Verbindung fällt erst beim ersten Statement auf (ein Retry auf App-Ebene bzw. der nächste Request heilt das); bei Bedarf ist ein eigener Ping-Event-Handler der Erweiterungspunkt.

## Verworfene Alternativen

* **asyncmy:** schnell, aber Kompilat/Wheel-Risiko auf Windows; kein Messbedarf bei unserem Lastprofil.
* **pool_pre_ping erzwingen:** erfordert Workaround gegen die SQLAlchemy/aiomysql-Inkompatibilität — mehr Mechanik ohne Not.
