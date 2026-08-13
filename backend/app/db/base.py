from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(database_url: str) -> AsyncEngine:
    # pool_recycle deckt abgestandene Verbindungen ab (Konzern-Firewalls trennen
    # Idle-Connections gern), pool_pre_ping zusätzlich als Gürtel-und-Hosenträger.
    #
    # Session-Zeitzone fest auf UTC: server_default NOW() (created_at, audit_log.ts)
    # und app-seitige naive utcnow()-Zeitstempel müssen dieselbe Quelle haben —
    # sonst verschieben sich Rückstau-Check und Retention, sobald die externe
    # Konzern-DB nicht in UTC läuft. Bei psycopg/PostgreSQL über die libpq-Option
    # `-c timezone=UTC`.
    # hide_parameters: Ohne das hängt SQLAlchemy an JEDE DBAPI-Fehlermeldung den
    # Block "[parameters: (...)]" — bei einem Unique-Verstoß oder DB-Aussetzer während
    # eines Versands stünde die Empfängeradresse damit im Klartext im Traceback und
    # über log.exception im Anwendungslog. Genau das schließt ADR-0014 aus; der
    # Query-String-Filter in core/logging.py deckt nur Formatargumente ab, nicht
    # exc_info. Nachgestellt: "duplicate key value violates unique constraint …".
    return create_async_engine(
        database_url,
        pool_recycle=1800,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"options": "-c timezone=UTC"},
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
