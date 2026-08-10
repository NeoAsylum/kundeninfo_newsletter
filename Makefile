# Der CI-neutrale Vertrag (Plan 8.6): Jede CI und die VM rufen nur diese Targets.
# Windows-Entwicklung: .\make.ps1 <target> (dünner Wrapper, identische Namen).
SHELL := /bin/sh

COMPOSE_DEV  := docker compose -f compose.yaml -f compose.db.yaml -f compose.dev.yaml
COMPOSE_PLOC := docker compose -f compose.yaml -f compose.db.yaml -f compose.prod.yaml
COMPOSE_PROD := docker compose -f compose.yaml -f compose.prod.yaml
GIT_SHA      := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BASE_URL     ?= http://localhost:8080

.PHONY: help install dev dev-down ps logs prod-localdb prod lint format \
        test test-db test-db-down test-integration seed smoke scan check

help: ## Targets anzeigen
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

install: ## Lokale Dev-Abhängigkeiten (pytest, ruff, ...)
	pip install -r backend/requirements.txt -r backend/requirements-dev.txt

dev: ## DEV-Stack starten (nginx, api, mariadb, keycloak, mailpit)
	$(COMPOSE_DEV) up -d --build --wait

dev-down: ## DEV-Stack stoppen (Volumes bleiben)
	$(COMPOSE_DEV) --profile test down

ps: ## Container-Status
	$(COMPOSE_DEV) ps

logs: ## Logs folgen (SERVICE=api eingrenzbar)
	$(COMPOSE_DEV) logs -f $(SERVICE)

prod-localdb: ## Go-Live-Zustand: PROD mit lokaler Docker-DB (Plan 3.2)
	GIT_SHA=$(GIT_SHA) $(COMPOSE_PLOC) up -d --build --wait

prod: ## PROD nach DB-Cutover (externe DB, ohne DB-Overlay)
	GIT_SHA=$(GIT_SHA) $(COMPOSE_PROD) up -d --build --wait

lint: ## Ruff (Lint + Formatprüfung) und mypy
	ruff check backend
	ruff format --check backend
	mypy backend/app

format: ## Autoformat + Autofix
	ruff format backend
	ruff check --fix backend

test: ## Unit-Tests: ohne Docker/DB/Netz, < 30 s (Plan 8.1)
	cd backend && python -m pytest tests/unit -q

test-db: ## API-Tests gegen MariaDB-tmpfs (startet mariadb-test)
	$(COMPOSE_DEV) --profile test up -d --wait mariadb-test
	cd backend && python -m pytest tests/api -q

test-db-down: ## Test-DB stoppen
	$(COMPOSE_DEV) --profile test rm -sf mariadb-test

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

check: lint test test-db ## CI-Mindeststandard (Plan 8.6)
