from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field

from app.mail.render import TITLE_MAX_LENGTH

SeverityLiteral = Literal["stoerung", "einschraenkung", "entwarnung"]


class MeOut(BaseModel):
    email: str
    roles: list[str]


class TopicOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_mandatory: bool
    subscribed: bool


class RecipientCountOut(BaseModel):
    topic_id: str
    count: int


# Zeichen, die einen Betreff ungültig machen: C0-Steuerzeichen, DEL und die
# Unicode-Zeilentrenner (NEL, LS, PS). EmailMessage prüft per str.splitlines(), das
# auch an den letzten dreien trennt.
_BETREFF_VERBOTEN = frozenset(map(chr, range(0x20))) | {"\x7f", "\x85", "\u2028", "\u2029"}


def _einzeilig(value: str | None) -> str | None:
    """Titel UND Verteilername landen im Betreff, und ein Zeilenumbruch dort lässt
    EmailMessage beim Bauen JEDER einzelnen Mail scheitern. Der Versand liefe für jeden
    Empfänger in einen permanenten Fehler — bemerkt erst im Worker, also nachdem der
    Auftrag angelegt ist. Hier ist die Stelle, an der man es dem Verfasser noch sagen kann.
    """
    if value is not None and not _BETREFF_VERBOTEN.isdisjoint(value):
        raise ValueError("darf keine Zeilenumbrüche oder Steuerzeichen enthalten")
    return value


Einzeilig = AfterValidator(_einzeilig)


class DispatchDraft(BaseModel):
    topic_id: str
    severity: SeverityLiteral
    title: Annotated[str, Einzeilig] = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    body: str = Field(min_length=1, max_length=100_000)


class DispatchCreate(DispatchDraft):
    """„Versand anlegen“: der Entwurf plus ein optionaler Schlüssel, an dem die API eine
    Wiederholung desselben Aufrufs erkennt (ADR-0031). Die Vorschau kennt ihn nicht."""

    # Vom Client je Meldung zufällig erzeugt; steht in keiner Antwort.
    idempotency_key: UUID | None = None


class PreviewOut(BaseModel):
    subject: str
    html: str


class DispatchOut(BaseModel):
    id: int
    topic_id: str
    topic_name: str
    severity: SeverityLiteral
    subject: str
    status: str
    recipient_count: int
    sent_count: int
    failed_count: int
    open_count: int
    created_at: datetime
    finished_at: datetime | None


class DispatchDetailOut(DispatchOut):
    body: str
    created_by_email: str | None


class AdminUserOut(BaseModel):
    """Empfänger-Verwaltung: bewusst OHNE last_login_at/created_at (Verhaltensdaten
    bleiben hinter der Betriebsrats-Klärung B5, Plan 10.1)."""

    id: int
    email: str
    is_active: bool
    # Im Portal vergebenes Adminrecht — die einzige Quelle dafür (ADR-0022)
    is_admin: bool
    subscribed_topic_ids: list[str]


class AdminUserListOut(BaseModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class AdminUserPatch(BaseModel):
    is_active: bool


class AdminTopicOut(BaseModel):
    """Verteiler-Verwaltung (ADR-0024). Die Zähler entscheiden über die Löschbarkeit:
    Versände blockieren ein echtes Löschen (Fremdschlüssel RESTRICT), Abos gehen
    dabei per CASCADE mit verloren — beides muss die Maske vorher zeigen können."""

    id: str
    name: str
    description: str | None
    is_mandatory: bool
    is_active: bool
    subscriber_count: int
    dispatch_count: int
    has_open_dispatch: bool


class TopicCreate(BaseModel):
    # Der Slug ist Primärschlüssel und steht in URLs; Fremdschlüssel zeigen darauf,
    # weshalb er nachträglich nicht mehr änderbar ist (ADR-0024).
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")
    name: Annotated[str, Einzeilig] = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_mandatory: bool = False


class TopicPatch(BaseModel):
    """Alle Felder optional — ausgewertet wird nur, was gesetzt wurde
    (`model_dump(exclude_unset=True)`), damit ein Teil-Update nichts leert.
    Der Slug fehlt bewusst: er ist Primärschlüssel mit Referenzen."""

    name: Annotated[str | None, Einzeilig] = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_mandatory: bool | None = None
    is_active: bool | None = None


class MeldungOut(BaseModel):
    """Meldungs-Historie für ALLE angemeldeten Nutzer (ADR-0023).

    Bewusst nur Inhalt: kein Zustellstatus, keine Empfängerzahlen und nicht, wer
    versendet hat. Zähler wären Auswertungsdaten über Empfänger (ADR-0014) und
    verrieten die Größe jedes Verteilers; der Absender ist ein personenbezogenes
    Datum eines Beschäftigten, das im Betriebsrats-Briefing nicht zugesagt ist.
    """

    id: int
    topic_id: str
    topic_name: str
    severity: SeverityLiteral
    subject: str
    body: str
    created_at: datetime


class MeldungListOut(BaseModel):
    items: list[MeldungOut]
    total: int
    limit: int
    offset: int
