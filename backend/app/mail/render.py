"""E-Mail-Rendering (Plan 6.5): Jinja2, HTML + Plaintext, Outlook-tauglich.

Versand-Maske (Preview-Endpunkt) und echter Versand nutzen exakt diese
Funktionen — die Vorschau kann nie lügen.
"""

from jinja2 import Environment, PackageLoader
from markupsafe import Markup, escape

from app.core.config import Settings
from app.db.models import Severity

SEVERITY_META: dict[Severity, dict[str, str]] = {
    Severity.stoerung: {
        "prefix": "STÖRUNG",
        "header": "IT-STÖRUNGSMELDUNG",
        "badge": "KRITISCH",
        "color": "#C0392B",
    },
    Severity.einschraenkung: {
        "prefix": "EINSCHRÄNKUNG",
        "header": "IT-EINSCHRÄNKUNG",
        "badge": "EINSCHRÄNKUNG",
        "color": "#F1C40F",
    },
    Severity.entwarnung: {
        "prefix": "ENTWARNUNG",
        "header": "ENTWARNUNG",
        "badge": "ENTWARNUNG",
        "color": "#27AE60",
    },
}

TITLE_MAX_LENGTH = 150


def _nl2br(value: str) -> Markup:
    return Markup("<br>\n".join(escape(line) for line in str(value).splitlines()))


_env = Environment(
    loader=PackageLoader("app.mail", "templates"),
    autoescape=lambda name: name is not None and name.endswith("html.j2"),
)
_env.filters["nl2br"] = _nl2br


def build_subject(severity: Severity, topic_name: str, title: str) -> str:
    return f"[{SEVERITY_META[severity]['prefix']}] {topic_name}: {title}"


def render_mail(
    settings: Settings,
    severity: Severity,
    topic_name: str,
    title: str,
    body: str,
) -> tuple[str, str]:
    """Rendert (html, text) für eine Störungsmeldung.

    Der Footer ist für alle Empfänger identisch (Null-Tracking, Plan 10.1).
    """
    base_url = settings.public_base_url.rstrip("/")
    context = {
        "meta": SEVERITY_META[severity],
        "topic_name": topic_name,
        "title": title,
        "body": body,
        "settings_url": f"{base_url}/abos.html",
        "privacy_url": f"{base_url}/datenschutz.html",
    }
    html = _env.get_template("notification.html.j2").render(**context)
    text = _env.get_template("notification.txt.j2").render(**context)
    return html, text
