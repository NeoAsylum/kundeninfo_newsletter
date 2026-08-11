"""JSON-Logging auf stdout (12-Factor) mit Request-ID-Korrelation.

Logs enthalten bewusst KEINE Empfänger-Mailadressen (Datenminimierung, Plan 3.3) —
zur Diagnose genügen dispatch_id/recipient_id.
"""

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class QueryStringFilter(logging.Filter):
    """Entfernt Query-Parameter aus Log-Einträgen.

    uvicorn.access protokolliert den vollen Pfad, und die Empfänger- bzw.
    Rollen-Maske sucht per `?query=<mailadresse>` — damit stünden Empfängeradressen
    im Log, was ADR-0014 ausschließt. Die Route bleibt erhalten (sie ist das, was
    man zur Diagnose braucht), die Parameter werden ersetzt.

    Sitzt am Handler und nicht an einem einzelnen Logger, damit auch künftige
    Aufrufer erfasst sind, die einen Pfad als Formatargument übergeben.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple):
            return True
        ersetzt = [
            wert.split("?", 1)[0] + "?<entfernt>"
            if isinstance(wert, str) and "?" in wert and wert.startswith("/")
            else wert
            for wert in args
        ]
        if ersetzt != list(args):
            record.args = tuple(ersetzt)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data: dict[str, object] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(QueryStringFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # uvicorn-Logger laufen über den Root-Handler mit (einheitliches Format)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
