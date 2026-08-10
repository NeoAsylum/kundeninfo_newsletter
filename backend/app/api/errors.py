"""Einheitliche Fehlerantworten: {"detail": "...", "code": "STABILER_CODE"} (Plan 7.1)."""


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
