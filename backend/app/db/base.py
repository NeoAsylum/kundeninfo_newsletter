from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(database_url: str) -> AsyncEngine:
    # Kein pool_pre_ping: SQLAlchemys Ping ist mit aiomysql inkompatibel
    # (ping() ohne reconnect-Argument, ADR-0019). pool_recycle deckt abgestandene
    # Verbindungen ab (Konzern-Firewalls trennen Idle-Connections gern).
    #
    # Session-Zeitzone fest auf UTC: server_default NOW() (created_at, audit_log.ts)
    # und app-seitige naive utcnow()-Zeitstempel müssen dieselbe Quelle haben —
    # sonst verschieben sich Rückstau-Check und Retention, sobald die externe
    # Konzern-DB nicht in UTC läuft.
    # hide_parameters: Ohne das hängt SQLAlchemy an JEDE DBAPI-Fehlermeldung den
    # Block "[parameters: (...)]" — bei einem Unique-Verstoß oder DB-Aussetzer während
    # eines Versands stünde die Empfängeradresse damit im Klartext im Traceback und
    # über log.exception im Anwendungslog. Genau das schließt ADR-0014 aus; der
    # Query-String-Filter in core/logging.py deckt nur Formatargumente ab, nicht
    # exc_info. Nachgestellt: "Duplicate entry 'geheim@…' for key 'uq_users_email'".
    return create_async_engine(
        database_url,
        pool_recycle=1800,
        hide_parameters=True,
        connect_args={"init_command": "SET time_zone = '+00:00'"},
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
