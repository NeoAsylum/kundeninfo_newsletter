"""JSON-Logging auf stdout (12-Factor) mit Request-ID-Korrelation.

Logs enthalten bewusst KEINE Empfänger-Mailadressen (Datenminimierung, Plan 3.3) —
zur Diagnose genügen dispatch_id/recipient_id.
"""

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Die Anwendung selbst übergibt keine Adressen ans Log — fremde Fehlertexte tragen sie aber:
# PostgreSQL nennt bei einem Unique-Verstoß den Schlüsselwert in seiner DETAIL-Zeile
# („Key (email)=(mia@example.corp) already exists“), ein SMTP-Server den abgelehnten
# Empfänger. Deshalb ersetzt der Formatter in Meldung und Traceback alles, was wie eine
# Adresse aussieht (ADR-0014): Adresszeichen, „@“, Adresszeichen.
# Adresszeichen sind genau die, die die Anmeldung in einer Adresse annimmt (core/oidc.py,
# per Test gleich gehalten): alles außer Leerraum, Steuerzeichen, Trennern und Klammern.
# Was die Anmeldung als Adresse speichert, verschwindet damit ganz — und mit ihm, was ohne
# Trenner daran hängt: Aus „postgresql://app:geheim@postgres:5432/db“ wird „<adresse>“.
# Auf beiden Seiten des „@“ gelten dieselben Zeichen, und ein Treffer läuft über weitere „@“
# hinweg: Sonst bliebe von zwei Adressen, die ein solches Zeichen verbindet („a@b+c@d“), ein
# Teil stehen.
# Die Grenze vorn (kein Adresszeichen davor) ändert nicht, was ersetzt wird, wohl aber den
# Aufwand: Ohne sie begänne die Suche an jedem Zeichen einer langen Kette neu — ein Pfad aus
# 8 000 Buchstaben im Access-Log hielte den einzigen Prozess rund eine Sekunde an.
_ZEICHEN = r"""[^@\s\x00-\x1f\x7f,;<>()\[\]"\\]"""
_ADRESSE = re.compile(f"(?<!{_ZEICHEN}){_ZEICHEN}+(?:@{_ZEICHEN}+)+")
_ERSATZ = "<adresse>"


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
            "msg": _ADRESSE.sub(_ERSATZ, record.getMessage()),
            "request_id": request_id_var.get(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            data["exc"] = _ADRESSE.sub(_ERSATZ, self.formatException(record.exc_info))
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
