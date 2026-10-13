# Software-Komponenten

<!-- Erzeugt von ops/governance.py — nicht von Hand ändern (RUNBOOK 5b). -->

Stand: 2026-10-13, Code `895b4d7`. Lesbare Fassung der Stücklisten in diesem Ordner (`*.cdx.json`, CycloneDX); maßgeblich sind die Dateien.
Urheber und Lizenzen stehen in den Abschnitten 2 und 3 so, wie die Komponenten sie selbst angeben — nachgeprüft sind sie dort nicht, und nicht jede Komponente nennt beides. Drei Ausnahmen folgen dem Lizenztext statt der Angabe: Jinja2 und uvloop (mehrdeutige Angabe) und die Pakete von nginx.org (Freitext). Abschnitt 1 ist von Hand gepflegt, nach den Lizenztexten der Projekte. Genannt werden Namen, keine E-Mail-Adressen.

## 1. Hauptkomponenten

| Komponente | Version | Aufgabe | Urheber | Lizenz | Image |
|---|---|---|---|---|---|
| Python (CPython) | 3.14.8 | Laufzeit der Anwendung | Python Software Foundation | `PSF-2.0` | api |
| NGINX | 1.30.5 | Reverse Proxy, liefert die Oberfläche aus | Igor Sysoev, Nginx, Inc. | `BSD-2-Clause` | nginx |
| PostgreSQL | 18.6 | Datenbank | PostgreSQL Global Development Group | `PostgreSQL` | postgres |
| gosu | 1.19 | wechselt beim Start des Datenbank-Containers von root auf das Dienstkonto | Tianon Gravi | `Apache-2.0` | postgres |
| Keycloak | 26.8.0 | Anmeldung in DEV und im Pilot — in PROD der IdP des Konzerns | Red Hat, Inc. und Mitwirkende (Projekt der CNCF) | `Apache-2.0` | keycloak |

Python und PostgreSQL sind in ihren Images aus dem Quelltext gebaut. Sie stehen in keinem Paketverzeichnis, der Scanner sieht sie nicht; die Stückliste des Image führt sie deshalb als von Hand ergänzte Komponente. Python trägt außerdem fest eingebaut libexpat 2.8.5 (Lizenz `MIT`), mpdecimal 2.5.1 (`BSD-2-Clause`), HACL* und macholib in sich; sie stehen in keiner Stückliste hier (welche es sind, sagt die Stückliste, die python.org zum Quelltext veröffentlicht; Versionen aus dem Image gelesen, Lizenzen aus den Lizenztexten im Quelltext von Python).

Unverändert bezogene Images, per Digest gepinnt, **nicht** in den Stücklisten:

| Image | Version | Aufgabe | Urheber | Lizenz |
|---|---|---|---|---|
| Mailpit | 1.31.5 | fängt Mails ab — nur DEV | Ralph Slooten | `MIT` |
| Certbot | 5.8.0 | holt das TLS-Zertifikat — nur Pilot | Electronic Frontier Foundation | `Apache-2.0` |

## 2. Python-Pakete der Anwendung (38)

Quelle: `stoerungsinfo-app.cdx.json` — alles, was im Image der Anwendung installiert ist. Autoren: die Angabe des Pakets; nennt es keine, seine Betreuer.

| Paket | Version | Lizenz | Autoren |
|---|---|---|---|
| aiosmtplib | 5.1.3 | `MIT` | Cole Maclean |
| alembic | 1.20.0 | `MIT` | Mike Bayer |
| annotated-doc | 0.0.5 | `MIT` | Sebastián Ramírez |
| annotated-types | 0.8.0 | `MIT` | Adrian Garcia Badaracco, Samuel Colvin, Zac Hatfield-Dodds |
| anyio | 4.15.1 | `MIT` | Alex Grönholm |
| certifi | 2026.7.22 | `MPL-2.0` | Kenneth Reitz |
| cffi | 2.1.1 | `MIT-0` | Armin Rigo, Maciej Fijalkowski |
| click | 8.5.0 | `BSD-3-Clause` | Pallets |
| cryptography | 50.0.2 | `Apache-2.0 OR BSD-3-Clause` | The Python Cryptographic Authority and individual contributors |
| fastapi | 0.143.0 | `MIT` | Sebastián Ramírez |
| greenlet | 3.5.6 | `MIT AND PSF-2.0` | Alexey Borzenkov |
| h11 | 0.16.0 | `MIT` | Nathaniel J. Smith |
| httpcore | 1.0.9 | `BSD-3-Clause` | Tom Christie |
| httptools | 0.9.0 | `MIT` | Yury Selivanov |
| httpx | 0.28.1 | `BSD-3-Clause` | Tom Christie |
| idna | 3.20 | `BSD-3-Clause` | Kim Davies |
| Jinja2 | 3.1.6 | `BSD-3-Clause` | Pallets |
| joserfc | 1.7.5 | `BSD-3-Clause` | Hsiaoming Yang |
| Mako | 1.4.3 | `MIT` | Mike Bayer |
| MarkupSafe | 3.0.4 | `BSD-3-Clause` | Pallets |
| opentelemetry-api | 1.45.1 | `Apache-2.0` | OpenTelemetry Authors |
| pip | 26.2.1 | `MIT` | The pip developers |
| psycopg | 3.3.6 | `LGPL-3.0-only` | Daniele Varrazzo |
| psycopg-binary | 3.3.6 | `LGPL-3.0-only` | Daniele Varrazzo |
| pycparser | 3.11 | `BSD-3-Clause` | Eli Bendersky |
| pydantic | 2.14.1 | `MIT` | Samuel Colvin, Eric Jolibois, Hasan Ramezani, Adrian Garcia Badaracco, Terrence Dorsey, David Montague, Serge Matveenko, Marcelo Trylesinski, Sydney Runkle, David Hewitt, Alex Hall, Victorien Plot |
| pydantic-settings | 2.15.0 | `MIT` | Samuel Colvin, Eric Jolibois, Hasan Ramezani |
| pydantic_core | 2.50.1 | `MIT` | Samuel Colvin, Adrian Garcia Badaracco, David Montague, David Hewitt, Sydney Runkle, Victorien Plot |
| python-dotenv | 1.2.4 | `BSD-3-Clause` | Saurabh Kumar |
| PyYAML | 6.0.3 | `MIT` | Kirill Simonov |
| SQLAlchemy | 2.1.4 | `MIT` | Mike Bayer |
| starlette | 1.7.0 | `BSD-3-Clause` | Tom Christie |
| typing-inspection | 0.4.4 | `MIT` | Victorien Plot |
| typing_extensions | 4.16.0 | `PSF-2.0` | Guido van Rossum, Jukka Lehtosalo, Łukasz Langa, Michael Lee |
| uvicorn | 0.54.0 | `BSD-3-Clause` | Tom Christie |
| uvloop | 0.23.0 | `MIT OR Apache-2.0` | Yury Selivanov |
| watchfiles | 1.3.0 | `MIT` | Samuel Colvin |
| websockets | 17.2 | `BSD-3-Clause` | Aymeric Augustin |

`pip` ist das Installationswerkzeug aus dem Basis-Image, kein Teil der Anwendung (in der Stückliste als `build-tool` gekennzeichnet).

### Was Python-Pakete in ihrer eigenen Stückliste nennen

Einige Pakete bringen eine eigene Stückliste mit: die Bibliotheken, aus denen ihr übersetzter Teil gebaut ist. Sie nennt auch, was nur zum Bau diente („nur zum Bau“; dort `scope: excluded`). Vollständig ist das nicht: Was ein Paket nicht selbst angibt, steht hier nicht (etwa libpq und OpenSSL in `psycopg-binary`, libuv in `uvloop`).

| Paket | Nennt | Version | Art | Lizenz | Urheber |
|---|---|---|---|---|---|
| cryptography | asn1 | 0.24.1 | Rust-Bibliothek | `BSD-3-Clause` | Alex Gaynor |
| cryptography | asn1_derive | 0.24.1 | Rust-Bibliothek | `BSD-3-Clause` | Alex Gaynor |
| cryptography | base64 | 0.23.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Marshall Pierce |
| cryptography | bitflags | 2.13.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| cryptography | cc | 1.4.0 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | Alex Crichton |
| cryptography | cfg-if | 1.0.4 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Crichton |
| cryptography | cryptography-cffi | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-crypto | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-keepalive | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-key-parsing | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-openssl | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-x509 | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | cryptography-x509-verification | 0.50.2 | Rust-Bibliothek | `Apache-2.0 OR BSD-3-Clause` | The cryptography developers |
| cryptography | find-msvc-tools | 0.1.9 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | – |
| cryptography | foreign-types | 0.3.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | Steven Fackler |
| cryptography | foreign-types-shared | 0.1.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | Steven Fackler |
| cryptography | heck | 0.5.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| cryptography | itoa | 1.0.18 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| cryptography | libc | 0.2.189 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| cryptography | once_cell | 1.21.4 | Rust-Bibliothek | `MIT OR Apache-2.0` | Aleksey Kladov |
| cryptography | openssl | 0.10.81 | Rust-Bibliothek | `Apache-2.0` | Steven Fackler |
| cryptography | openssl | 4.0.3 | aus Quelltext gebaut | – | – |
| cryptography | openssl-macros | 0.1.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| cryptography | openssl-sys | 0.9.117 | Rust-Bibliothek | `MIT` | Alex Crichton, Steven Fackler |
| cryptography | pem | 4.0.0 | Rust-Bibliothek | `MIT` | Jonathan Creekmore |
| cryptography | pkg-config | 0.3.33 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | Alex Crichton |
| cryptography | portable-atomic | 1.14.0 | Rust-Bibliothek | `Apache-2.0 OR MIT` | – |
| cryptography | proc-macro2 | 1.0.107 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay, Alex Crichton |
| cryptography | pyo3 | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| cryptography | pyo3-build-config | 0.29.2 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| cryptography | pyo3-ffi | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| cryptography | pyo3-macros | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| cryptography | pyo3-macros-backend | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| cryptography | quote | 1.0.47 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| cryptography | self_cell | 1.3.0 | Rust-Bibliothek | `Apache-2.0 OR GPL-2.0-only` | Lukas Bergdoll |
| cryptography | shlex | 2.0.1 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | comex, Fenhl, Adrian Taylor, Alex Touchet, Daniel Parks, Garrett Berg |
| cryptography | syn | 2.0.119 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| cryptography | target-lexicon | 0.13.5 | Rust-Bibliothek, nur zum Bau | `Apache-2.0 WITH LLVM-exception` | Dan Gohman |
| cryptography | unicode-ident | 1.0.24 | Rust-Bibliothek | `(MIT OR Apache-2.0) AND Unicode-3.0` | David Tolnay |
| cryptography | vcpkg | 0.2.15 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | Jim McGrath |
| pip | CacheControl | 0.14.4 | Python-Paket | – | – |
| pip | certifi | 2026.6.17 | Python-Paket | – | – |
| pip | distlib | 0.4.2 | Python-Paket | – | – |
| pip | distro | 1.9.0 | Python-Paket | – | – |
| pip | idna | 3.18 | Python-Paket | – | – |
| pip | msgpack | 1.1.2 | Python-Paket | – | – |
| pip | packaging | 26.2 | Python-Paket | – | – |
| pip | platformdirs | 4.10.0 | Python-Paket | – | – |
| pip | pygments | 2.20.0 | Python-Paket | – | – |
| pip | pyproject-hooks | 1.2.0 | Python-Paket | – | – |
| pip | requests | 2.34.2 | Python-Paket | – | – |
| pip | resolvelib | 1.2.1 | Python-Paket | – | – |
| pip | rich | 14.2.0 | Python-Paket | – | – |
| pip | setuptools | 70.3.0 | Python-Paket | – | – |
| pip | tomli | 2.4.1 | Python-Paket | – | – |
| pip | tomli-w | 1.2.0 | Python-Paket | – | – |
| pip | truststore | 0.10.4 | Python-Paket | – | – |
| pip | urllib3 | 2.7.0 | Python-Paket | – | – |
| psycopg-binary | cyrus-sasl-lib | 2.1.26-24.el7_9 | RPM-Paket aus dem Bau des Pakets | – | – |
| psycopg-binary | keyutils-libs | 1.5.8-3.el7 | RPM-Paket aus dem Bau des Pakets | – | – |
| psycopg-binary | krb5-libs | 1.15.1-55.el7_9 | RPM-Paket aus dem Bau des Pakets | – | – |
| psycopg-binary | libcom_err | 1.42.9-19.el7 | RPM-Paket aus dem Bau des Pakets | – | – |
| psycopg-binary | libselinux | 2.5-15.el7 | RPM-Paket aus dem Bau des Pakets | – | – |
| psycopg-binary | pcre | 8.32-17.el7 | RPM-Paket aus dem Bau des Pakets | – | – |
| pydantic_core | ahash | 0.8.12 | Rust-Bibliothek | `MIT OR Apache-2.0` | Tom Kaitchuck |
| pydantic_core | aho-corasick | 1.1.3 | Rust-Bibliothek | `Unlicense OR MIT` | Andrew Gallant |
| pydantic_core | autocfg | 1.3.0 | Rust-Bibliothek, nur zum Bau | `Apache-2.0 OR MIT` | Josh Stone |
| pydantic_core | base64 | 0.23.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | Marshall Pierce |
| pydantic_core | bitflags | 2.9.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | bitvec | 1.0.1 | Rust-Bibliothek | `MIT` | – |
| pydantic_core | bumpalo | 3.19.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Nick Fitzgerald |
| pydantic_core | cfg-if | 1.0.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Crichton |
| pydantic_core | displaydoc | 0.2.5 | Rust-Bibliothek | `MIT OR Apache-2.0` | Jane Lusby |
| pydantic_core | enum_dispatch | 0.3.13 | Rust-Bibliothek | `MIT OR Apache-2.0` | Anton Lazarev <https://antonok.com> |
| pydantic_core | foldhash | 0.2.0 | Rust-Bibliothek | `Zlib` | Orson Peters |
| pydantic_core | form_urlencoded | 1.2.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | The rust-url developers |
| pydantic_core | funty | 2.0.0 | Rust-Bibliothek | `MIT` | myrrlyn |
| pydantic_core | getrandom | 0.3.3 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rand Project Developers |
| pydantic_core | hashbrown | 0.17.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| pydantic_core | heck | 0.5.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| pydantic_core | hex | 0.4.3 | Rust-Bibliothek | `MIT OR Apache-2.0` | KokaKiwi |
| pydantic_core | icu_collections | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_locid | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_locid_transform | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_locid_transform_data | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_normalizer | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_normalizer_data | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_properties | 1.5.1 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_properties_data | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_provider | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | icu_provider_macros | 1.5.0 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | idna | 1.1.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | The rust-url developers |
| pydantic_core | idna_adapter | 1.2.0 | Rust-Bibliothek | `Apache-2.0 OR MIT` | The rust-url developers |
| pydantic_core | itoa | 1.0.11 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| pydantic_core | jiter | 0.16.0 | Rust-Bibliothek | `MIT` | Samuel Colvin |
| pydantic_core | js-sys | 0.3.77 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | lexical-parse-float | 1.0.5 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Huszagh |
| pydantic_core | lexical-parse-integer | 1.0.5 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Huszagh |
| pydantic_core | lexical-util | 1.0.6 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Huszagh |
| pydantic_core | libc | 0.2.185 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | litemap | 0.7.3 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | log | 0.4.27 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | lru | 0.18.5 | Rust-Bibliothek | `MIT` | Jerome Froelich |
| pydantic_core | memchr | 2.7.4 | Rust-Bibliothek | `Unlicense OR MIT` | Andrew Gallant, bluss |
| pydantic_core | num-bigint | 0.4.6 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | num-integer | 0.1.46 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | num-traits | 0.2.19 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| pydantic_core | once_cell | 1.21.3 | Rust-Bibliothek | `MIT OR Apache-2.0` | Aleksey Kladov |
| pydantic_core | percent-encoding | 2.3.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | The rust-url developers |
| pydantic_core | portable-atomic | 1.6.0 | Rust-Bibliothek | `Apache-2.0 OR MIT` | – |
| pydantic_core | proc-macro2 | 1.0.107 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay, Alex Crichton |
| pydantic_core | pyo3 | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| pydantic_core | pyo3-build-config | 0.29.2 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| pydantic_core | pyo3-ffi | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| pydantic_core | pyo3-macros | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| pydantic_core | pyo3-macros-backend | 0.29.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| pydantic_core | quote | 1.0.44 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| pydantic_core | r-efi | 5.2.0 | Rust-Bibliothek | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | – |
| pydantic_core | radium | 0.7.0 | Rust-Bibliothek | `MIT` | Nika Layzell, myrrlyn |
| pydantic_core | regex | 1.13.1 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers, Andrew Gallant |
| pydantic_core | regex-automata | 0.4.18 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers, Andrew Gallant |
| pydantic_core | regex-syntax | 0.8.11 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers, Andrew Gallant |
| pydantic_core | serde | 1.0.229 | Rust-Bibliothek | `MIT OR Apache-2.0` | Erick Tryzelaar, David Tolnay |
| pydantic_core | serde_core | 1.0.229 | Rust-Bibliothek | `MIT OR Apache-2.0` | Erick Tryzelaar, David Tolnay |
| pydantic_core | serde_derive | 1.0.229 | Rust-Bibliothek | `MIT OR Apache-2.0` | Erick Tryzelaar, David Tolnay |
| pydantic_core | serde_json | 1.0.151 | Rust-Bibliothek | `MIT OR Apache-2.0` | Erick Tryzelaar, David Tolnay |
| pydantic_core | smallvec | 1.16.2 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Servo Project Developers |
| pydantic_core | speedate | 0.17.0 | Rust-Bibliothek | `MIT` | Samuel Colvin |
| pydantic_core | stable_deref_trait | 1.2.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Robert Grosse |
| pydantic_core | static_assertions | 1.1.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Nikolai Vazquez |
| pydantic_core | strum | 0.27.2 | Rust-Bibliothek | `MIT` | Peter Glotfelty |
| pydantic_core | strum_macros | 0.27.2 | Rust-Bibliothek | `MIT` | Peter Glotfelty |
| pydantic_core | syn | 2.0.82 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| pydantic_core | syn | 3.0.6 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| pydantic_core | synstructure | 0.13.1 | Rust-Bibliothek | `MIT` | Nika Layzell |
| pydantic_core | tap | 1.0.1 | Rust-Bibliothek | `MIT` | Elliott Linder, myrrlyn |
| pydantic_core | target-lexicon | 0.13.4 | Rust-Bibliothek, nur zum Bau | `Apache-2.0 WITH LLVM-exception` | Dan Gohman |
| pydantic_core | tinystr | 0.7.6 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | unicode-ident | 1.0.12 | Rust-Bibliothek | `(MIT OR Apache-2.0) AND Unicode-DFS-2016` | David Tolnay |
| pydantic_core | url | 2.5.8 | Rust-Bibliothek | `MIT OR Apache-2.0` | The rust-url developers |
| pydantic_core | utf16_iter | 1.0.5 | Rust-Bibliothek | `Apache-2.0 OR MIT` | Henri Sivonen |
| pydantic_core | utf8_iter | 1.0.4 | Rust-Bibliothek | `Apache-2.0 OR MIT` | Henri Sivonen |
| pydantic_core | uuid | 1.23.4 | Rust-Bibliothek | `Apache-2.0 OR MIT` | Ashley Mannix, Dylan DPC, Hunar Roop Kahlon |
| pydantic_core | version_check | 0.9.5 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | Sergio Benitez |
| pydantic_core | wasi | 0.14.2+wasi-0.2.4 | Rust-Bibliothek | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | The Cranelift Project Developers |
| pydantic_core | wasm-bindgen | 0.2.100 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | wasm-bindgen-backend | 0.2.100 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | wasm-bindgen-macro | 0.2.100 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | wasm-bindgen-macro-support | 0.2.100 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | wasm-bindgen-shared | 0.2.100 | Rust-Bibliothek | `MIT OR Apache-2.0` | The wasm-bindgen Developers |
| pydantic_core | wit-bindgen-rt | 0.39.0 | Rust-Bibliothek | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | – |
| pydantic_core | write16 | 1.0.0 | Rust-Bibliothek | `Apache-2.0 OR MIT` | – |
| pydantic_core | writeable | 0.5.5 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | wyz | 0.5.1 | Rust-Bibliothek | `MIT` | myrrlyn |
| pydantic_core | yoke | 0.7.4 | Rust-Bibliothek | `Unicode-3.0` | Manish Goregaokar |
| pydantic_core | yoke-derive | 0.7.4 | Rust-Bibliothek | `Unicode-3.0` | Manish Goregaokar |
| pydantic_core | zerocopy | 0.8.25 | Rust-Bibliothek | `BSD-2-Clause OR Apache-2.0 OR MIT` | Joshua Liebow-Feeser, Jack Wrenn |
| pydantic_core | zerocopy-derive | 0.8.25 | Rust-Bibliothek | `BSD-2-Clause OR Apache-2.0 OR MIT` | Joshua Liebow-Feeser, Jack Wrenn |
| pydantic_core | zerofrom | 0.1.4 | Rust-Bibliothek | `Unicode-3.0` | Manish Goregaokar |
| pydantic_core | zerofrom-derive | 0.1.4 | Rust-Bibliothek | `Unicode-3.0` | Manish Goregaokar |
| pydantic_core | zerovec | 0.10.4 | Rust-Bibliothek | `Unicode-3.0` | The ICU4X Project Developers |
| pydantic_core | zerovec-derive | 0.10.3 | Rust-Bibliothek | `Unicode-3.0` | Manish Goregaokar |
| pydantic_core | zmij | 1.0.6 | Rust-Bibliothek | `MIT` | David Tolnay |
| watchfiles | bitflags | 2.7.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| watchfiles | cfg-if | 1.0.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Crichton |
| watchfiles | crossbeam-channel | 0.5.15 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| watchfiles | crossbeam-utils | 0.8.19 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| watchfiles | filetime | 0.2.24 | Rust-Bibliothek | `MIT OR Apache-2.0` | Alex Crichton |
| watchfiles | heck | 0.5.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | – |
| watchfiles | inotify | 0.11.0 | Rust-Bibliothek | `ISC` | Hanno Braun, Félix Saparelli, Cristian Kubis, Frank Denis |
| watchfiles | inotify-sys | 0.1.5 | Rust-Bibliothek | `ISC` | Hanno Braun |
| watchfiles | libc | 0.2.169 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| watchfiles | log | 0.4.22 | Rust-Bibliothek | `MIT OR Apache-2.0` | The Rust Project Developers |
| watchfiles | mio | 1.0.3 | Rust-Bibliothek | `MIT` | Carl Lerche, Thomas de Zeeuw, Tokio Contributors |
| watchfiles | notify | 8.0.0 | Rust-Bibliothek | `CC0-1.0` | Félix Saparelli, Daniel Faust, Aron Heinecke |
| watchfiles | notify-types | 2.0.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | Daniel Faust |
| watchfiles | once_cell | 1.21.3 | Rust-Bibliothek | `MIT OR Apache-2.0` | Aleksey Kladov |
| watchfiles | proc-macro2 | 1.0.81 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay, Alex Crichton |
| watchfiles | pyo3 | 0.29.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| watchfiles | pyo3-build-config | 0.29.0 | Rust-Bibliothek, nur zum Bau | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| watchfiles | pyo3-ffi | 0.29.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| watchfiles | pyo3-macros | 0.29.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| watchfiles | pyo3-macros-backend | 0.29.0 | Rust-Bibliothek | `MIT OR Apache-2.0` | PyO3 Project and Contributors <https://github.com/PyO3> |
| watchfiles | quote | 1.0.45 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| watchfiles | same-file | 1.0.6 | Rust-Bibliothek | `Unlicense OR MIT` | Andrew Gallant |
| watchfiles | syn | 2.0.60 | Rust-Bibliothek | `MIT OR Apache-2.0` | David Tolnay |
| watchfiles | target-lexicon | 0.13.5 | Rust-Bibliothek, nur zum Bau | `Apache-2.0 WITH LLVM-exception` | Dan Gohman |
| watchfiles | unicode-ident | 1.0.12 | Rust-Bibliothek | `(MIT OR Apache-2.0) AND Unicode-DFS-2016` | David Tolnay |
| watchfiles | walkdir | 2.5.0 | Rust-Bibliothek | `Unlicense OR MIT` | Andrew Gallant |

## 3. Inhalt der Images

Quelle: `stoerungsinfo-image-<name>.cdx.json`, von Trivy aus dem gebauten Image gelesen. Herausgeber ist bei Betriebssystem-Paketen der Betreuer des Pakets in der Distribution; Java-Bibliotheken und Go-Module nennen keinen. Liegt dieselbe Bibliothek an mehreren Stellen im Image, steht sie hier einmal.

### api — Anwendung (FastAPI, Versand-Worker)

Basis `python:3.14.8-slim`, debian 13.7. 87 × Debian-Paket. Dazu die Python-Pakete aus Abschnitt 2.

| Komponente | Version | Art | Lizenz | Herausgeber |
|---|---|---|---|---|
| adduser | 3.152 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only` | Debian Adduser Developers |
| apt | 3.0.3 | Debian-Paket | `GPL-2.0-or-later`, `curl`, `BSD-3-Clause`, `MIT`, `GPL-2.0-only` | APT Development Team |
| base-files | 13.8+deb13u7 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `verbatim` | Santiago Vila |
| base-passwd | 3.6.7 | Debian-Paket | `GPL-2.0-only`, `public-domain` | Shadow package maintainers |
| bash | 5.2.37-2+b10 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `GPL-2.0-or-later`, `GPL-2.0-only`, `GFDL-1.3-no-invariants-only`, `GFDL-1.3-only`, `Latex2e`, `BSD-4-Clause-UC`, `MIT`, `permissive` | Matthias Klose |
| bsdutils | 1:2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| ca-certificates | 20250419 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `MPL-2.0` | Julien Cristau |
| coreutils | 9.7-3 | Debian-Paket | `GPL-3.0-or-later`, `BSD-4-Clause-UC`, `GPL-3.0-only`, `ISC`, `FSFULLR`, `GFDL-1.3-no-invariants-only`, `GFDL-1.3-only` | Michael Stone |
| dash | 0.5.12-12 | Debian-Paket | `BSD-3-Clause`, `public-domain`, `GPL-2.0-or-later`, `GPL-2.0-only` | Andrej Shadura |
| debconf | 1.5.91 | Debian-Paket | `BSD-2-Clause` | Debconf Developers |
| debian-archive-keyring | 2025.1 | Debian-Paket | `GPL-2.0-or-later` | Debian Release Team |
| debianutils | 5.23.2 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `public-domain`, `SMAIL-GPL` | Ileana Dumitrescu |
| diffutils | 1:3.10-4 | Debian-Paket | `GPL-3.0-or-later`, `FSFULLR`, `LGPL-2.1-or-later`, `GPL-3.0-only WITH autoconf-exception+`, `GPL-3.0-only`, `GPL-3.0-or-later WITH texinfo-exception`, `LGPL-2.0-or-later`, `GPL-2.0-or-later`, `X11`, `FSFAP`, `GFDL-1.3-no-invariants-only`, `LGPL-3.0-or-later`, `LGPL-3.0-only`, `public-domain`, `LGPL-2.0-only`, `LGPL-2.1-only`, `GPL-2.0-only`, `GFDL-1.3-only` | Santiago Vila |
| dpkg | 1.22.22 | Debian-Paket | `GPL-2.0-or-later`, `public-domain-s-s-d`, `GPL-2.0-only` | Dpkg Developers |
| findutils | 4.10.0-3 | Debian-Paket | `GFDL-1.3-no-invariants-or-later`, `GPL-3.0-or-later`, `FSFAP`, `GPL-2.0-or-later WITH Autoconf-data-exception`, `GPL-3.0-or-later WITH Autoconf-data-exception`, `FSFULLR`, `GPL-2.0-or-later`, `X11`, `public-domain`, `LGPL-2.1-or-later`, `GPL-2.0-or-later WITH automake-exception`, `LGPL-2.0-or-later`, `LGPL-3.0-or-later`, `BSD-3-Clause`, `GPL-3.0-or-later WITH Bison-2.2-exception`, `LGPL-3.0-only`, `ISC`, `GFDL-1.3-only`, `GPL-2.0-only`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only` | Andreas Metzler |
| gcc-14-base | 14.2.0-19 | Debian-Paket | `GPL-2.0-or-later`, `GPL-3.0-only`, `GFDL-1.2-only`, `Artistic-2.0`, `LGPL-2.0-or-later` | Debian GCC Maintainers |
| grep | 3.11-4 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only` | Anibal Monsalve Salazar |
| gzip | 1.13-1+deb13u1 | Debian-Paket | `GPL-3.0-or-later`, `GFDL-1.3--no-invariant`, `FSF-manpages`, `GPL-3.0-only`, `GFDL-3` | Milan Kupcevic |
| hostname | 3.25 | Debian-Paket | `GPL-2.0-only` | Michael Meskes |
| init-system-helpers | 1.69~deb13u1 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-or-later`, `GPL-2.0-only` | Debian systemd Maintainers |
| libacl1 | 2.3.2-2+b1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `LGPL-2.0-or-later`, `LGPL-2.1-only` | Guillem Jover |
| libapt-pkg7.0 | 3.0.3 | Debian-Paket | `GPL-2.0-or-later`, `curl`, `BSD-3-Clause`, `MIT`, `GPL-2.0-only` | APT Development Team |
| libattr1 | 1:2.5.2-3 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `LGPL-2.0-or-later`, `LGPL-2.1-only` | Guillem Jover |
| libaudit-common | 1:4.0.2-2+deb13u1 | Debian-Paket | `GPL-2.0-only`, `LGPL-2.1-only`, `GPL-1.0-only` | Laurent Bigonville |
| libaudit1 | 1:4.0.2-2+deb13u1 | Debian-Paket | `GPL-2.0-only`, `LGPL-2.1-only`, `GPL-1.0-only` | Laurent Bigonville |
| libblkid1 | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| libbsd0 | 0.12.2-2 | Debian-Paket | `BSD-3-Clause`, `BSD-3-clause-Regents`, `BSD-2-Clause-NetBSD`, `BSD-3-clause-author`, `BSD-3-clause-John-Birrell`, `BSD-5-clause-Peter-Wemm`, `BSD-2-Clause`, `BSD-2-clause-verbatim`, `BSD-2-clause-author`, `ISC`, `ISC-Original`, `MIT`, `public-domain`, `Beerware` | Guillem Jover |
| libbz2-1.0 | 1.0.8-6 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-only` | Anibal Monsalve Salazar |
| libc-bin | 2.41-12+deb13u4 | Debian-Paket | `LGPL-2.1-or-later`, `LGPL-2.0-or-later`, `LGPL-2.1-or-later WITH link-exception`, `LGPL-3.0-or-later`, `GPL-2.0-or-later`, `GPL-2.0-or-later WITH link-exception`, `GPL-2.0-only`, `GPL-3.0-or-later`, `FSFAP`, `Carnegie`, `Inner-Net`, `MIT-like-Lord`, `BSD-like-Spencer`, `PCRE`, `BSD-3-clause-Carnegie`, `Unicode-DFS-2016`, `BSL-1.0`, `SunPro`, `CORE-MATH`, `BSD-3-clause-Berkeley`, `BSD-3-clause-WIDE`, `BSD-2-Clause`, `BSD-3-clause-Oracle`, `DEC`, `IBM`, `ISC`, `Univ-Coimbra`, `public-domain`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | GNU Libc Maintainers |
| libc6 | 2.41-12+deb13u4 | Debian-Paket | `LGPL-2.1-or-later`, `LGPL-2.0-or-later`, `LGPL-2.1-or-later WITH link-exception`, `LGPL-3.0-or-later`, `GPL-2.0-or-later`, `GPL-2.0-or-later WITH link-exception`, `GPL-2.0-only`, `GPL-3.0-or-later`, `FSFAP`, `Carnegie`, `Inner-Net`, `MIT-like-Lord`, `BSD-like-Spencer`, `PCRE`, `BSD-3-clause-Carnegie`, `Unicode-DFS-2016`, `BSL-1.0`, `SunPro`, `CORE-MATH`, `BSD-3-clause-Berkeley`, `BSD-3-clause-WIDE`, `BSD-2-Clause`, `BSD-3-clause-Oracle`, `DEC`, `IBM`, `ISC`, `Univ-Coimbra`, `public-domain`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | GNU Libc Maintainers |
| libcap-ng0 | 0.8.5-4+b1 | Debian-Paket | `LGPL-2.1-or-later`, `GPL-2.0-or-later`, `GPL-3.0-only`, `LGPL-2.1-only`, `GPL-2.0-only` | Håvard F. Aasen |
| libcap2 | 1:2.75-10+deb13u1+b3 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-only`, `GPL-2.0-or-later` | Christian Kastner |
| libcrypt1 | 1:4.4.38-1 | Debian-Paket | – | Marco d'Itri |
| libdb5.3t64 | 5.3.28+dfsg2-9 | Debian-Paket | `Sleepycat`, `BSD-3-Clause`, `MS-PL`, `GPL-2.0-or-later`, `Artistic-2.0`, `X11`, `MIT-old`, `TCL-like`, `BSD-3-clause-fjord`, `GPL-3.0-only`, `Zlib` | Debian QA Group |
| libdebconfclient0 | 0.280 | Debian-Paket | `BSD-2-Clause`, `GPL-2.0-or-later`, `GPL-2.0-only` | Debian Install System Team |
| libffi8 | 3.4.8-2 | Debian-Paket | `MIT`, `X11`, `GPL-2.0-or-later`, `GPL-3.0-or-later`, `MPL-1.1`, `LGPL-2.1-or-later`, `public-domain` | Debian GCC Maintainers |
| libgcc-s1 | 14.2.0-19 | Debian-Paket | – | Debian GCC Maintainers |
| libgdbm6t64 | 1.24-2 | Debian-Paket | `GPL-3.0-or-later`, `GPL-2.0-or-later`, `GFDL-1.3-no-invariants-or-later`, `GPL-3.0-only`, `GPL-2.0-only` | Nicolas Mora |
| libgmp10 | 2:6.3.0+dfsg-3 | Debian-Paket | `GPL-2.0-or-later`, `LGPL-3.0-or-later`, `GPL-3.0-or-later`, `GPL-3.0-or-later WITH Bison-exception`, `GPL-2.0-only`, `GPL-3.0-only`, `LGPL-3.0-only` | Debian Science Maintainers |
| libhogweed6t64 | 3.10.1-1 | Debian-Paket | `LGPL-3.0-or-later`, `GPL-2.0-or-later`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `MIT`, `GPL-3.0-only WITH autoconf-exception+`, `public-domain`, `GPL-2.0-only`, `GAP` | Magnus Holmgren |
| liblastlog2-2 | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| liblz4-1 | 1.10.0-4 | Debian-Paket | `GPL-2.0-or-later`, `BSD-2-Clause`, `GPL-2.0-only` | Nobuhiro Iwamatsu |
| liblzma5 | 5.8.1-1+deb13u1 | Debian-Paket | `0BSD`, `GPL-2.0-or-later`, `LGPL-2.1-or-later`, `FSFULLR`, `GPL-3.0-or-later WITH Autoconf-exception-macro`, `none`, `PD`, `permissive-nowarranty`, `FSFUL`, `noderivs`, `PD-debian`, `LGPL-2.1-only`, `GPL-2.0-only`, `GPL-3.0-only` | Sebastian Andrzej Siewior |
| libmd0 | 1.1.0-2+b1 | Debian-Paket | `BSD-3-Clause`, `BSD-3-clause-Aaron-D-Gifford`, `BSD-2-Clause`, `BSD-2-Clause-NetBSD`, `ISC`, `Beerware`, `public-domain-md4`, `public-domain-md5`, `public-domain-sha1` | Guillem Jover |
| libmount1 | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| libncursesw6 | 6.5+20250216-2 | Debian-Paket | – | Ncurses Maintainers |
| libnettle8t64 | 3.10.1-1 | Debian-Paket | `LGPL-3.0-or-later`, `GPL-2.0-or-later`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `MIT`, `GPL-3.0-only WITH autoconf-exception+`, `public-domain`, `GPL-2.0-only`, `GAP` | Magnus Holmgren |
| libpam-modules | 1.7.0-5 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-or-later`, `GPL-1.0-only`, `GPL-2.0-only`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `BSD-tcp-wrappers`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `public-domain`, `Beerware` | Sam Hartman |
| libpam-modules-bin | 1.7.0-5 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-or-later`, `GPL-1.0-only`, `GPL-2.0-only`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `BSD-tcp-wrappers`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `public-domain`, `Beerware` | Sam Hartman |
| libpam-runtime | 1.7.0-5 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-or-later`, `GPL-1.0-only`, `GPL-2.0-only`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `BSD-tcp-wrappers`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `public-domain`, `Beerware` | Sam Hartman |
| libpam0g | 1.7.0-5 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-or-later`, `GPL-1.0-only`, `GPL-2.0-only`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `BSD-tcp-wrappers`, `LGPL-2.0-or-later`, `LGPL-2.0-only`, `public-domain`, `Beerware` | Sam Hartman |
| libpcre2-8-0 | 10.46-1~deb13u3 | Debian-Paket | `BSD-3-clause-Cambridge WITH BINARY-LIBRARY-LIKE-PACKAGES-exception`, `BSD-3-Clause`, `X11`, `BSD-2-Clause`, `public-domain` | Matthew Vernon |
| libreadline8t64 | 8.2-6 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only`, `GPL-2.0-or-later`, `GPL-2.0-only`, `GFDL-1.3-no-invariants-or-later`, `GFDL-1.3-or-later`, `ISC-no-attribution` | Matthias Klose |
| libseccomp2 | 2.6.0-2 | Debian-Paket | `LGPL-2.1-only` | Kees Cook |
| libselinux1 | 3.8.1-1 | Debian-Paket | `public-domain`, `GPL-2.0-only` | Debian SELinux maintainers |
| libsemanage-common | 3.8.1-1 | Debian-Paket | `LGPL-2.1-or-later`, `LGPL-2.1-only`, `GPL-2.0-only` | Debian SELinux maintainers |
| libsemanage2 | 3.8.1-1 | Debian-Paket | `LGPL-2.1-or-later`, `LGPL-2.1-only`, `GPL-2.0-only` | Debian SELinux maintainers |
| libsepol2 | 3.8.1-1 | Debian-Paket | `LGPL-2.1-or-later`, `LGPL-2.1-only`, `Zlib`, `GPL-2.0-only`, `GPL-2.0-or-later` | Debian SELinux maintainers |
| libsmartcols1 | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| libsqlite3-0 | 3.46.1-7+deb13u2 | Debian-Paket | `public-domain`, `GPL-2.0-or-later`, `GPL-2.0-only` | Laszlo Boszormenyi (GCS) |
| libssl3t64 | 3.5.7-1~deb13u3 | Debian-Paket | `Apache-2.0`, `Artistic-2.0`, `GPL-1.0-or-later`, `GPL-1.0-only` | Debian OpenSSL Team |
| libstdc++6 | 14.2.0-19 | Debian-Paket | – | Debian GCC Maintainers |
| libsystemd0 | 257.13-1~deb13u1 | Debian-Paket | `LGPL-2.1-or-later`, `CC0-1.0`, `GPL-2.0-only WITH Linux-syscall-note-exception`, `MIT`, `public-domain`, `GPL-2.0-or-later`, `GPL-2.0-only`, `LGPL-2.1-only` | Debian systemd Maintainers |
| libtinfo6 | 6.5+20250216-2 | Debian-Paket | `MIT-X11`, `X11`, `BSD-3-Clause` | Ncurses Maintainers |
| libudev1 | 257.13-1~deb13u1 | Debian-Paket | `LGPL-2.1-or-later`, `CC0-1.0`, `GPL-2.0-only WITH Linux-syscall-note-exception`, `MIT`, `public-domain`, `GPL-2.0-or-later`, `GPL-2.0-only`, `LGPL-2.1-only` | Debian systemd Maintainers |
| libuuid1 | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| libxxhash0 | 0.8.3-2 | Debian-Paket | `BSD-2-Clause`, `GPL-2.0-or-later`, `GPL-2.0-only` | Josue Ortega |
| libzstd1 | 1.5.7+dfsg-1 | Debian-Paket | `BSD-3-Clause`, `GPL-2.0-only`, `Zlib`, `MIT` | RPM packaging team |
| login | 1:4.16.0-2+really2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| login.defs | 1:4.17.4-2 | Debian-Paket | `BSD-3-Clause`, `GPL-1.0-only`, `GPL-2.0-or-later`, `GPL-2.0-only` | Shadow package maintainers |
| mawk | 1.3.4.20250131-1 | Debian-Paket | `GPL-2.0-only`, `X11`, `CC-BY-3.0` | Boyuan Yang |
| mount | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| ncurses-base | 6.5+20250216-2 | Debian-Paket | `MIT-X11`, `X11`, `BSD-3-Clause` | Ncurses Maintainers |
| ncurses-bin | 6.5+20250216-2 | Debian-Paket | `MIT-X11`, `X11`, `BSD-3-Clause` | Ncurses Maintainers |
| netbase | 6.5 | Debian-Paket | `GPL-2.0-only` | Marco d'Itri |
| openssl | 3.5.7-1~deb13u3 | Debian-Paket | `Apache-2.0`, `Artistic-2.0`, `GPL-1.0-or-later`, `GPL-1.0-only` | Debian OpenSSL Team |
| openssl-provider-legacy | 3.5.7-1~deb13u3 | Debian-Paket | `Apache-2.0`, `Artistic-2.0`, `GPL-1.0-or-later`, `GPL-1.0-only` | Debian OpenSSL Team |
| passwd | 1:4.17.4-2 | Debian-Paket | `BSD-3-Clause`, `GPL-1.0-only`, `GPL-2.0-or-later`, `GPL-2.0-only` | Shadow package maintainers |
| perl-base | 5.40.1-6+deb13u1 | Debian-Paket | `GPL-1.0-or-later`, `Artistic-2.0`, `MIT`, `REGCOMP`, `GPL-2.0-only WITH bison-exception+`, `Unicode`, `BZIP`, `Zlib`, `GPL-2.0-or-later`, `FSFAP`, `BSD-3-Clause WITH weird-numbering`, `CC0-1.0`, `TEXT-TABS`, `BSD-4-clause-POWERDOG`, `BSD-3-clause-GENERIC`, `BSD-3-Clause`, `SDBM-PUBLIC-DOMAIN`, `DONT-CHANGE-THE-GPL`, `Artistic-dist`, `LGPL-2.1-only`, `GPL-1.0-only`, `GPL-2.0-only`, `Artistic-2` | Niko Tyni |
| readline-common | 8.2-6 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only`, `GPL-2.0-or-later`, `GPL-2.0-only`, `GFDL-1.3-no-invariants-or-later`, `GFDL-1.3-or-later`, `ISC-no-attribution` | Matthias Klose |
| sed | 4.9-2+deb13u1 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only`, `X11`, `GFDL-1.3-no-invariants-or-later`, `GFDL-1.3-only`, `ISC`, `BSD-4-Clause-UC`, `BSL-1`, `pcre` | Clint Adams |
| sqv | 1.3.0-3+b2 | Debian-Paket | `LGPL-2.0-or-later`, `LGPL-2.0-only` | Debian Rust Maintainers |
| sysvinit-utils | 3.14-4 | Debian-Paket | `GPL-2.0-or-later`, `LGPL-2.1-or-later`, `GPL-3.0-only`, `GPL-2.0-only`, `LGPL-2.1-only` | Debian sysvinit maintainers |
| tar | 1.35+dfsg-3.1 | Debian-Paket | `GPL-3.0-or-later`, `GPL-3.0-only`, `GPL-3.0-or-later WITH Bison-exception`, `LGPL-2.1-or-later`, `LGPL-2.1-only`, `LGPL-3.0-or-later`, `LGPL-3.0-only`, `GPL-2.0-or-later`, `GPL-2.0-only` | Janos Lenart |
| tzdata | 2026c-0+deb13u1 | Debian-Paket | `public-domain` | GNU Libc Maintainers |
| util-linux | 2.41.5-0+deb13u1 | Debian-Paket | `GPL-2.0-or-later`, `GPL-2.0-only`, `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `public-domain`, `BSD-4-Clause`, `MIT`, `ISC`, `BSD-3-Clause`, `BSLA`, `LGPL-2.0-or-later`, `BSD-2-Clause`, `LGPL-3.0-or-later`, `GPL-3.0-only`, `LGPL-2.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only` | Chris Hofstaedtler |
| zlib1g | 1:1.3.dfsg+really1.3.1-1+b1 | Debian-Paket | `Zlib` | Mark Brown |

### nginx — Reverse Proxy, liefert die Oberfläche aus

Basis `nginx:stable-alpine`, alpine 3.24.2. 71 × Alpine-Paket.

| Komponente | Version | Art | Lizenz | Herausgeber |
|---|---|---|---|---|
| alpine-baselayout | 3.7.2-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| alpine-baselayout-data | 3.7.2-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| alpine-keys | 2.6-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| alpine-release | 3.24.2-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| aom-libs | 3.14.1-r0 | Alpine-Paket | `BSD-2-Clause`, `custom` | Oleg Titov |
| apk-tools | 3.0.8-r0 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| brotli-libs | 1.2.0-r1 | Alpine-Paket | `MIT` | prspkt |
| busybox | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| busybox-binsh | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| c-ares | 1.34.8-r0 | Alpine-Paket | `MIT` | Carlo Landmeter |
| ca-certificates | 20260909-r0 | Alpine-Paket | `MPL-2.0`, `MIT` | Natanael Copa |
| ca-certificates-bundle | 20260909-r0 | Alpine-Paket | `MPL-2.0`, `MIT` | Natanael Copa |
| curl | 8.22.0-r0 | Alpine-Paket | `curl` | Achill Gilgenast |
| fontconfig | 2.17.1-r1 | Alpine-Paket | `MIT` | Natanael Copa |
| freetype | 2.14.3-r0 | Alpine-Paket | `FTL`, `GPL-2.0-or-later` | Achill Gilgenast |
| geoip | 1.6.12-r6 | Alpine-Paket | `LGPL-2.1-or-later` | Leonardo Arena |
| gettext-envsubst | 1.0-r0 | Alpine-Paket | `GPL-3.0-or-later`, `LGPL-2.1-or-later`, `MIT` | Carlo Landmeter |
| libapk | 3.0.8-r0 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| libavif | 1.4.1-r0 | Alpine-Paket | `BSD-2-Clause` | Bart Ribbers |
| libbsd | 0.12.2-r0 | Alpine-Paket | `BSD-3-Clause` | Natanael Copa |
| libbz2 | 1.0.8-r6 | Alpine-Paket | `bzip-2-1.0.6` | Natanael Copa |
| libcrypto3 | 3.5.8-r0 | Alpine-Paket | `Apache-2.0` | Natanael Copa |
| libcurl | 8.22.0-r0 | Alpine-Paket | `curl` | Achill Gilgenast |
| libdav1d | 1.5.3-r0 | Alpine-Paket | `BSD-2-Clause` | Bart Ribbers |
| libedit | 20260508.3.1-r1 | Alpine-Paket | `BSD-3-Clause` | Achill Gilgenast |
| libexpat | 2.8.4-r0 | Alpine-Paket | `MIT` | Carlo Landmeter |
| libgcc | 15.2.0-r5 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.1-or-later` | Ariadne Conill |
| libgd | 2.3.3-r10 | Alpine-Paket | `GD` | Carlo Landmeter |
| libice | 1.1.2-r0 | Alpine-Paket | `X-11` | Natanael Copa |
| libidn2 | 2.3.8-r0 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-3.0-or-later` | Natanael Copa |
| libintl | 1.0-r0 | Alpine-Paket | `LGPL-2.1-or-later` | Carlo Landmeter |
| libjpeg-turbo | 3.1.3-r0 | Alpine-Paket | `BSD-3-Clause`, `IJG`, `Zlib` | Natanael Copa |
| libmd | 1.2.0-r0 | Alpine-Paket | `BSD-3-Clause`, `BSD-2-Clause`, `ISC`, `Beerware`, `Public`, `Domain` | omni |
| libncursesw | 6.6_p20260516-r0 | Alpine-Paket | `X-11` | Milan P. Stanić |
| libpng | 1.6.58-r1 | Alpine-Paket | `Libpng` | Natanael Copa |
| libpsl | 0.21.5-r3 | Alpine-Paket | `MIT` | Natanael Copa |
| libsharpyuv | 1.6.0-r0 | Alpine-Paket | `BSD-3-Clause` | Natanael Copa |
| libsm | 1.2.6-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| libssl3 | 3.5.8-r0 | Alpine-Paket | `Apache-2.0` | Natanael Copa |
| libstdc++ | 15.2.0-r5 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.1-or-later` | Ariadne Conill |
| libunistring | 1.4.2-r0 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-3.0-or-later` | Natanael Copa |
| libuuid | 2.42.3-r1 | Alpine-Paket | `BSD-3-Clause` | Natanael Copa |
| libwebp | 1.6.0-r0 | Alpine-Paket | `BSD-3-Clause` | Natanael Copa |
| libx11 | 1.8.13-r0 | Alpine-Paket | `X-11` | Natanael Copa |
| libxau | 1.0.12-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| libxcb | 1.17.0-r2 | Alpine-Paket | `MIT` | Natanael Copa |
| libxdmcp | 1.1.5-r1 | Alpine-Paket | `MIT` | Natanael Copa |
| libxext | 1.3.7-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| libxml2 | 2.13.9-r2 | Alpine-Paket | `MIT` | Carlo Landmeter |
| libxpm | 3.5.19-r0 | Alpine-Paket | `X-11` | Natanael Copa |
| libxslt | 1.1.43-r3 | Alpine-Paket | `X-11` | Natanael Copa |
| libxt | 1.3.1-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| libyuv | 0.0.1928-r0 | Alpine-Paket | `BSD-3-Clause` | Andy Postnikov |
| musl | 1.2.6-r2 | Alpine-Paket | `MIT` | Natanael Copa |
| musl-utils | 1.2.6-r2 | Alpine-Paket | `MIT`, `BSD-2-Clause`, `GPL-2.0-or-later` | Natanael Copa |
| ncurses-terminfo-base | 6.6_p20260516-r0 | Alpine-Paket | `X-11` | Milan P. Stanić |
| nghttp2-libs | 1.69.0-r0 | Alpine-Paket | `MIT` | Francesco Colista |
| nginx | 1.30.5-r1 | Alpine-Paket | `BSD-2-Clause` | NGINX Packaging |
| nginx-module-acme | 1.30.5.0.4.1-r1 | Alpine-Paket | `Apache-2.0` | NGINX Packaging |
| nginx-module-geoip | 1.30.5-r1 | Alpine-Paket | `BSD-2-Clause` | NGINX Packaging |
| nginx-module-image-filter | 1.30.5-r1 | Alpine-Paket | `BSD-2-Clause` | NGINX Packaging |
| nginx-module-njs | 1.30.5.1.0.1-r1 | Alpine-Paket | `BSD-2-Clause` | NGINX Packaging |
| nginx-module-xslt | 1.30.5-r1 | Alpine-Paket | `BSD-2-Clause` | NGINX Packaging |
| pcre2 | 10.48-r0 | Alpine-Paket | `BSD-3-Clause` | Jakub Jirutka |
| scanelf | 1.3.9-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| ssl_client | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| tiff | 4.7.1-r0 | Alpine-Paket | `libtiff` | Michael Mason |
| tzdata | 2026d-r0 | Alpine-Paket | `Public-Domain` | Natanael Copa |
| xz-libs | 5.8.4-r0 | Alpine-Paket | `GPL-2.0-or-later`, `0BSD`, `Public-Domain`, `LGPL-2.1-or-later` | Natanael Copa |
| zlib | 1.3.2-r0 | Alpine-Paket | `Zlib` | Natanael Copa |
| zstd-libs | 1.5.7-r2 | Alpine-Paket | `BSD-3-Clause`, `GPL-2.0-or-later` | Natanael Copa |

### postgres — Datenbank

Basis `postgres:18-alpine`, alpine 3.24.2. 53 × Alpine-Paket, 4 × Go-Modul.

| Komponente | Version | Art | Lizenz | Herausgeber |
|---|---|---|---|---|
| .postgresql-rundeps | 20260917.212948 | Alpine-Paket | – | – |
| alpine-baselayout | 3.7.2-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| alpine-baselayout-data | 3.7.2-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| alpine-keys | 2.6-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| alpine-release | 3.24.2-r0 | Alpine-Paket | `MIT` | Natanael Copa |
| apk-tools | 3.0.8-r0 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| bash | 5.3.9-r1 | Alpine-Paket | `GPL-3.0-or-later` | Natanael Copa |
| brotli-libs | 1.2.0-r1 | Alpine-Paket | `MIT` | prspkt |
| busybox | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| busybox-binsh | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| c-ares | 1.34.8-r0 | Alpine-Paket | `MIT` | Carlo Landmeter |
| ca-certificates-bundle | 20260909-r0 | Alpine-Paket | `MPL-2.0`, `MIT` | Natanael Copa |
| gdbm | 1.26-r0 | Alpine-Paket | `GPL-3.0-or-later` | Natanael Copa |
| icu-data-full | 78.1-r0 | Alpine-Paket | `ICU` | Natanael Copa |
| icu-libs | 78.1-r0 | Alpine-Paket | `ICU` | Natanael Copa |
| keyutils-libs | 1.6.3-r4 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.0-or-later` | Natanael Copa |
| krb5-conf | 1.0-r2 | Alpine-Paket | `MIT` | Natanael Copa |
| krb5-libs | 1.22.2-r1 | Alpine-Paket | `MIT` | Natanael Copa |
| libapk | 3.0.8-r0 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| libcom_err | 1.47.4-r0 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.0-or-later`, `BSD-3-Clause`, `MIT` | Natanael Copa |
| libcrypto3 | 3.5.8-r0 | Alpine-Paket | `Apache-2.0` | Natanael Copa |
| libcurl | 8.22.0-r0 | Alpine-Paket | `curl` | Achill Gilgenast |
| libedit | 20260508.3.1-r1 | Alpine-Paket | `BSD-3-Clause` | Achill Gilgenast |
| libffi | 3.5.2-r1 | Alpine-Paket | `MIT` | Natanael Copa |
| libgcc | 15.2.0-r5 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.1-or-later` | Ariadne Conill |
| libidn2 | 2.3.8-r0 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-3.0-or-later` | Natanael Copa |
| libldap | 2.6.14-r0 | Alpine-Paket | `OLDAP-2.8` | Natanael Copa |
| libncursesw | 6.6_p20260516-r0 | Alpine-Paket | `X-11` | Milan P. Stanić |
| libpsl | 0.21.5-r3 | Alpine-Paket | `MIT` | Natanael Copa |
| libsasl | 2.1.28-r9 | Alpine-Paket | `BSD-3-Clause-Attribution`, `BSD-4-Clause` | Natanael Copa |
| libssl3 | 3.5.8-r0 | Alpine-Paket | `Apache-2.0` | Natanael Copa |
| libstdc++ | 15.2.0-r5 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-2.1-or-later` | Ariadne Conill |
| libunistring | 1.4.2-r0 | Alpine-Paket | `GPL-2.0-or-later`, `LGPL-3.0-or-later` | Natanael Copa |
| liburing | 2.14-r0 | Alpine-Paket | `LGPL-2.1-or-later`, `MIT` | Milan P. Stanić |
| libuuid | 2.42.3-r1 | Alpine-Paket | `BSD-3-Clause` | Natanael Copa |
| libverto | 0.3.2-r2 | Alpine-Paket | `MIT` | Francesco Colista |
| libxml2 | 2.13.9-r2 | Alpine-Paket | `MIT` | Carlo Landmeter |
| libxslt | 1.1.43-r3 | Alpine-Paket | `X-11` | Natanael Copa |
| llvm21-libs | 21.1.8-r1 | Alpine-Paket | `Apache-2.0` | Achill Gilgenast |
| lz4-libs | 1.10.0-r1 | Alpine-Paket | `BSD-2-Clause`, `GPL-2.0-or-later` | Stuart Cardall |
| musl | 1.2.6-r2 | Alpine-Paket | `MIT` | Natanael Copa |
| musl-utils | 1.2.6-r2 | Alpine-Paket | `MIT`, `BSD-2-Clause`, `GPL-2.0-or-later` | Natanael Copa |
| ncurses-terminfo-base | 6.6_p20260516-r0 | Alpine-Paket | `X-11` | Milan P. Stanić |
| nghttp2-libs | 1.69.0-r0 | Alpine-Paket | `MIT` | Francesco Colista |
| nss_wrapper | 1.1.12-r1 | Alpine-Paket | `BSD-3-Clause` | Wolfgang Walther |
| readline | 8.3.3-r1 | Alpine-Paket | `GPL-3.0-or-later` | qaqland |
| scanelf | 1.3.9-r1 | Alpine-Paket | `GPL-2.0-only` | Natanael Copa |
| ssl_client | 1.37.0-r31 | Alpine-Paket | `GPL-2.0-only` | Sören Tempel |
| tzdata | 2026d-r0 | Alpine-Paket | `Public-Domain` | Natanael Copa |
| xz-libs | 5.8.4-r0 | Alpine-Paket | `GPL-2.0-or-later`, `0BSD`, `Public-Domain`, `LGPL-2.1-or-later` | Natanael Copa |
| zlib | 1.3.2-r0 | Alpine-Paket | `Zlib` | Natanael Copa |
| zstd | 1.5.7-r2 | Alpine-Paket | `BSD-3-Clause`, `GPL-2.0-or-later` | Natanael Copa |
| zstd-libs | 1.5.7-r2 | Alpine-Paket | `BSD-3-Clause`, `GPL-2.0-or-later` | Natanael Copa |
| github.com/moby/sys/user | v0.1.0 | Go-Modul | – | – |
| github.com/tianon/gosu | v1.19.0 | Go-Modul | – | – |
| golang.org/x/sys | v0.1.0 | Go-Modul | – | – |
| stdlib | v1.24.6 | Go-Modul | – | – |

### keycloak — Anmeldung in DEV und im Pilot (in PROD: der IdP des Konzerns)

Basis `quay.io/keycloak/keycloak:26.8.0`, redhat 9.8. 44 × RPM-Paket, 491 × Java-Bibliothek.

| Komponente | Version | Art | Lizenz | Herausgeber |
|---|---|---|---|---|
| alternatives | 1.24-2.el9 | RPM-Paket | `GPL-2.0-only` | Red Hat, Inc. |
| basesystem | 11-13.el9 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| bash | 5.1.8-9.el9 | RPM-Paket | `GPL-3.0-or-later` | Red Hat, Inc. |
| ca-certificates | 2025.2.80_v9.0.305-91.el9 | RPM-Paket | `MIT AND GPL-2.0-or-later` | Red Hat, Inc. |
| coreutils-single | 8.32-41.el9_8.1 | RPM-Paket | `GPL-3.0-or-later` | Red Hat, Inc. |
| crypto-policies | 20260224-1.gitea0f072.el9_8 | RPM-Paket | `LGPL-2.1-or-later` | Red Hat, Inc. |
| crypto-policies-scripts | 20260224-1.gitea0f072.el9_8 | RPM-Paket | `LGPL-2.1-or-later` | Red Hat, Inc. |
| filesystem | 3.16-5.el9 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| findutils | 1:4.8.0-7.el9 | RPM-Paket | `GPL-3.0-or-later` | Red Hat, Inc. |
| glibc | 2.34-283.el9_8 | RPM-Paket | `LGPL-2.1-or-later AND SunPro AND LGPL-2.1-or-later WITH GCC-exception-2.0 AND BSD-3-Clause AND GPL-2.0-or-later AND LGPL-2.1-or-later WITH GNU-compiler-exception AND GPL-2.0-only AND ISC AND LicenseRef-Fedora-Public-Domain AND HPND AND CMU-Mach AND LGPL-2.0-or-later AND Unicode-3.0 AND GFDL-1.1-or-later AND GPL-1.0-or-later AND FSFUL AND MIT AND Inner-Net-2.0 AND X11 AND GPL-2.0-or-later WITH GCC-exception-2.0 AND GFDL-1.3-only AND GFDL-1.1-only AND GPL-3.0-or-later AND GPL-3.0-or-later WITH Autoconf-exception-generic-3.0 AND GPL-3.0-or-later WITH Texinfo-exception` | Red Hat, Inc. |
| glibc-common | 2.34-283.el9_8 | RPM-Paket | `LGPL-2.1-or-later AND SunPro AND LGPL-2.1-or-later WITH GCC-exception-2.0 AND BSD-3-Clause AND GPL-2.0-or-later AND LGPL-2.1-or-later WITH GNU-compiler-exception AND GPL-2.0-only AND ISC AND LicenseRef-Fedora-Public-Domain AND HPND AND CMU-Mach AND LGPL-2.0-or-later AND Unicode-3.0 AND GFDL-1.1-or-later AND GPL-1.0-or-later AND FSFUL AND MIT AND Inner-Net-2.0 AND X11 AND GPL-2.0-or-later WITH GCC-exception-2.0 AND GFDL-1.3-only AND GFDL-1.1-only AND GPL-3.0-or-later AND GPL-3.0-or-later WITH Autoconf-exception-generic-3.0 AND GPL-3.0-or-later WITH Texinfo-exception` | Red Hat, Inc. |
| glibc-langpack-en | 2.34-283.el9_8 | RPM-Paket | `LGPL-2.1-or-later AND SunPro AND LGPL-2.1-or-later WITH GCC-exception-2.0 AND BSD-3-Clause AND GPL-2.0-or-later AND LGPL-2.1-or-later WITH GNU-compiler-exception AND GPL-2.0-only AND ISC AND LicenseRef-Fedora-Public-Domain AND HPND AND CMU-Mach AND LGPL-2.0-or-later AND Unicode-3.0 AND GFDL-1.1-or-later AND GPL-1.0-or-later AND FSFUL AND MIT AND Inner-Net-2.0 AND X11 AND GPL-2.0-or-later WITH GCC-exception-2.0 AND GFDL-1.3-only AND GFDL-1.1-only AND GPL-3.0-or-later AND GPL-3.0-or-later WITH Autoconf-exception-generic-3.0 AND GPL-3.0-or-later WITH Texinfo-exception` | Red Hat, Inc. |
| grep | 3.6-5.el9 | RPM-Paket | `GPL-3.0-or-later` | Red Hat, Inc. |
| java-21-openjdk-headless | 1:21.0.12.1.1-1.2.el9 | RPM-Paket | `Apache-1.1 AND Apache-2.0 AND BSD-3-Clause AND BSD-3-Clause WITH advertising AND GPL-2.0-or-later AND GPL-2.0-only AND GPL-2.0-only WITH exceptions AND IJG AND LGPL-2.0-or-later AND MIT AND MPL-2.0 AND Public-Domain AND W3C AND Zlib AND ISC AND FTL AND RSA` | Red Hat, Inc. |
| javapackages-filesystem | 6.4.0-1.el9 | RPM-Paket | `BSD-3-Clause` | Red Hat, Inc. |
| libacl | 2.4.0-1.el9_8 | RPM-Paket | `LGPL-2.0-or-later` | Red Hat, Inc. |
| libattr | 2.6.0-1.el9_8 | RPM-Paket | `LGPL-2.0-or-later` | Red Hat, Inc. |
| libcap | 2.48-10.el9_8.1 | RPM-Paket | `BSD-3-Clause OR GPL-2.0-only` | Red Hat, Inc. |
| libffi | 3.4.2-8.el9 | RPM-Paket | `MIT` | Red Hat, Inc. |
| libgcc | 11.5.0-14.el9 | RPM-Paket | `GPL-3.0-or-later AND GPL-3.0-or-later WITH exceptions AND GPL-2.0-or-later WITH exceptions AND LGPL-2.0-or-later AND BSD-3-Clause` | Red Hat, Inc. |
| libselinux | 3.6-3.el9 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| libsepol | 3.6-3.el9 | RPM-Paket | `LGPL-2.0-or-later` | Red Hat, Inc. |
| libsigsegv | 2.13-4.el9 | RPM-Paket | `GPL-2.0-or-later` | Red Hat, Inc. |
| libtasn1 | 4.16.0-10.el9_8 | RPM-Paket | `GPL-3.0-or-later AND LGPL-2.0-or-later` | Red Hat, Inc. |
| lksctp-tools | 1.0.19-3.el9_4 | RPM-Paket | `GPL-2.0-only AND GPL-2.0-or-later AND LGPL-2.0-only AND MIT` | Red Hat, Inc. |
| ncurses-base | 6.2-12.20210508.el9 | RPM-Paket | `MIT` | Red Hat, Inc. |
| ncurses-libs | 6.2-12.20210508.el9 | RPM-Paket | `MIT` | Red Hat, Inc. |
| nspr | 4.39.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| nss | 3.124.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| nss-softokn | 3.124.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| nss-softokn-freebl | 3.124.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| nss-sysinit | 3.124.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| nss-util | 3.124.0-5.el9_6 | RPM-Paket | `MPL-2.0` | Red Hat, Inc. |
| p11-kit-trust | 0.26.4-1.el9_8 | RPM-Paket | `BSD-3-Clause` | Red Hat, Inc. |
| pcre | 8.44-4.el9 | RPM-Paket | `BSD-3-Clause` | Red Hat, Inc. |
| pcre2 | 10.40-6.el9 | RPM-Paket | `BSD-3-Clause` | Red Hat, Inc. |
| pcre2-syntax | 10.40-6.el9 | RPM-Paket | `BSD-3-Clause` | Red Hat, Inc. |
| redhat-release | 9.8-1.0.el9 | RPM-Paket | `GPL-2.0-only` | Red Hat, Inc. |
| sed | 4.8-10.el9 | RPM-Paket | `GPL-3.0-or-later` | Red Hat, Inc. |
| setup | 2.13.7-10.el9 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| sqlite-libs | 3.34.1-11.el9_8 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| tzdata | 2026e-1.el9_8 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| tzdata-java | 2026e-1.el9_8 | RPM-Paket | `Public-Domain` | Red Hat, Inc. |
| zlib | 1.2.11-40.el9 | RPM-Paket | `Zlib AND BSL-1.0` | Red Hat, Inc. |
| org.aesh:aesh | 3.18.2 | Java-Bibliothek | `Apache-2.0` | – |
| io.agroal:agroal-api | 3.2.1 | Java-Bibliothek | – | – |
| io.agroal:agroal-narayana | 3.2.1 | Java-Bibliothek | – | – |
| io.agroal:agroal-pool | 3.2.1 | Java-Bibliothek | – | – |
| org.eclipse.angus:angus-activation | 2.0.3 | Java-Bibliothek | – | – |
| org.eclipse.angus:angus-core | 2.0.5 | Java-Bibliothek | – | – |
| org.eclipse.angus:angus-mail | 2.0.5 | Java-Bibliothek | – | – |
| org.antlr:antlr4-runtime | 4.13.2 | Java-Bibliothek | – | – |
| io.quarkus.arc:arc | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.arc:arc-processor | 3.40.1 | Java-Bibliothek | – | – |
| org.jboss.narayana.arjunacore:arjuna | 7.3.4.Final | Java-Bibliothek | – | – |
| org.ow2.asm:asm | 9.10.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.ow2.asm:asm-analysis | 9.10.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.ow2.asm:asm-commons | 9.10.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.ow2.asm:asm-tree | 9.10.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.ow2.asm:asm-util | 9.10.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.bouncycastle:bcpkix-jdk18on | 1.86 | Java-Bibliothek | `MIT` | – |
| org.bouncycastle:bcprov-jdk18on | 1.86 | Java-Bibliothek | `MIT` | – |
| org.bouncycastle:bcutil-jdk18on | 1.86 | Java-Bibliothek | `MIT` | – |
| com.aayushatharva.brotli4j:brotli4j | 1.23.0 | Java-Bibliothek | – | – |
| net.bytebuddy:byte-buddy | 1.18.8 | Java-Bibliothek | – | – |
| net.bytebuddy:byte-buddy-agent | 1.18.8 | Java-Bibliothek | – | – |
| javax.cache:cache-api | 1.1.1 | Java-Bibliothek | `Apache-2.0` | – |
| com.github.ben-manes.caffeine:caffeine | 3.2.4 | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.narayana.jta:cdi | 7.3.4.Final | Java-Bibliothek | – | – |
| com.fasterxml:classmate | 1.7.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.narayana:common | 7.3.4.Final | Java-Bibliothek | – | – |
| commons-codec:commons-codec | 1.22.1 | Java-Bibliothek | – | – |
| org.apache.commons:commons-collections4 | 4.5.0 | Java-Bibliothek | – | – |
| org.apache.commons:commons-compress | 1.28.0 | Java-Bibliothek | – | – |
| commons-io:commons-io | 2.22.0 | Java-Bibliothek | – | – |
| org.apache.commons:commons-lang3 | 3.20.0 | Java-Bibliothek | – | – |
| org.jboss.logging:commons-logging-jboss-logging | 2.0.0.Final | Java-Bibliothek | `Apache-2.0` | – |
| com.typesafe:config | 1.4.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.google.zxing:core | 3.4.0 | Java-Bibliothek | – | – |
| org.crac:crac | 1.5.0 | Java-Bibliothek | `BSD-2-Clause` | – |
| com.github.hypfvieh:dbus-java-core | 5.2.0 | Java-Bibliothek | – | – |
| com.github.hypfvieh:dbus-java-transport-native-unixsocket | 5.2.0 | Java-Bibliothek | – | – |
| com.google.errorprone:error_prone_annotations | 2.49.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.glassfish.expressly:expressly | 6.0.0 | Java-Bibliothek | – | – |
| org.freemarker:freemarker | 2.3.35 | Java-Bibliothek | `Apache-2.0` | – |
| io.quarkus.gizmo:gizmo | 1.10.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.quarkus.gizmo:gizmo2 | 2.1.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.grpc:grpc-api | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-context | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-core | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-netty | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-protobuf | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-protobuf-lite | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-stub | 1.81.0 | Java-Bibliothek | – | – |
| io.grpc:grpc-util | 1.81.0 | Java-Bibliothek | – | – |
| com.google.code.gson:gson | 2.14.0 | Java-Bibliothek | `Apache-2.0` | – |
| com.google.guava:guava | 33.6.0-jre | Java-Bibliothek | – | – |
| org.hdrhistogram:HdrHistogram | 2.2.2 | Java-Bibliothek | `CC0-1.0`, `BSD-2-Clause` | – |
| org.hibernate.orm:hibernate-community-dialects | 7.4.9.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.hibernate:hibernate-core | 7.4.9.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.hibernate:hibernate-graalvm | 7.4.9.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.hibernate:hibernate-jcache | 7.4.9.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.hibernate.models:hibernate-models | 1.1.2 | Java-Bibliothek | `Apache-2.0` | – |
| org.hibernate.validator:hibernate-validator | 9.1.3.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.apache.httpcomponents:httpclient | 4.5.14 | Java-Bibliothek | – | – |
| org.apache.httpcomponents:httpcore | 4.4.16 | Java-Bibliothek | – | – |
| org.eclipse.angus:imap | 2.0.5 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-api | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-cachestore-remote | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-client-hotrod | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-commons | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-core | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-counter-api | 16.0.15 | Java-Bibliothek | – | – |
| org.infinispan:infinispan-multimap | 16.0.15 | Java-Bibliothek | – | – |
| com.sun.istack:istack-commons-runtime | 3.0.10 | Java-Bibliothek | – | – |
| com.fasterxml.jackson.core:jackson-annotations | 2.21 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.core:jackson-core | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.core:jackson-databind | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.dataformat:jackson-dataformat-cbor | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.dataformat:jackson-dataformat-yaml | 2.21.7 | Java-Bibliothek | – | – |
| com.fasterxml.jackson.datatype:jackson-datatype-jdk8 | 2.21.7 | Java-Bibliothek | – | – |
| com.fasterxml.jackson.datatype:jackson-datatype-jsr310 | 2.21.7 | Java-Bibliothek | – | – |
| com.fasterxml.jackson.jakarta.rs:jackson-jakarta-rs-base | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.jakarta.rs:jackson-jakarta-rs-yaml-provider | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.module:jackson-module-jakarta-xmlbind-annotations | 2.21.7 | Java-Bibliothek | `Apache-2.0` | – |
| com.fasterxml.jackson.module:jackson-module-parameter-names | 2.21.7 | Java-Bibliothek | – | – |
| jakarta.activation:jakarta.activation-api | 2.1.4 | Java-Bibliothek | `BSD-3-Clause` | – |
| jakarta.annotation:jakarta.annotation-api | 3.0.0 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.el:jakarta.el-api | 6.0.1 | Java-Bibliothek | – | – |
| jakarta.enterprise:jakarta.enterprise.cdi-api | 4.1.0 | Java-Bibliothek | `Apache-2.0` | – |
| jakarta.enterprise:jakarta.enterprise.lang-model | 4.1.0 | Java-Bibliothek | `Apache-2.0` | – |
| jakarta.inject:jakarta.inject-api | 2.0.1 | Java-Bibliothek | `Apache-2.0` | – |
| jakarta.interceptor:jakarta.interceptor-api | 2.2.0 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.json:jakarta.json-api | 2.1.3 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.mail:jakarta.mail-api | 2.1.1 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception`, `BSD-3-Clause` | – |
| jakarta.persistence:jakarta.persistence-api | 3.2.0 | Java-Bibliothek | `EPL-2.0`, `BSD-3-Clause` | – |
| jakarta.resource:jakarta.resource-api | 2.1.0 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.servlet:jakarta.servlet-api | 6.0.0 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.transaction:jakarta.transaction-api | 2.0.1 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.validation:jakarta.validation-api | 3.1.1 | Java-Bibliothek | `Apache-2.0` | – |
| jakarta.ws.rs:jakarta.ws.rs-api | 3.1.0 | Java-Bibliothek | `EPL-2.0`, `GPL-2.0-only WITH classpath-exception` | – |
| jakarta.xml.bind:jakarta.xml.bind-api | 4.0.5 | Java-Bibliothek | – | – |
| jakarta.xml.soap:jakarta.xml.soap-api | 3.0.0 | Java-Bibliothek | `BSD-3-Clause` | – |
| io.smallrye:jandex | 3.6.0 | Java-Bibliothek | – | – |
| io.smallrye:jandex-gizmo2 | 3.6.0 | Java-Bibliothek | – | – |
| com.googlecode.owasp-java-html-sanitizer:java10-shim | 20260101.1 | Java-Bibliothek | – | – |
| com.googlecode.owasp-java-html-sanitizer:java8-shim | 20260101.1 | Java-Bibliothek | – | – |
| com.google.zxing:javase | 3.4.0 | Java-Bibliothek | – | – |
| org.glassfish.jaxb:jaxb-core | 4.0.9 | Java-Bibliothek | – | – |
| org.glassfish.jaxb:jaxb-runtime | 4.0.9 | Java-Bibliothek | – | – |
| org.jboss.logging:jboss-logging | 3.6.3.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.logmanager:jboss-logmanager | 3.2.2.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.threads:jboss-threads | 3.9.2 | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss:jboss-transaction-spi | 8.0.0.Final | Java-Bibliothek | – | – |
| com.github.ben-manes.caffeine:jcache | 3.2.4 | Java-Bibliothek | `Apache-2.0` | – |
| org.jctools:jctools-core | 4.0.5 | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.narayana.jta:jdbc | 7.3.4.Final | Java-Bibliothek | – | – |
| io.smallrye.classfile:jdk-classfile-backport | 26 | Java-Bibliothek | `GPL-2.0-only WITH classpath-exception` | – |
| org.jgroups:jgroups | 5.5.5.Final | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.narayana.jta:jms | 7.3.4.Final | Java-Bibliothek | – | – |
| net.java.dev.jna:jna | 5.8.0 | Java-Bibliothek | – | – |
| org.jspecify:jspecify | 1.0.0 | Java-Bibliothek | – | – |
| org.jboss.narayana.jta:jta | 7.3.4.Final | Java-Bibliothek | – | – |
| org.locationtech.jts:jts-core | 1.19.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-account-ui | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-admin-cli | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-admin-ui | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-admin-v2-api | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-admin-v2-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-authz-policy-common | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-authzen-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-common | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-config-api | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-core | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-crypto-default | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-crypto-fips1402 | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-ipatuura-federation | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-kerberos-federation | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-ldap-federation | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-model-infinispan | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-model-jpa | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-model-storage | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-model-storage-private | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-model-storage-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-quarkus-server | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-quarkus-server-app | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-quarkus-server-deployment | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-rest-admin-ui-ext | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-saml-core | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-saml-core-public | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-scim-core | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-scim-model | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-scim-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-server-spi | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-server-spi-private | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-ssf-core | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-ssf-services | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-ssf-transmitter | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-sssd-federation | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-themes | 26.8.0 | Java-Bibliothek | – | – |
| org.keycloak:keycloak-themes-vendor | 26.8.0 | Java-Bibliothek | – | – |
| org.latencyutils:LatencyUtils | 2.0.3 | Java-Bibliothek | `CC0-1.0` | – |
| org.liquibase:liquibase-core | 4.33.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.eclipse.angus:logging-mailhandler | 2.0.5 | Java-Bibliothek | – | – |
| org.mariadb.jdbc:mariadb-java-client | 3.5.10 | Java-Bibliothek | `LGPL-2.1-or-later` | – |
| io.micrometer:micrometer-commons | 1.17.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.micrometer:micrometer-core | 1.17.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.micrometer:micrometer-observation | 1.17.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.micrometer:micrometer-registry-prometheus-simpleclient | 1.17.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.eclipse.microprofile.config:microprofile-config-api | 3.1.1 | Java-Bibliothek | – | – |
| org.eclipse.microprofile.context-propagation:microprofile-context-propagation-api | 1.3 | Java-Bibliothek | – | – |
| org.eclipse.microprofile.health:microprofile-health-api | 4.0.1 | Java-Bibliothek | – | – |
| org.eclipse.microprofile.openapi:microprofile-openapi-api | 4.1.1 | Java-Bibliothek | – | – |
| com.microsoft.sqlserver:mssql-jdbc | 13.4.0 | Java-Bibliothek | `MIT` | – |
| com.microsoft.sqlserver:mssql-jdbc | 13.4.0.jre11 | Java-Bibliothek | – | – |
| io.smallrye.reactive:mutiny | 3.3.0 | Java-Bibliothek | – | – |
| io.smallrye.reactive:mutiny-smallrye-context-propagation | 3.3.0 | Java-Bibliothek | – | – |
| io.smallrye.reactive:mutiny-zero-flow-adapters | 1.2.1 | Java-Bibliothek | – | – |
| com.mysql:mysql-connector-j | 9.7.0 | Java-Bibliothek | `Apache-2.0`, `BSD-3-Clause`, `EPL-1.0`, `GPL-2.0-only`, `LGPL-2.1-only`, `Unicode-DFS-2015` | – |
| org.jboss.narayana.jta:narayana-jta | 7.3.4.Final | Java-Bibliothek | – | – |
| org.jboss.narayana.jts:narayana-jts-integration | 7.3.4.Final | Java-Bibliothek | – | – |
| org.openjdk.nashorn:nashorn-core | 15.4 | Java-Bibliothek | – | – |
| com.aayushatharva.brotli4j:native-linux-x86_64 | 1.23.0 | Java-Bibliothek | – | – |
| org.graalvm.sdk:nativeimage | 25.0.4.1 | Java-Bibliothek | – | – |
| io.netty:netty-buffer | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec-dns | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec-haproxy | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec-http | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec-http2 | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-codec-socks | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-common | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-handler | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-handler-proxy | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-resolver | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-resolver-dns | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-tcnative-classes | 2.0.84.Final | Java-Bibliothek | – | – |
| io.netty:netty-transport | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-transport-classes-epoll | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-transport-native-epoll | 4.1.138.Final | Java-Bibliothek | – | – |
| io.netty:netty-transport-native-unix-common | 4.1.138.Final | Java-Bibliothek | – | – |
| com.opencsv:opencsv | 5.11.2 | Java-Bibliothek | `Apache-2.0` | – |
| io.opentelemetry.instrumentation:opentelemetry-apache-httpclient-4.3 | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-api | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-api-incubator | 1.62.0-alpha | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-common | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-context | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-exporter-common | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-exporter-otlp | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-exporter-otlp-common | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations | 2.28.1 | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations-support | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-instrumentation-api | 2.28.1 | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-instrumentation-api-incubator | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-jdbc | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-micrometer-1.5 | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry.instrumentation:opentelemetry-runtime-telemetry | 2.28.1-alpha | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-common | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-extension-autoconfigure | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-extension-autoconfigure-spi | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-logs | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-metrics | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry:opentelemetry-sdk-trace | 1.62.0 | Java-Bibliothek | – | – |
| io.opentelemetry.semconv:opentelemetry-semconv | 1.41.1 | Java-Bibliothek | – | – |
| io.opentelemetry.semconv:opentelemetry-semconv-incubating | 1.40.0-alpha | Java-Bibliothek | – | – |
| org.osgi:org.osgi.namespace.extender | 1.0.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.osgi:org.osgi.service.component.annotations | 1.5.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.osgi:org.osgi.util.function | 1.0.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.osgi:org.osgi.util.promise | 1.0.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.osgi:osgi.annotation | 8.1.0 | Java-Bibliothek | `Apache-2.0` | – |
| com.googlecode.owasp-java-html-sanitizer:owasp-java-html-sanitizer | 20260101.1 | Java-Bibliothek | – | – |
| org.eclipse.parsson:parsson | 1.1.9 | Java-Bibliothek | – | – |
| io.perfmark:perfmark-api | 0.27.0 | Java-Bibliothek | – | – |
| info.picocli:picocli | 4.7.7 | Java-Bibliothek | – | – |
| org.eclipse.angus:pop3 | 2.0.5 | Java-Bibliothek | – | – |
| org.postgresql:postgresql | 42.7.13 | Java-Bibliothek | `BSD-2-Clause` | – |
| com.google.api.grpc:proto-google-common-protos | 2.71.0 | Java-Bibliothek | `Apache-2.0` | – |
| com.google.protobuf:protobuf-java | 4.35.0 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.infinispan.protostream:protostream | 6.0.7 | Java-Bibliothek | – | – |
| org.infinispan.protostream:protostream-types | 6.0.7 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-agroal | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-agroal-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-agroal-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-arc | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-arc-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-arc-test-supplement | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-arc-test-supplement-decorator | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-assistant-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-assistant-dev | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-avro-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-bootstrap-app-model | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-bootstrap-core | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-bootstrap-json | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-bootstrap-runner | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-builder | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-caffeine | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-caffeine-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-class-change-agent | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-classloader-commons | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-core | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-core-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-credentials | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-credentials-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-datasource | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-datasource-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-datasource-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-datasource-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-development-mode-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-devservices | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-devui-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-fs-util | 1.4.2 | Java-Bibliothek | `Apache-2.0` | – |
| io.quarkus:quarkus-grpc-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-grpc-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-orm | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-orm-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-orm-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-validator | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-validator-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-hibernate-validator-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.http:quarkus-http-core | 5.5.0 | Java-Bibliothek | – | – |
| io.quarkus.http:quarkus-http-http-core | 5.5.0 | Java-Bibliothek | – | – |
| io.quarkus.http:quarkus-http-servlet | 5.5.0 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jackson | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jackson-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jackson-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jaxrs-spi-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-h2 | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-h2-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mariadb | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mariadb-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mssql | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mssql-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mysql | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-mysql-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-oracle | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-oracle-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-postgresql | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jdbc-postgresql-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jsonp | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-jsonp-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-kubernetes-service-binding-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-kubernetes-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-logging-json | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-logging-json-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer-opentelemetry | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer-opentelemetry-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer-registry-prometheus | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-micrometer-registry-prometheus-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-mutiny | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-mutiny-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-narayana-jta | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-narayana-jta-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-netty | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-netty-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-opentelemetry | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-opentelemetry-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-panache-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-panache-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-panache-hibernate-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-panache-hibernate-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-reactive-datasource-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-jackson | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-jackson-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-jackson-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-jackson-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-server-spi-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-rest-spi-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-resteasy-common-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-resteasy-server-common-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.security:quarkus-security | 2.3.2 | Java-Bibliothek | `Apache-2.0` | – |
| io.quarkus:quarkus-security-runtime-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-security-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-context-propagation | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-context-propagation-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-context-propagation-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-health | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-health-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-health-dev | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-health-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-openapi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-openapi-common-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-openapi-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-openapi-dev | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-smallrye-openapi-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-swagger-ui | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-swagger-ui-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-tls-registry | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-tls-registry-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-tls-registry-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-tls-registry-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-transaction-annotations | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-undertow-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-value-registry | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-http | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-http-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-http-deployment-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-vertx-latebound-mdc-provider | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.vertx.utils:quarkus-vertx-utils | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-virtual-threads | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-virtual-threads-deployment | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus:quarkus-websockets-next-spi | 3.40.1 | Java-Bibliothek | – | – |
| io.setl:rdf-urdna | 1.1 | Java-Bibliothek | – | – |
| org.reactivestreams:reactive-streams | 1.0.4 | Java-Bibliothek | – | – |
| org.aesh:readline | 3.18.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.aesh:readline-api | 3.18.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-common | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-common-processor | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-common-types | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-jackson | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-processor | 3.40.1 | Java-Bibliothek | – | – |
| io.quarkus.resteasy.reactive:resteasy-reactive-vertx | 3.40.1 | Java-Bibliothek | – | – |
| io.reactivex.rxjava3:rxjava | 3.1.12 | Java-Bibliothek | – | – |
| com.sun.xml.messaging.saaj:saaj-impl | 2.0.1 | Java-Bibliothek | – | – |
| com.aayushatharva.brotli4j:service | 1.23.0 | Java-Bibliothek | – | – |
| io.prometheus:simpleclient | 0.16.0 | Java-Bibliothek | `Apache-2.0` | – |
| io.prometheus:simpleclient_common | 0.16.0 | Java-Bibliothek | `Apache-2.0` | – |
| io.prometheus:simpleclient_tracer_common | 0.16.0 | Java-Bibliothek | `Apache-2.0` | – |
| io.prometheus:simpleclient_tracer_otel | 0.16.0 | Java-Bibliothek | `Apache-2.0` | – |
| io.prometheus:simpleclient_tracer_otel_agent | 0.16.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.slf4j:slf4j-api | 2.0.18 | Java-Bibliothek | – | – |
| org.jboss.slf4j:slf4j-jboss-logmanager | 2.0.2.Final | Java-Bibliothek | `Apache-2.0` | – |
| io.smallrye.common:smallrye-common-annotation | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-classloader | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-constraint | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-cpu | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-expression | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-function | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-io | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-net | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-os | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-process | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-ref | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-resource | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-search | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.common:smallrye-common-vertx-context | 2.19.0 | Java-Bibliothek | – | – |
| io.smallrye.config:smallrye-config | 3.17.2 | Java-Bibliothek | – | – |
| io.smallrye.config:smallrye-config-common | 3.17.2 | Java-Bibliothek | – | – |
| io.smallrye.config:smallrye-config-core | 3.17.2 | Java-Bibliothek | – | – |
| io.smallrye.config:smallrye-config-source-keystore | 3.17.2 | Java-Bibliothek | – | – |
| io.smallrye.config:smallrye-config-validator | 3.17.2 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-context-propagation | 2.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-context-propagation-api | 2.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-context-propagation-jta | 2.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-context-propagation-storage | 2.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-fault-tolerance-vertx | 6.11.4 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-health | 4.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-health-api | 4.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-health-provided-checks | 4.3.0 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-health-ui | 4.3.0 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-auth-common | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-bridge-common | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-core | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-runtime | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-uri-template | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-web | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-mutiny-vertx-web-common | 3.23.1 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-core | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-jaxrs | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-model | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-spring | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-ui | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye:smallrye-open-api-vertx | 4.3.5 | Java-Bibliothek | – | – |
| io.smallrye.certs:smallrye-private-key-pem-parser | 0.9.4 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-reactive-converter-api | 3.0.3 | Java-Bibliothek | – | – |
| io.smallrye.reactive:smallrye-reactive-converter-mutiny | 3.0.3 | Java-Bibliothek | – | – |
| org.eclipse.angus:smtp | 2.0.5 | Java-Bibliothek | – | – |
| org.yaml:snakeyaml | 2.0 | Java-Bibliothek | `Apache-2.0` | – |
| org.snakeyaml:snakeyaml-engine | 2.6 | Java-Bibliothek | `Apache-2.0` | – |
| org.jvnet.staxex:stax-ex | 2.0.1 | Java-Bibliothek | `BSD-3-Clause` | – |
| org.aesh:terminal-api | 3.18.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.aesh:terminal-detect | 3.18.1 | Java-Bibliothek | `Apache-2.0` | – |
| org.aesh:terminal-tty | 3.18.1 | Java-Bibliothek | `Apache-2.0` | – |
| com.apicatalog:titanium-json-ld | 1.3.3 | Java-Bibliothek | `Apache-2.0` | – |
| org.twitter4j:twitter4j-core | 4.1.2 | Java-Bibliothek | `Apache-2.0` | – |
| org.jboss.narayana.arjunacore:txoj | 7.3.4.Final | Java-Bibliothek | – | – |
| org.glassfish.jaxb:txw2 | 4.0.9 | Java-Bibliothek | – | – |
| com.github.ua-parser:uap-java | 1.6.1 | Java-Bibliothek | `Apache-2.0` | – |
| io.vertx:vertx-auth-common | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-bridge-common | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-codegen | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-core | 4.5.34 | Java-Bibliothek | `Apache-2.0`, `EPL-2.0` | – |
| io.vertx:vertx-grpc | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-grpc-client | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-grpc-common | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-grpc-server | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-uri-template | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-web | 4.5.34 | Java-Bibliothek | `Apache-2.0`, `EPL-2.0` | – |
| io.vertx:vertx-web-client | 4.5.34 | Java-Bibliothek | – | – |
| io.vertx:vertx-web-common | 4.5.34 | Java-Bibliothek | – | – |
| com.webauthn4j:webauthn4j-core | 0.30.3.RELEASE | Java-Bibliothek | – | – |
| com.webauthn4j:webauthn4j-util | 0.30.3.RELEASE | Java-Bibliothek | – | – |
| org.wildfly.common:wildfly-common | 1.5.4.Final-format-001 | Java-Bibliothek | `Apache-2.0` | – |
| org.wildfly.security:wildfly-elytron-asn1 | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-auth | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-auth-server | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-base | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-credential | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-http | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-keystore | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-mechanism | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-mechanism-digest | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-mechanism-gssapi | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-mechanism-oauth2 | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-mechanism-scram | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-password-impl | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-permission | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-provider-util | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-digest | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-external | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-gs2 | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-gssapi | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-oauth2 | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-plain | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-sasl-scram | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-security-manager-action | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-ssl | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-util | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-x500 | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-x500-cert | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.wildfly.security:wildfly-elytron-x500-cert-util | 2.9.2.SP1 | Java-Bibliothek | – | – |
| org.graalvm.sdk:word | 25.0.4.1 | Java-Bibliothek | – | – |
| org.apache.santuario:xmlsec | 3.0.6 | Java-Bibliothek | `Apache-2.0` | – |
