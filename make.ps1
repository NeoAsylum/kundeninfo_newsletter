# Windows-Komfort-Wrapper — Quelle der Wahrheit ist das Makefile (identische Targets).
# Aufruf: .\make.ps1 dev | test | test-db | check | ...
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Target,
    [string]$BaseUrl = "http://localhost:8080",
    [string]$Service = ""
)

$ErrorActionPreference = "Stop"
$DevFiles  = @("-f", "compose.yaml", "-f", "compose.db.yaml", "-f", "compose.dev.yaml")
# PROD immer mit DB-Overlay: PostgreSQL als Container auf derselben VM (ADR-0030).
$ProdFiles = @("-f", "compose.yaml", "-f", "compose.db.yaml", "-f", "compose.prod.yaml")

function Fail-IfError { if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }

# Ohne node_modules scheitert npm mit "playwright ... nicht gefunden" - die Ursache nennen.
function Assert-FrontendReady {
    if (-not (Test-Path "frontend/tests/node_modules")) {
        Write-Output "Frontend-Testwerkzeug fehlt - erst: .\make.ps1 install-frontend"
        exit 1
    }
}

switch ($Target) {
    "install" {
        pip install -r backend/requirements.txt -r backend/requirements-dev.txt
    }
    "install-frontend" {
        Push-Location frontend/tests
        try { npm ci } finally { Pop-Location }
    }
    "install-frontend-browser" {
        Assert-FrontendReady
        Push-Location frontend/tests
        try { npm run install-browser } finally { Pop-Location }
    }
    "dev" {
        docker compose @DevFiles up -d --build --wait
    }
    "dev-down" {
        docker compose @DevFiles --profile test down
    }
    "ps" {
        docker compose @DevFiles ps
    }
    "logs" {
        if ($Service) { docker compose @DevFiles logs -f $Service }
        else { docker compose @DevFiles logs -f }
    }
    "prod" {
        $env:GIT_SHA = (git rev-parse --short HEAD)
        docker compose @ProdFiles up -d --build --wait
    }
    "prod-localdb" {
        # Zweiter Name von prod (alter Aufruf, bleibt erhalten).
        & $PSCommandPath prod
    }
    "lint" {
        ruff check backend; Fail-IfError
        ruff format --check backend; Fail-IfError
        ruff check --config backend/pyproject.toml ops/governance.py; Fail-IfError
        ruff format --check --config backend/pyproject.toml ops/governance.py; Fail-IfError
        mypy --config-file backend/pyproject.toml backend/app ops/governance.py
    }
    "format" {
        ruff format backend; Fail-IfError
        ruff check --fix backend
    }
    "test" {
        Push-Location backend
        try { python -m pytest tests/unit -q } finally { Pop-Location }
    }
    "test-frontend" {
        Assert-FrontendReady
        Push-Location frontend/tests
        try { npm test } finally { Pop-Location }
    }
    "test-db" {
        docker compose @DevFiles --profile test up -d --wait postgres-test; Fail-IfError
        Push-Location backend
        try { python -m pytest tests/api -q } finally { Pop-Location }
    }
    "test-db-down" {
        docker compose @DevFiles --profile test rm -sf postgres-test
    }
    "test-integration" {
        docker compose @DevFiles up -d --build --wait; Fail-IfError
        Push-Location backend
        try { python -m pytest tests/integration -q -m integration } finally { Pop-Location }
    }
    "seed" {
        docker compose @DevFiles exec api python -m app.seed
    }
    "smoke" {
        python backend/scripts/smoke.py --base-url $BaseUrl
    }
    "scan" {
        $tag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "local" }
        trivy image --severity HIGH,CRITICAL --exit-code 1 "stoerungsinfo-api:$tag"; Fail-IfError
        trivy image --severity HIGH,CRITICAL --exit-code 1 "stoerungsinfo-nginx:$tag"; Fail-IfError
        trivy image --severity HIGH,CRITICAL --exit-code 1 "stoerungsinfo-postgres:$tag"
    }
    "governance" {
        # Untersucht wird, was hier gebaut wird: immer unter dem Tag local (ops/governance.py)
        $env:IMAGE_TAG = "local"
        docker compose @DevFiles build; Fail-IfError
        python ops/governance.py erzeuge
    }
    "check" {
        & $PSCommandPath lint; Fail-IfError
        & $PSCommandPath test; Fail-IfError
        & $PSCommandPath test-frontend; Fail-IfError
        & $PSCommandPath test-db; Fail-IfError
    }
    default {
        Write-Output "Unbekanntes Target '$Target'. Targets: install, install-frontend, install-frontend-browser, dev, dev-down, ps, logs, prod, prod-localdb, lint, format, test, test-frontend, test-db, test-db-down, test-integration, seed, smoke, scan, governance, check"
        exit 1
    }
}
exit $LASTEXITCODE
