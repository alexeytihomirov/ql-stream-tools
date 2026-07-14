# План доработок live-overlay demo-плеера (`#/demo`)

Область: `ql-stream-tools/live-overlay/`. Реализация - не в рамках этой сессии, план для передачи в работу.

## 1. Play-кнопка и киллфид на `#/demo`

**Play-кнопка**: `views/demo.js:265-278` (`updateReplayControlUi`) использует устаревшую `playBtn.textContent = ...`, хотя разметка кнопки (общий шаблон для demo/results) содержит `<img id="match-timeline-play-icon">`. Рабочая версия - `views/results.js:386-408` (меняет `icon.src` на `icons/replay/play.png`/`pause.png`).
**Фикс**: скопировать `updateReplayControlUi` из `results.js:386-408` в `demo.js`, убрать textContent-версию.

**Киллфид ("Lightninggun" текстом вместо иконки LG)**: demo-парсер отдаёт `weapon_slug` слитно без пробела (`lightninggun`, `rocketlauncher`, `grenadelauncher`, `proxlauncher` - см. `lib/qldemo/weapons.js`, `entity-events.js`). Таблица `WEAPON_BY_TOKEN` в `analytics-shared.js:145-178` этих слитных форм не знает → fallback в `titleCase(base)`.
**Фикс**: добавить в `WEAPON_BY_TOKEN` ключи `LIGHTNINGGUN`, `ROCKETLAUNCHER`, `GRENADELAUNCHER`, `PROXLAUNCHER`.

## 2. Фулскрин виджета карты

Единая точка монтажа - `MapWidget.mount()` (`map-widget.js:132-160`), используется demo/match(server)/results - править один раз здесь, применится везде.

**План**: добавить floating-кнопку в правом нижнем углу `container`, скрыта по умолчанию, показывается по `mousemove`, прячется через ~2с бездействия. По клику - `container.requestFullscreen()`/`exitFullscreen()`. CSS: `:fullscreen` растягивает `.map-layout` на 100vw/100vh, вызывать `applyFit()` по `fullscreenchange`.

**Иконка**: MCP с иконками в этом окружении не нашлось. `ui-icons/` - это набор icons8 (лицензия рядом, `LICENSE-icons8.txt`). Рекомендация: взять "Fullscreen"/"Fullscreen Exit" из того же icons8-сета вручную и положить как `ui-icons/fullscreen.png`/`fullscreen-exit.png` - впишется в стиль тулбара 1-в-1. Fallback - inline SVG, если иконку взять неоткуда.

## 3. Оружие в руке x1.5

`overlay.css:953-964` (`.map-weapon-icon`): `width:9px→13.5px; height:24px→36px; margin-left:-4.5px→-6.75px; margin-top:-12px→-18px`. Проверить смещение `weapOffsetPx = 1.5 * (size/2)` (`overlay.js:4437`) визуально после правки - оно завязано на размер точки игрока, не на размер иконки.

## 4. Тулбар: единая кнопка + выпадающее меню на все эффекты

Флагов видимости взрывов/снарядов/трейлов сейчас не существует - рендерятся всегда (`overlay.js:3685-3902`).

**План**:
- Новые флаги в `settings` (map-spawns.js, рядом с `showWeaponInHand`): `showExplosions`, `showProjectiles`, `showTrails`, `showBeams`.
- В `overlay.js` добавить проверку флага перед рендером в `renderImpactMarkers` (~3786), `renderBeamMarkers` (~3887), `renderProjectileMarkers` (~3946).
- Кнопка "оружие в руке" на тулбаре (`map-spawns.js:4969-4977`) становится мастер-переключателем всех этих флагов разом.
- Рядом - caret + popover по образцу "Layers" (`map-spawns.js:4810-4822`, `addCaret()` 4724+, контент по образцу `rebuildLayerControls` 3150-3176): чекбоксы на каждый флаг отдельно.
- `syncToolbar()` (4645-4661) - синхронизировать `aria-pressed`.

## 5. Таймер "сотни минут" - причина найдена

`replayGameTimeFieldMs()` (`overlay.js:5461-5465`):
```js
var g = Number(ev.time);
return g < 100000 ? g * 1000 : g;   // угадывание секунды/мс по величине
```
Demo-парсер (`demo-to-replay.js:702`, `replay-for-overlay.js:41`) пишет `ev.time` уже в мс - значения до 100 000 (события в первые ~100 сек игры) умножаются на 1000 ещё раз. Хуже: `computeReplayGameStartWall()` (5868-5886) берёт медиану по этим полям для точки отсчёта таймера всей демки - один ранний искажённый фраг/пикап сдвигает таймер на всю сессию.

**Фикс**: `replayGameTimeFieldMs` должна читать `ev.game_time_ms` (стабильно в мс везде, live и demo-derived), убрать угадывание `*1000`. Свериться, что live-реплеи (`lib/qlreplay/decode.js:126/198/230`) тоже всегда дают `game_time_ms` в мс.

## 6. Ускорить затухание x10, убрать fade у LG-луча

`impactMarkerTtlMs()` (`overlay.js:3688-3690`): `explosion: 2200 → 220`, `остальное (bullet/plasma/generic): 1200 → 120`.
`beamMarkerTtlMs()` (`overlay.js:3812-3814`, общий для RG/LG, opacity-формула 3887): убрать fade **только** для LG (`weapon_slug === "lightninggun"` - луч пропадает мгновенно), рейлган не трогать - подтверждено пользователем.

**Реализация констант**: вынести в один конфиг-объект наверху секции (например `EFFECT_FADE_MS = { explosion: 220, impact: 120, beam: 260 }`), чтобы значения были легко доступны для правки одним местом - подтверждено пользователем.

## 7. Попадания LG как у UDT (точки-маркеры)

У LG сейчас нет точки попадания, только тающий луч. Рендер-пайплайн для точек уже есть: `createImpactMarker`/`addImpactMarker`/`renderImpactMarkers` (`overlay.js:3695-3802`), CSS для жёлтой точки уже заведён и не используется (`overlay.css:1378-1380`, `.map-fx-impact-shaft`).
**Фикс**: в `demo-to-replay.js`, в месте построения LG-луча (`lgBeamEndpoint()`, ~108, вызов ~685), дополнительно пушить `impacts` запись `kind: "shaft"` в точку конца луча.

## 8. Розовая обводка при попадании (v1 - только на фраг)

Уровень "POV попал по кому-то" (эксперимент через `persistant[]`) - **отложен** по решению пользователя.

**Скоуп v1**: вспышка обводки жертвы на `death`-событие (live и replay) - `.map-dot--hit`/`.map-pin-outline--hit` на ~400-500мс, обработчики `overlay.js:5510/5733/5832/6418`. Обычная обводка - `.map-dot` (`overlay.css:791-804`), `.map-pin-outline` (835-841).

## 9. Находки по spectator-демкам (проверено на реальном файле)

Тестовый файл: `ql-stream-tools/demos/Input-vs-invalid-phrantic-2026_06_30-10_59_06.dm_91` (подтверждённая spectator-запись: recording clientNum=1 "StreamSpec", не в ростере игроков).

### 9.1 HP/armor всех игроков - подтверждено, готово к реализации

Raw entity-поля `ent.health`/`ent.armor` (индексы 55/56, `entity-state.js:241-246`) реально несут ненулевые значения для **обоих** игроков почти на каждом снапшоте (49525/49525 сэмплов с health>0, поровну на обоих клиентах) - но `playerRowFromEntity()` (`demo-to-replay.js:500-501`) их безусловно обнуляет.
**Фикс**: убрать хардкод `health: null, armor: null` для не-followed игроков, подставлять `ent.health`/`ent.armor` через `saneVital()` (как уже делается для POV).

### 9.2 Подборы предметов - требует доп. проверки перед фиксом

Важно: закэшированный `demos/*.replay.json` показывает всего 26 подборов, но при повторном прогоне **того же неизменённого** `demo-to-replay.js` с явно переданной `mapTable` (как это уже делает `demo.js:404-411` в живом дашборде) - **444** подбора. Похоже, `.replay.json` в папке - устаревший артефакт без mapTable, а не показатель бага текущего дашборда.

**Действие**: перепроверить через реальный `#/demo` в браузере на этом файле - если там тоже ~26, значит mapTable где-то теряется по пути (баг); если ~444 - значит всё ок и файл в demos/ просто устарел.

Отдельно (более крупная задача, не сейчас): нынешняя эвристика подбора (радиус 128 юнитов + "предмет пропал из вида", `playerNearItem`, `demo-to-replay.js:363-370`) даёт заметный процент несовпадений с сырыми protocol-событиями (из 444 эвристических подборов только 173 имеют рядом хоть какое-то raw-событие, 271 - нет) - похоже, эвристика не только теряет подборы вне кадра POV, но и местами ложно засчитывает "подбор" когда предмет просто вышел из вида. Найден кандидат на протокольное событие - raw entity event **id=83** (несёт `otherEntityNum` = номер item-entity, `clientNum` = кто рядом), но однозначного 1:1 совпадения не выявлено - нужна отдельная эмпирическая проверка на нескольких демках перед тем, как переключать логику на него.

## Порядок реализации

Всё одним PR (решение пользователя).
