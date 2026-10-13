# Der CI-neutrale Vertrag (Plan 8.6): Jede CI und die VM rufen nur diese Targets.
# Windows-Entwicklung: .\make.ps1 <target> (dünner Wrapper, identische Namen).
SHELL := /bin/sh

COMPOSE_DEV  := docker compose -f compose.yaml -f compose.db.yaml -f compose.dev.yaml
# PROD immer mit DB-Overlay: PostgreSQL läuft als Container auf derselben VM (ADR-0030).
COMPOSE_PROD := docker compose -f compose.yaml -f compose.db.yaml -f compose.prod.yaml
GIT_SHA      := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BASE_URL     ?= http://localhost:8080
# Ohne node_modules scheitert npm mit „playwright: command not found“ — die Ursache nennen.
FRONTEND_READY = test -d frontend/tests/node_modules || \
	{ echo "Frontend-Testwerkzeug fehlt - erst: make install-frontend"; exit 1; }

.PHONY: help install install-frontend install-frontend-browser dev dev-down ps logs \
        prod prod-localdb lint format test test-frontend test-db test-db-down \
        test-integration seed smoke scan governance check

help: ## Targets anzeigen
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

install: ## Lokale Dev-Abhängigkeiten (pytest, ruff, ...)
	pip install -r backend/requirements.txt -r backend/requirements-dev.txt

install-frontend: ## Frontend-Testwerkzeug exakt aus dem Lockfile (Node >= 22, kein Browser-Download)
	cd frontend/tests && npm ci

install-frontend-browser: ## Ohne Edge/Chrome (CI): Chromium zur gepinnten Playwright-Version; Tests dann mit FRONTEND_BROWSER=chromium-headless-shell
	@$(FRONTEND_READY)
	cd frontend/tests && npm run install-browser

dev: ## DEV-Stack starten (nginx, api, postgres, keycloak, mailpit)
	$(COMPOSE_DEV) up -d --build --wait

dev-down: ## DEV-Stack stoppen (Volumes bleiben)
	$(COMPOSE_DEV) --profile test down

ps: ## Container-Status
	$(COMPOSE_DEV) ps

logs: ## Logs folgen (SERVICE=api eingrenzbar)
	$(COMPOSE_DEV) logs -f $(SERVICE)

prod: ## PROD-Stack starten (nginx, api, postgres)
	GIT_SHA=$(GIT_SHA) $(COMPOSE_PROD) up -d --build --wait

prod-localdb: prod ## Zweiter Name für prod (früherer Aufruf, bleibt gültig)

lint: ## Ruff (Lint + Formatprüfung) und mypy — Backend und der Generator der Governance-Unterlagen
	ruff check backend
	ruff format --check backend
	ruff check --config backend/pyproject.toml ops/governance.py
	ruff format --check --config backend/pyproject.toml ops/governance.py
	mypy --config-file backend/pyproject.toml backend/app ops/governance.py

format: ## Autoformat + Autofix
	ruff format backend
	ruff check --fix backend

test: ## Unit-Tests: ohne Docker/DB/Netz, < 30 s (Plan 8.1)
	cd backend && python -m pytest tests/unit -q

test-frontend: ## Frontend-Verhaltenstests im Browser (Edge/Chrome), ohne Server/Docker/Netz
	@$(FRONTEND_READY)
	cd frontend/tests && npm test

test-db: ## API-Tests gegen PostgreSQL-tmpfs (startet postgres-test)
	$(COMPOSE_DEV) --profile test up -d --wait postgres-test
	cd backend && python -m pytest tests/api -q

test-db-down: ## Test-DB stoppen
	$(COMPOSE_DEV) --profile test rm -sf postgres-test

test-integration: ## Integrationstests gegen den echten Compose-Stack (inkl. Mailpit)
	$(COMPOSE_DEV) up -d --build --wait
	cd backend && python -m pytest tests/integration -q -m integration

seed: ## Kanonischer Seed: Topics (per Migration) + Demo-Abos
	$(COMPOSE_DEV) exec api python -m app.seed

smoke: ## Smoke-Test nach Deploy (BASE_URL=https://... setzbar)
	python backend/scripts/smoke.py --base-url $(BASE_URL)

scan: ## Trivy-CVE-Scan der Images (Release-Gate, Plan 9.7)
	trivy image --severity HIGH,CRITICAL --exit-code 1 stoerungsinfo-api:$${IMAGE_TAG:-local}
	trivy image --severity HIGH,CRITICAL --exit-code 1 stoerungsinfo-nginx:$${IMAGE_TAG:-local}
	trivy image --severity HIGH,CRITICAL --exit-code 1 stoerungsinfo-postgres:$${IMAGE_TAG:-local}

governance: ## Stücklisten und Schwachstellenbericht neu erzeugen (docs/governance, braucht Netz)
	IMAGE_TAG=local $(COMPOSE_DEV) build
	python ops/governance.py erzeuge

check: lint test test-frontend test-db ## CI-Mindeststandard (Plan 8.6)
