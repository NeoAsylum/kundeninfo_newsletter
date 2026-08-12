# python:3.12-slim, per Digest gepinnt (Plan 9.7); Aktualisierung: RUNBOOK "Image-Rebuild"
FROM python:3.12-slim@sha256:46cb7cc2877e60fbd5e21a9ae6115c30ace7a077b9f8772da879e4590c18c2e3

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

WORKDIR /app
# requirements.txt ist die menschenlesbare Quelle; requirements.lock wird per
# pip-compile --generate-hashes daraus erzeugt (ADR-0026, RUNBOOK "Lockfile & SBOM").
# --require-hashes installiert ausschließlich exakt gepinnte, verifizierte Artefakte.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY alembic.ini ./
COPY app ./app
COPY scripts ./scripts

USER app
EXPOSE 8000

# Entrypoint führt Migrationen aus (mit DB-Warteschleife), dann exec CMD.
# Fest workers=1: Der Outbox-Worker setzt Single-Process voraus (ADR-004, Plan 6.3).
ENTRYPOINT ["sh", "scripts/entrypoint.sh"]
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
