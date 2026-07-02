# ql-stream-tools — бизнес-правила

## Назначение

**Streamer dashboard** + **OBS presentation layer** для стримеров и кастеров турнира.

| Слой | Аудитория | Содержимое |
|------|-----------|------------|
| **Dashboard** (`live-overlay/dashboard/`) | Стример за сценой | Live-матчи, турнир (ql-public-data), карта/киллфид/пикапы, replay |
| **Overlays** (`stream-overlay/`, `live-overlay/*.html`) | OBS Browser Source | Лого, табло, миникарта, ticker — только то, что на эфире |

Dashboard и overlays **разделены**: аналитика матча не смешивается с настройкой OBS URL.

## Dashboard — разделы

| Раздел | Данные | Транспорт |
|--------|--------|-----------|
| **Dashboard** (home) | Текущие матчи, серверы | stats-hub WS + `/api/stream/matches` |
| **Tournament** | Участники, сетка, демки, статистика | ql-public-data CDN |
| **Match** | Summary, map, killfeed, pickups | WS live; replay `/api/replays/{id}` для ended |
| **Settings** | stats-hub URL, public data base, турнир | localStorage |

Маршрутизация: hash (`#/`, `#/results`, `#/tournament`, `#/server/{id}`, `#/settings`).

## Классы overlay (OBS)

| Overlay | Данные | Транспорт (целевой) |
|---------|--------|---------------------|
| Tournament popup (лого, стадия, игроки) | Турнирные meta + live match | **WebSocket** к stats-hub (сегодня: CDN poll — мигрировать) |
| Таблица счёта / scoreboard | stats-hub match state | **WebSocket**; HTTP poll — только fallback |
| Позиции на карте | stats-hub telemetry | **WebSocket**; poll **не** использовать |
| Список матчей | stats-hub stream API | WS или редкий REST; не частый poll |
| Player guide (регламент) | Статический HTML | CDN / локальный файл; без API |

## Правила real-time

1. **WebSocket** — основной канал для всех live-данных.
2. HTTP poll допустим **только** как fallback для матчей и таблицы счёта.
3. Телеметрия карты — **только WS**, без poll fallback.
4. PNG карт: **ql-stream-tools/live-overlay/maps/** — одна загрузка, кэш по `map_name`; калибровка в `map_transforms.json`.
5. Не увеличивать нагрузку на game server — все запросы к **stats-hub**, не к QLDS.

## Подключение к stats-hub

- Dashboard и overlay подключаются к stats-hub **напрямую** (WS URL в настройках dashboard / OBS localStorage).
- При необходимости — stream read token (отдельно от ingest).
- **Не** использовать hub URL/token для стримеров.

## Публичные данные турнира (ql-public-data)

| Файл | Dashboard |
|------|-----------|
| `meta.json`, `players.json`, `bracket.json` | Tournament |
| `demos.json` | Tournament — ссылки на демки |
| `stats/summary.json`, `stats/players.json` | Tournament — агрегаты |
| `overlay-live.json` | Dashboard home — `/connect` hints |
| `games/{id}.json` (v2, после publish) | Match — архивная аналитика |

Публикация архива: hub operator workflow → см. `docs/MATCH-ANALYTICS-PLAN.md`.

## Чего не делать

- Дублировать ingest или store (это stats-hub).
- Добавлять новые overlays в `ql-stats-hub/static/overlay/` — только сюда.
- Частый poll + повторная загрузка assets (антипаттерн из MONOREPO-BUSINESS).
- Смешивать dashboard UI с OBS chroma/minimal chrome в одной странице без явного `chrome=` режима.

## Миграция

- `live-overlay/control/` → `live-overlay/dashboard/` (control — redirect).
- Перенести legacy overlays из stats-hub в `live-overlay/` (или аналог). После переноса — hard remove legacy URLs на stats-hub.

## Связанные документы

- `ql-stats-hub/docs/BUSINESS.md` — API и WS
- `ql-public-data/docs/PUBLIC-DATA.md` — CDN JSON schemas (public)
- `docs/MATCH-ANALYTICS-PLAN.md` — архив сессий, publish в public data
- `docs/MONOREPO-BUSINESS.md`
