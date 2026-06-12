# ql-stream-tools — бизнес-правила

## Назначение

**Presentation layer** для стримеров и OBS: все визуальные overlays турнира и live-матча.

## Классы overlay

| Overlay | Данные | Транспорт (целевой) |
|---------|--------|---------------------|
| Tournament popup (лого, стадия, игроки) | Турнирные meta + live match | **WebSocket** к stats-hub (сегодня: CDN poll — мигрировать) |
| Таблица счёта / scoreboard | stats-hub match state | **WebSocket**; HTTP poll — только fallback |
| Позиции на карте | stats-hub telemetry | **WebSocket**; poll **не** использовать |
| Список матчей | stats-hub stream API | WS или редкий REST; не частый poll |

## Правила real-time

1. **WebSocket** — основной канал для всех live-данных.
2. HTTP poll допустим **только** как fallback для матчей и таблицы счёта.
3. Телеметрия карты — **только WS**, без poll fallback.
4. PNG карт: **одна загрузка**, кэш по `map_name` / map key; не запрашивать картинку на каждый tick позиций.
5. Не увеличивать нагрузку на game server — все запросы к **stats-hub**, не к QLDS.

## Подключение к stats-hub

- Overlay подключается к stats-hub **напрямую** (WS URL в конфиге OBS / localStorage).
- При необходимости — stream read token (отдельно от ingest).
- **Не** использовать hub URL/token для стримеров.

## Чего не делать

- Дублировать ingest или store (это stats-hub).
- Добавлять новые overlays в `ql-stats-hub/static/overlay/` — только сюда.
- Частый poll + повторная загрузка assets (антипаттерн из MONOREPO-BUSINESS).

## Миграция

Перенести `scoreboard`, `map`, `matches` overlays из stats-hub в `live-overlay/` (или аналог). После переноса — hard remove legacy URLs на stats-hub.

## Связанные документы

- `ql-stats-hub/docs/BUSINESS.md` — API и WS
- `ql-public-data/docs/PUBLIC-DATA.md` — CDN JSON schemas (public)
- `docs/MONOREPO-BUSINESS.md`
