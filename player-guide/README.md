# Player guide (tournament regulations)

Публичная HTML-страница для игроков, зрителей и стримеров: регламент, сетевой профиль, пояснение `cl_timeNudge`.

## Открыть локально

```
player-guide/index.html
```

## CDN (после push в GitHub)

```
https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/player-guide/index.html
```

## OBS

- Browser Source на полный кадр или слайд «правила перед матчем».
- Фон тёмный (`#0d1117`) - chroma key не нужен.
- Разрешение: 1920x1080 или масштаб по ширине.

## Редактирование

1. **Общие** cvars и честная игра: [`docs/TOURNAMENT-REGULATIONS.md`](../docs/TOURNAMENT-REGULATIONS.md)
2. **Регламент конкретного турнира (SoT):** `ql-public-data/tournaments/{slug}/regulations.md` (пример: `fast-learning-cup`)
3. Публичная вёрстка шаблона: `index.html`, стили: `guide.css`
4. При изменении фактов по cvars сверяться с `skills/ql-live` (runtime dumps)
