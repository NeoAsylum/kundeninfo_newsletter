"""Uvicorn-Einstiegspunkt (Container). Tests nutzen app.main.create_app direkt."""

from app.main import create_app

app = create_app()
