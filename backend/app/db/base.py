from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(database_url: str) -> AsyncEngine:
    # Kein pool_pre_ping: SQLAlchemys Ping ist mit aiomysql inkompatibel
    # (ping() ohne reconnect-Argument). pool_recycle deckt abgestandene
    # Verbindungen ab (Konzern-Firewalls trennen Idle-Connections gern).
    return create_async_engine(database_url, pool_recycle=1800)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
