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
$PLocFiles = @("-f", "compose.yaml", "-f", "compose.db.yaml", "-f", "compose.prod.yaml")
$ProdFiles = @("-f", "compose.yaml", "-f", "compose.prod.yaml")

function Fail-IfError { if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }

switch ($Target) {
    "install" {
        pip install -r backend/requirements.txt -r backend/requirements-dev.txt
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
    "prod-localdb" {
        $env:GIT_SHA = (git rev-parse --short HEAD)
        docker compose @PLocFiles up -d --build --wait
    }
    "prod" {
        $env:GIT_SHA = (git rev-parse --short HEAD)
        docker compose @ProdFiles up -d --build --wait
    }
    "lint" {
        ruff check backend; Fail-IfError
        ruff format --check backend; Fail-IfError
        mypy backend/app
    }
    "format" {
        ruff format backend
        ruff check --fix backend
    }
    "test" {
        Push-Location backend
        try { python -m pytest tests/unit -q } finally { Pop-Location }
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
        trivy image --severity HIGH,CRITICAL --exit-code 1 "stoerungsinfo-api:local"; Fail-IfError
        trivy image --severity HIGH,CRITICAL --exit-code 1 "stoerungsinfo-nginx:local"
    }
    "check" {
        & $PSCommandPath lint; Fail-IfError
        & $PSCommandPath test; Fail-IfError
        & $PSCommandPath test-db; Fail-IfError
    }
    default {
        Write-Output "Unbekanntes Target '$Target'. Verfügbar: install, dev, dev-down, ps, logs, prod-localdb, prod, lint, format, test, test-db, test-db-down, test-integration, seed, smoke, scan, check"
        exit 1
    }
}
exit $LASTEXITCODE
