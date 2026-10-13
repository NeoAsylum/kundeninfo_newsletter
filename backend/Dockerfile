# python:3.14.8-slim, per Digest gepinnt (Plan 9.7). Nicht älter als 3.14.5: Bis 3.14.4
# lief ein inkrementeller Garbage Collector, der unter Last Speicher band.
FROM python:3.14.8-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

WORKDIR /app
# requirements.txt ist die menschenlesbare Quelle; requirements.lock wird per
# pip-compile --generate-hashes daraus erzeugt (ADR-0026, RUNBOOK 5b).
# --require-hashes installiert ausschließlich exakt gepinnte, verifizierte Artefakte.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY alembic.ini ./
COPY app ./app
COPY scripts ./scripts

# Erst hier: Der Wert ändert sich mit jedem Commit — weiter oben würfe er den Cache der
# Abhängigkeits-Schicht bei jedem Build weg.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

USER app
EXPOSE 8000

# Entrypoint führt Migrationen aus (mit DB-Warteschleife), dann exec CMD.
# Fest workers=1: Der Outbox-Worker setzt Single-Process voraus (ADR-004, Plan 6.3).
ENTRYPOINT ["sh", "scripts/entrypoint.sh"]
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
