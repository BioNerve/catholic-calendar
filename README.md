# Catholic Calendar (US) → Google Calendar / Outlook

US Roman Rite (Ordinary Form) calendar as standard `.ics` files.

| File | What's in it |
|---|---|
| `dist/us-catholic-calendar.ics` | Everything: solemnities, feasts, memorials, optional memorials, Sundays, Ash Wednesday, Holy Week, Triduum, US observances, season bands |
| `dist/us-catholic-calendar-essentials.ics` | Same without memorials / optional memorials (lighter for a work calendar) |

Each event is all-day, marked **Free** (never blocks your availability), titled with a liturgical-color dot
(⚪ 🔴 🟢 🟣 🌸 ⚫) and ⛪ on US Holy Days of Obligation. The description holds rank, color and the Sunday cycle (Year A/B/C).

## Import (one-off)

- **Google Calendar (web):** first create an empty calendar (Settings → Add calendar → Create new calendar → "Catholic Calendar (US)"), then Settings → Import & export → Import → pick the `.ics` → choose that calendar. Importing into a separate calendar means you can hide it or delete it in one click.
- **Outlook (new Outlook / web):** Calendar → Add calendar → Upload from file → pick the `.ics` → choose a calendar. Classic Outlook desktop: File → Open & Export → Open Calendar.

## Regenerate / extend

```
npm install
node generate.mjs 2026 2035
```

Event UIDs are stable (`date-celebrationId`), so re-importing a newer file updates rather than duplicates in most clients,
and a subscribed URL refreshes cleanly.

Built-in corrections for romcal bugs: a fixed solemnity is never displaced by a memorial (found 2028-06-24 and 2030-06-29:
Immaculate Heart was shown instead of John the Baptist / Peter and Paul), and memorials that fall on a solemnity are dropped.
The script prints every correction and any warnings.
2026–2028 output was reconciled against the Notion database (US + Both rows): identical counts by year, rank and color.
