"""Statische Prüfungen des Frontends — ohne Browser, ohne Node.

Die Verhaltenstests laufen im Browser (frontend/tests, ADR-0029). Hier steht, was sich
schon aus den Dateien ablesen lässt und deshalb in `make test` mitläuft: ein Verstoß
gegen die CSP (ADR-0020: script-src 'self', also keine Inline-Skripte/-Handler) — der
Browser meldet ihn erst, wenn der betroffene Handler tatsächlich feuert — und eine
Element-ID, die das Seitenskript anspricht, die Seite aber nicht (mehr) hat.
"""

import pathlib
import re
from html.parser import HTMLParser

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]
PUBLIC = REPO / "frontend" / "public"
SEITEN = sorted(PUBLIC.glob("*.html"))
SKRIPTE = sorted(PUBLIC.glob("*.js"))
# Mit exakter Schreibweise: Unter Windows fände is_file() auch /Assets/App.css, das NGINX
# im Linux-Container mit 404 beantwortet.
DATEIEN = {p.relative_to(PUBLIC).as_posix() for p in PUBLIC.rglob("*") if p.is_file()}
# Diese Pfade beantwortet nicht die Statik, sondern das Backend (app-locations.inc)
BACKEND_PFADE = ("/api/", "/auth/", "/healthz", "/readyz")

# el("…"), byId("…"), document.getElementById("…") mit festem Namen
ID_ZUGRIFF = re.compile(r"""(?:\bel|\bbyId|getElementById)\(\s*["']([^"']+)["']\s*\)""")


class Seite(HTMLParser):
    def __init__(self, datei: pathlib.Path) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.skripte: list[str | None] = []
        self.verweise: list[str] = []
        self.handler: list[str] = []
        self.inline_skript = ""
        self._in_skript = False
        self.feed(datei.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs):
        attribute = dict(attrs)
        if "id" in attribute:
            self.ids.append(attribute["id"])
        self.handler += [f"<{tag} {name}>" for name in attribute if name.startswith("on")]
        if tag == "script":
            self._in_skript = True
            self.skripte.append(attribute.get("src"))
        for name in ("src", "href"):
            if attribute.get(name):
                self.verweise.append(attribute[name])

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_skript = False

    def handle_data(self, data):
        if self._in_skript:
            self.inline_skript += data.strip()

    @property
    def lokale_skripte(self) -> list[str]:
        return [src.split("?")[0].lstrip("/") for src in self.skripte if src]


def _id(datei: pathlib.Path) -> str:
    return datei.name


def test_frontend_wird_gefunden():
    """Ohne diesen Test liefen die parametrisierten Prüfungen nach einem Umzug des
    Verzeichnisses einfach leer — und grün."""
    assert len(SEITEN) >= 7
    assert PUBLIC / "app.js" in SKRIPTE


@pytest.mark.parametrize("datei", SEITEN, ids=_id)
def test_keine_inline_skripte_und_handler(datei):
    seite = Seite(datei)
    assert all(seite.skripte), "<script> ohne src — die CSP blockiert Inline-Skripte"
    assert seite.inline_skript == ""
    assert seite.handler == [], "Inline-Handler (onclick & Co.) blockiert die CSP"
    assert not [v for v in seite.verweise if v.strip().lower().startswith("javascript:")]


@pytest.mark.parametrize("datei", SEITEN, ids=_id)
def test_verweise_zeigen_auf_vorhandene_dateien(datei):
    for verweis in Seite(datei).verweise:
        pfad = verweis.split("?")[0].split("#")[0]
        if pfad in ("", "/") or pfad.startswith(BACKEND_PFADE):
            continue  # "#" (Logout-Link), Startseite, Routen des Backends
        assert "//" not in pfad and ":" not in pfad, f"externes Ziel: {verweis}"
        # Auch relative Verweise — alle Seiten liegen im Wurzelverzeichnis
        assert pfad.lstrip("/") in DATEIEN, f"{verweis} fehlt (Schreibweise beachten)"


@pytest.mark.parametrize("datei", SEITEN, ids=_id)
def test_seitenskript_findet_seine_elemente(datei):
    """Ein Tippfehler in einer ID ergibt `null` und damit erst zur Laufzeit einen
    TypeError — in genau der Maske, die jemand gerade braucht."""
    seite = Seite(datei)
    doppelt = {i for i in seite.ids if seite.ids.count(i) > 1}
    assert not doppelt, f"doppelte IDs: {doppelt}"

    seitenskripte = [s for s in seite.lokale_skripte if s != "app.js"]
    if not seitenskripte:
        return  # index.html, datenschutz.html: rein statisch
    # Seitenskripte rufen beim Laden App.* auf — app.js muss davor stehen
    assert seite.lokale_skripte[0] == "app.js"
    for skript in seitenskripte:
        quelltext = (PUBLIC / skript).read_text(encoding="utf-8")
        fehlend = sorted(set(ID_ZUGRIFF.findall(quelltext)) - set(seite.ids))
        assert not fehlend, f"{skript} greift auf IDs zu, die {datei.name} nicht hat: {fehlend}"


@pytest.mark.parametrize("datei", SKRIPTE, ids=_id)
def test_skripte_erzeugen_nichts_was_die_csp_blockiert(datei):
    quelltext = datei.read_text(encoding="utf-8")
    assert not re.search(r"\beval\(|\bnew Function\(|document\.write\(", quelltext)
    assert not re.search(r"""set(?:Timeout|Interval)\(\s*["'`]""", quelltext)
    # Handler-Attribute in per innerHTML erzeugtem Markup oder per setAttribute
    assert not re.search(r"<[a-zA-Z][^<>]*[\s\"'/]on[a-z]+\s*=", quelltext, re.I)
    assert not re.search(r"""setAttribute\(\s*["'`]on""", quelltext, re.I)
    assert "javascript:" not in quelltext.lower()


def test_public_enthaelt_nur_das_ausgelieferte_frontend():
    """frontend/public wird 1:1 ins NGINX-Image kopiert — Tests und npm-Dateien gehören
    nach frontend/tests (ADR-0029). Erlaubt ist nur, was die Seiten wirklich brauchen."""
    fremd = [
        datei
        for datei in sorted(DATEIEN)
        if not datei.endswith((".html", ".js", ".css", ".svg", ".ico", ".png"))
        or datei.endswith((".spec.js", ".test.js"))
        or "node_modules" in datei
    ]
    assert fremd == []


def test_hidden_attribut_gewinnt_gegen_display_regeln():
    """Die Skripte blenden ausschließlich über `hidden` aus. Ohne diese Regel überstimmt
    jede display-Angabe im Stylesheet das Attribut — der Knopf bleibt sichtbar, obwohl
    das Skript ihn versteckt hat (so geschehen mit „Mehr laden" und den Admin-Links)."""
    css = (PUBLIC / "assets" / "app.css").read_text(encoding="utf-8")
    regel = re.search(r"\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}", css)
    assert regel
    # … und zwar unbedingt, nicht innerhalb einer @media-Klammer
    davor = css[: regel.start()]
    assert davor.count("{") == davor.count("}")
    # Keine zweite !important-Angabe für display, die das Attribut wieder überstimmt
    assert len(re.findall(r"display:[^;}]*!important", css)) == 1


def test_cache_busting_ist_einheitlich():
    """Alle Seiten hängen dieselbe Version an Stylesheet und Skripte (?v=N). Wer app.js
    ändert und nur eine Seite hochzählt, liefert den übrigen den alten Stand aus dem
    Browser-Cache — zusammen mit neuen Seitenskripten."""
    versionen = set()
    for datei in SEITEN:
        for verweis in Seite(datei).verweise:
            if verweis.startswith("/") and verweis.split("?")[0].endswith((".css", ".js")):
                versionen.add(verweis.partition("?")[2])
    assert len(versionen) == 1 and re.fullmatch(r"v=\d+", versionen.pop())


def test_statik_wird_bei_jedem_aufruf_revalidiert():
    """Die ?v=N-Marken stehen in der HTML-Seite — sie wirken nur, wenn der Browser die Seite
    selbst beim Server nachfragt. Ohne Cache-Control hält er sie heuristisch für frisch und
    zeigt nach einem Deploy die alte Seite gegen die neue API."""
    datei = REPO / "deploy" / "nginx" / "includes" / "app-locations.inc"
    statik = datei.read_text(encoding="utf-8").split("location / {", 1)[1].split("}", 1)[0]
    assert re.search(r'^\s*add_header\s+Cache-Control\s+"no-cache"\s+always;', statik, re.M)
    # add_header in der Location ersetzt die geerbten nicht — die Sicherheits-Header kommen
    # per include aus derselben Location und bleiben deshalb erhalten.
    assert "include /etc/nginx/includes/security-headers.inc;" in statik


def test_die_suche_nach_adressen_schreibt_kein_nginx_fehlerlog():
    """Empfänger- und Rollen-Maske suchen per ?query=<adresse>. NGINX nennt im Fehlerlog zu
    jedem Fehler die ganze Anfragezeile — antwortet die API nicht, stünde die gesuchte Adresse
    darin (ADR-0014). Der Pfad hat deshalb eine eigene Location ohne Fehlerlog: Sie muss sonst
    dasselbe tun wie /api/ und genau der Pfad sein, den die Seiten abfragen."""
    text = (REPO / "deploy" / "nginx" / "includes" / "app-locations.inc").read_text("utf-8")

    def rumpf(kopf: str) -> list[str]:
        zeilen = text.split(kopf + " {", 1)[1].split("\n}", 1)[0].splitlines()
        return [z.strip() for z in zeilen if z.strip() and not z.strip().startswith("#")]

    suche = rumpf("location = /api/v1/admin/users")
    assert suche[0] == "error_log /dev/null;"
    assert suche[1:] == rumpf("location /api/")
    # Kein anderes Skript überträgt einen Suchbegriff in der URL, und diese beiden nur dort.
    mit_suchbegriff = {
        skript.name: re.findall(r'"(/[^"?]*)\?[^"]*\bquery=', skript.read_text("utf-8"))
        for skript in SKRIPTE
        if "query=" in skript.read_text("utf-8")
    }
    assert mit_suchbegriff == {
        "empfaenger.js": ["/api/v1/admin/users"],
        "rollen.js": ["/api/v1/admin/users"],
    }


def _server_bloecke(text: str) -> list[str]:
    """Die Rümpfe der server-Blöcke einer NGINX-Datei, ohne Kommentare."""
    # ${PUBLIC_HOST} ist ein Platzhalter der Vorlage, kein Block
    text = re.sub(r"\$\{\w+\}", "_", re.sub(r"#.*", "", text))
    bloecke = []
    for kopf in re.finditer(r"^\s*server\s*\{", text, re.M):
        tiefe, ende = 1, kopf.end()
        while tiefe:
            tiefe += {"{": 1, "}": -1}.get(text[ende], 0)
            ende += 1
        bloecke.append(text[kopf.end() : ende - 1])
    return bloecke


def test_kein_return_auf_serverebene_verdeckt_den_health_stub():
    """Der Container-Healthcheck fragt /nginx-health ab (compose.yaml). Ein „return“ direkt im
    server-Block greift vor jeder Location: Der Stub bliebe unerreichbar, und der Container
    gälte dauerhaft als „unhealthy“ — so stand es in der PROD-Vorlage (return 421)."""
    nginx = REPO / "deploy" / "nginx"
    gemeinsam = "include /etc/nginx/includes/app-locations.inc;"
    stub = "location = /nginx-health"
    assert stub in (nginx / "includes" / "app-locations.inc").read_text("utf-8")
    mit_stub = set()
    for datei in sorted((nginx / "conf.d").iterdir()):
        for rumpf in _server_bloecke(datei.read_text("utf-8")):
            if stub not in rumpf and gemeinsam not in rumpf:
                continue
            mit_stub.add(datei.name)
            # Locations zählen nicht zur Serverebene. Ein „if“ dort schon: Sein Rumpf läuft
            # ebenfalls, bevor NGINX eine Location wählt.
            serverebene = rumpf
            while "{" in serverebene:
                serverebene = re.sub(
                    r"([^;{}]*)\{([^{}]*)\}",
                    lambda block: block.group(2) if re.match(r"\s*if\b", block.group(1)) else "",
                    serverebene,
                )
            assert not re.search(r"\breturn\b", serverebene), datei.name
    # DEV, PROD und öffentlicher Betrieb: je die Datei, deren Port 80 den Healthcheck beantwortet
    assert {"app.dev.conf", "app.prod.conf.template", "app.public.conf.template"} <= mit_stub


@pytest.mark.parametrize("datei", [s for s in SEITEN if s.name != "index.html"], ids=_id)
def test_jede_seite_fuehrt_zum_datenschutzhinweis(datei):
    """Auf index.html gibt es nichts zu sehen (sie leitet nur weiter); der Hinweis selbst
    führt zurück zu den Abos."""
    ziel = "/abos.html" if datei.name == "datenschutz.html" else "/datenschutz.html"
    assert ziel in Seite(datei).verweise
