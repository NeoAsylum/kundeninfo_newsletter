"""Zentrale Zeitquelle (naive UTC, passend zu den DATETIME-Spalten).

Tests patchen app.core.clock.utcnow statt freezegun (Plan 8.6).
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
