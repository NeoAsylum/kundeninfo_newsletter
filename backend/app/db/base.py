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
    return create_async_engine(
        database_url,
        pool_recycle=1800,
        connect_args={"init_command": "SET time_zone = '+00:00'"},
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
