# План по скорости и надёжности / Performance implementation plan

## Кратко

- План по пяти задачам на скорость и надёжность и по «мелочам», которые выбрал
  анализ от 2026-11-03. По вашей просьбе задачи собраны в четыре PR по частям
  приложения (раздел «Пакеты»), у каждой строки «Прогресса» своя галочка.
- Агент, закончив задачу, ставит в «Прогрессе» галочку, ссылку на PR и дату.
- Сам план ничего в приложении не меняет. По вашему поручению агент делает
  пакеты по одному и сам сливает каждый PR.
- Для части задач сначала нужны ваши ответы из раздела «Решения владельца».
  У каждого вопроса указан рекомендуемый ответ.

## How an agent uses this plan

1. **Pick one task** from [Progress](#прогресс--progress). Start it only when
   every task it depends on is ticked, and its owner decisions are answered
   under [Owner decisions](#решения-владельца--owner-decisions). An unanswered
   decision blocks only the steps that need it.
2. **Read the whole task file**, then `AGENTS.md`, the `/implement` skill
   (`.claude/skills/implement/SKILL.md`) and every file under the task's
   "Read first".
3. **Re-check "Current behaviour" against the current `main`.** The plan was
   checked at commit `11626a6` on 2026-11-03, so line numbers will drift. If
   the code changed so much that a step no longer fits, correct the task file in
   the same PR and say so in the PR description.
4. **Work in the batch PRs listed under [Batches](#пакеты--batches).** The owner
   asked for as few pull requests as possible (2026-11-03), which lifts the
   one-task-one-PR rule for this plan. Inside a batch, do the items one at a
   time, in the listed order, with one commit per item, so any item can be
   reverted on its own. Where a task file says "PR 1" and "PR 2", make them two
   commits in the same batch. The agent merges each batch itself, one at a time.
5. **Tick each item in its own commit**: change `[ ]` to `[x]` and fill in
   `PR:` and `Дата:`. The tick reaches `main` only when the batch PR merges.
   Tick the task file's own "Done when" boxes in the same commit. If "Verify
   after merge" then fails on Testing, the fix removes the tick and records why
   on the same line.
6. **A task that turns out not to be needed** (a measurement gate stays closed,
   or the owner says no) is ticked as well. Replace `PR: —` with
   `не понадобилось: <reason>` and add the date.
7. **Record numbers and answers** in
   [Measurements and decisions](#журнал-измерений-и-решений--measurements-and-decisions)
   in the next PR that touches this plan. Never record names, phone numbers,
   e-mail addresses, links with tokens or other personal data.
8. **Safety rules from `AGENTS.md`.**
   - Testing shares the real backend with Production, and merging to `main`
     deploys Testing, Functions, Firestore rules and indexes at once.
   - Merge one PR at a time, and confirm each `main` run as
     `.claude/rules/release-pipeline.md` says.
   - Never promote to Production. Never write data on Testing beyond what the
     task file allows. Never sign in to the real backend.

## Прогресс / Progress

Format: `- [ ] **ID** · Russian name · *English name* → task file · PR: — · Дата: —`

### Пять задач / The five tasks

1. **Скорость на медленном телефоне / Test on slow phones and networks (#31)**
   - [x] **T1** · Замерить скорость страниц водителя на телефоне · *Measure the driver pages on a phone* → [T1](T1-driver-pages-on-phone.md) · PR: #557 · Дата: 2026-11-03
   - [x] **T1-F** · Запрашивать код анкеты сразу при запуске (итог T1: GO, около 0,7 с) · *Request the `/apply` route code during start-up* → [T1 §5](../qa/mobile-speed-baseline.md) · PR: #557 · Дата: 2026-11-03
   - [x] **T3-static** · Нейтральная заставка в `index.html` вместо белого экрана (итог T1: GO; Р7: да) · *Neutral static placeholder in `index.html`* → [T1 §5](../qa/mobile-speed-baseline.md) · PR: #557 · Дата: 2026-11-03
2. **Постраничная загрузка / Paginate results (#5)**
   - [x] **T2a** · Постраничный журнал получателей и отчёт кампании · *Page the campaign recipient log and delivery report* → [T2a](T2a-campaign-results-paging.md) · PR: #558 · Дата: 2026-11-03
   - [x] **T2b** · E-Docs: грузить только последние конверты, счётчики с сервера · *Load only recent envelopes in E-Docs* → [T2b](T2b-edocs-recent-envelopes.md) · PR: #558 · Дата: 2026-11-03
   - [x] **T2c** · Ограничить списки кампаний, итоги остаются верными · *Limit the Campaigns lists* → [T2c](T2c-campaigns-lists-limit.md) · PR: #558 · Дата: 2026-11-03
   - [x] **T2d** · (необязательно) Свои напоминания не пропадают из колокольчика · *(optional) Keep own reminders in the notification bell* → [T2d](T2d-notification-bell-reminders.md) · PR: #558 · Дата: 2026-11-03
3. **Заглушки вместо нулей / Skeleton loading screens (#1)**
   - [x] **T3 PR 1** · Компонент `Skeleton` и счётчики панели компании · *Design-system `Skeleton`, `MetricCard loading`, company dashboard* → [T3](T3-loading-placeholders.md) · PR: #557 · Дата: 2026-11-03
   - [x] **T3 PR 2** · Заглушка страницы заявки водителя · *Driver apply-page placeholder* → [T3](T3-loading-placeholders.md) · PR: #557 · Дата: 2026-11-03
4. **Лимиты времени для внешних сервисов / Timeouts for external calls (#12)**
   - [x] **T4.1** · RingCentral: лимит 20 секунд, без повторной отправки SMS · *RingCentral 20-second limit, no resend* → [T4.1](T4.1-ringcentral-timeout.md) · PR: пакет C · Дата: 2026-11-04
   - [ ] **T4.2** · Кампании: «возможно отправлено», без авто-повтора · *Campaigns safe when the SMS provider does not answer* → [T4.2](T4.2-campaign-send-unconfirmed.md) · PR: — · Дата: —
   - [ ] **T4.3** · Лимиты для 8x8 SMS и Facebook · *Time limits for 8x8 SMS and Facebook Graph* → [T4.3](T4.3-8x8-facebook-timeouts.md) · PR: — · Дата: —
   - [x] **T4.4** · Лимит 15 секунд для чтений GitHub в Releases · *15-second limit on GitHub reads behind Releases* → [T4.4](T4.4-github-release-timeouts.md) · PR: пакет C · Дата: 2026-11-04
   - [x] **T4.5** · Импорт Google Sheet и скачивание PDF не крутятся вечно · *Sheet import and envelope PDF download stop spinning forever* → [T4.5](T4.5-browser-fetch-timeouts.md) · PR: #557 · Дата: 2026-11-03
5. **Скорость у реальных пользователей / Real-user speed monitoring (#30)**
   - [ ] **T5** · Вариант A: Firebase Performance Monitoring · *Option A: Firebase Performance Monitoring* → [T5](T5-firebase-performance.md) · PR: — · Дата: —
   - [x] **T5-alt** · Вариант B: оставить Sentry (вместо T5 и T5b) · *Option B: keep Sentry as the speed tool* → [T5-alt](T5-alt-sentry-speed.md) · не понадобилось: владелец выбрал A (Р13) · Дата: 2026-11-03
   - [ ] **T5b PR 1** · (необязательно) Отключить Sentry: приложение · *(optional) Switch Sentry off: the app* → [T5b](T5b-sentry-off.md) · PR: — · Дата: —
   - [ ] **T5b PR 2** · (необязательно) Отключить Sentry: CI и настройки · *(optional) Switch Sentry off: CI and configuration* → [T5b](T5b-sentry-off.md) · PR: — · Дата: —

### Мелочи / Minor items

Each can be done on its own, or when someone next changes that part of the app.

- **Лишние и последовательные запросы / Duplicate calls, N+1, parallel requests (#3, #8, #16)**
  - [ ] **M1a** · Кэш команды: имена по общему правилу, одно чтение · *Team cache: shared naming rule, one read* → [M1a](M1a-team-cache-names.md) · PR: — · Дата: —
  - [ ] **M1b** · Assign Leads и Import Leads: команда одним запросом · *Assign/Import Leads read the team in one request* → [M1b](M1b-assign-import-team-read.md) · PR: — · Дата: —
  - [ ] **M1c** · Настройки команды: все дневные цели одним запросом · *Team settings: every daily goal in one request* → [M1c](M1c-team-goals-read.md) · PR: — · Дата: —
  - [x] **M2a** · Заметки в досье: история из уже загруженной записи · *Dossier Notes reuse the loaded record* → [M2a](M2a-notes-shared-history.md) · PR: #557 · Дата: 2026-11-03
  - [x] **M2b** · Файлы досье: подписанная ссылка живёт 10 минут · *Dossier files reuse a signed link for ten minutes* → [M2b](M2b-signed-link-reuse.md) · PR: #557 · Дата: 2026-11-03
  - [ ] **M3a** · Комната подписи: независимые шаги сервера параллельно · *Signing room: independent server steps in parallel* → [M3a](M3a-signing-room-parallel.md) · PR: — · Дата: —
  - [ ] **M3b** · Запуск кампании: проверки параллельно · *Campaign launch checks in parallel* → [M3b](M3b-campaign-launch-parallel.md) · PR: — · Дата: —
  - [x] **M-SA** · Поиск Super Admin: показывать только самый свежий ответ · *Super Admin search shows only the newest answer* → [M-SA](M-SA-super-admin-search.md) · PR: #557 · Дата: 2026-11-03
- **Меньше данных в списке заявок / Select only the columns you need (#24)**: после T1
  - [x] **M4-1** · Поиск по имени с двух букв · *Two-letter minimum for name search* → [M4](M4-applications-list-payload.md) · PR: #557 · Дата: 2026-11-03
  - [ ] **M4-2** · Записать замер и решение («ворота» открыты или закрыты) · *Record the measurement and the gate verdict* → [M4](M4-applications-list-payload.md) · PR: — · Дата: —
  - [ ] **M4-3a / 3b / 3c** · Только если ворота открыты и вы согласны: серверная функция для списка · *Only if the gate opens and the owner agrees* → [M4](M4-applications-list-payload.md) · PR: — · Дата: —
  - [x] **M4-4** · (необязательно) То же, что M2a: если M2a сделана, отметить «не понадобилось» — не понадобилось, сделано в M2a · *(optional) Same as M2a: not needed, done under M2a* → [M4](M4-applications-list-payload.md) · PR: #557 · Дата: 2026-11-03
- **Меньше лишних перерисовок / Prevent unnecessary re-renders (#26)**: после T1
  - [x] **M5-1** · Записать замер и решение (при 4x: анкета W1 88 мс — закрыто, W2 128 мс — наблюдать; список L1 112 мс — делать M5-2) · *Record the measurement and the verdict* → [M5](M5-re-renders.md) · PR: #558 · Дата: 2026-11-03
  - [x] **M5-2** · Список кандидатов: стабильные свойства (L1 при 4x: 112 → 72 мс) · *Stable props for the candidate list* → [M5](M5-re-renders.md) · PR: #558 · Дата: 2026-11-03
  - [x] **M5-3** · Анкета водителя: одна правка, только если замер покажет · *One wizard fix, only if its gate opens* → [M5](M5-re-renders.md) · не понадобилось: W2 128 мс при 4x — «наблюдать», а W-a и W-b не S-правки · Дата: 2026-11-03
- **Обновление экрана до ответа сервера / Optimistic UI (#14)**
  - [x] **M6** · Assign To возвращается к сохранённому, если сохранение не удалось · *Put the Assign To picker back when the save fails* → [M6](M6-assign-picker-rollback.md) · PR: #557 · Дата: 2026-11-03
  - [ ] **M6-opt** · (необязательно) Новая заметка сразу, с пометкой «Saving…» · *(optional) Show a new note at once, marked "Saving…"* → [M6-opt](M6-opt-note-saving-mark.md) · PR: — · Дата: —
- **Медленная работа в фоне / Background jobs (#7)**
  - [ ] **M7a** · Замер: ожидание при отправке заявки и заявки без PDF (владелец, только чтение) · *Measure the submit wait and count missing PDFs* → [M7a](M7a-submit-wait-and-pdf-counts.md) · PR: — · Дата: —
  - [ ] **M7c** · Больше памяти для отправки заявки, только если M7a покажет (до M7b PR 2) · *More memory for submitGuestApplication, only if M7a says so* → [M7c](M7c-submit-memory.md) · PR: — · Дата: —
  - [ ] **M7b PR 1** · Общий помощник для создания PDF (поведение не меняется) · *Behaviour-preserving shared helper* → [M7b](M7b-pdf-auto-repair.md) · PR: — · Дата: —
  - [ ] **M7b PR 2** · Автоматическая починка PDF заявки: очередь, расписание, оповещение · *Automatic PDF repair: queue, scheduled job, alert* → [M7b](M7b-pdf-auto-repair.md) · PR: — · Дата: —

### Дополнительно / Extra (outside the list)

- **OCR и политика безопасности CSP / OCR and the security policy**
  - [x] **X1a** · OCR не ждёт вечно, если движок не запустился · *OCR stops waiting forever when its engine cannot start* → [X1a](X1a-ocr-start-timeout.md) · PR: #557 · Дата: 2026-11-03
  - [ ] **X1b** · Движок OCR и английские данные с нашего сайта (до включения CSP) · *Serve the OCR engine from our own site* → [X1b](X1b-ocr-self-hosted.md) · PR: — · Дата: —

## Журнал измерений и решений / Measurements and decisions

Agents fill this in. Numbers and verdicts only, never personal data.

- **T1, phone baseline:** [docs/qa/mobile-speed-baseline.md](../qa/mobile-speed-baseline.md),
  2026-11-03, app code `11626a6`, 4x CPU and slow 4G, medians:
  - Testing `/login`: FCP 1,065 ms, LCP 1,065 ms, TBT 309 ms.
  - Testing `/apply/<owner company>`: FCP 1,076 ms, LCP 4,203 ms (8,372 ms with real throttling),
    white screen 2,841 ms.
  - Local `/sign` mock: LCP 3,596 ms. Local `/verify` mock: LCP 3,069 ms.
  - Typing at 4x: 88 ms and 128 ms. At 10x: 240 ms and 408 ms.
  - Verdicts: T3 static placeholder GO; earlier `/apply` code download GO (saves about 738 ms);
    M5 typing NO-GO; M4 awaits the owner's numbers. PageSpeed refused with its daily quota, so
    there are no real-user numbers yet.
- **T1-F, earlier `/apply` code download:** 2026-11-03, local harness only, devtools, 3 runs each,
  base `e3ec172`: route code requested 3,503 → 3,134 ms, `gap` 686 → 327 ms, LCP 5,573 → 5,232 ms
  ([T1-F result](../qa/mobile-speed-baseline.md#t1-f-result-local-harness-devtools)).
- **T3-static, start-up splash:** 2026-11-03, local harness only, base `b32fd47`: `/apply` devtools
  (3 runs) FCP 5,425 → 2,021 ms, white screen 4,833 → 1,436 ms, LCP 5,425 → 5,044 ms, CLS 0 → 0;
  `/login` simulate (5 runs) FCP 917 → 930 ms, CLS 0
  ([T3-static result](../qa/mobile-speed-baseline.md#t3-static-result-local)).
- **M4-2, Applications list (owner's DevTools numbers):** date; company size;
  (a) first page, (b) Next page, (c) 3-letter name search, (d) E-Docs; verdict
  OPEN or CLOSED. — *not measured yet*
- **M5-1, re-renders:** 2026-11-03, local harness only (E2E-mode production build,
  `vite preview` on 127.0.0.1, every other host aborted, CDP CPU throttling, keys 150 ms
  apart, INP-like as in T1), median (min–max) of 3, in ms
  ([M5 "As done"](M5-re-renders.md#done-when-acceptance-criteria)):
  - W1 Personal Information (T1's S1, app code `11626a6`): 88 (80–96) at 4x, 240 (216–336)
    at 10x. **Closed.**
  - W2 Employment History with 6 employers (T1's S2): 128 (104–144) at 4x, 408 (304–464) at
    10x. **Watch**: no S-size fix qualifies, so M5-3 is not done.
  - L1 Applications search (`maria`, then New and All Applications; the fixture has 8 rows,
    not 20), app code `66bba0b`: desktop 1440×900 112 (88–120) at 4x, 272 (224–288) at 10x;
    Pixel 7 96 (88–120) at 4x, 224 (208–256) at 10x. **Act** (100–199 on desktop): M5-2.
  - L1 after M5-2: desktop 72 (56–104) at 4x, 184 (160–312) at 10x; Pixel 7 72 (56–80) at
    4x, 176 (168–184) at 10x.
  - Machine: Lighthouse 13.6.0's `benchmarkIndex` page function, 3 times at 1x before each
    L1 series: 1,962 (1,878–2,013.5) before, 2,081 (2,006.5–2,089) after. T1's session,
    where W1 and W2 were measured: 1,572.5.
- **M7a, submit wait and PDFs (owner's numbers):** date; p50/p95/p99 of
  `submitGuestApplication`; counts (a)–(d) from M7a; decisions for M7b and M7c.
  — *not measured yet*

## Порядок и зависимости / Order and dependencies

| Task | Waits for | Note |
|---|---|---|
| T1 | — | Do first: its numbers feed M4 and M5 |
| T2a → T2b → T2c | the task before | T2b and T2c reuse T2a's hooks; T2d is independent |
| T3 PR 1 → T3 PR 2 | PR 1 merged | PR 2 uses `Skeleton` from PR 1 |
| T4.1 → T4.2, T4.3 | T4.1 | T4.4 and T4.5 are independent |
| T5 *or* T5-alt | the owner's choice A/B | T5b only after T5 shows data on Production |
| M1a → M1b | M1a and the owner's answer Р19 | M1c is independent |
| M4-2, M5-1 | T1 | M4-1 can go any time |
| M7a → M7c → M7b PR 2 | M7a's numbers | M7b PR 1 needs only M7a |
| X1a → X1b | X1a | X1b before anyone enforces the CSP |
| X1a, X1b and T5b | no fixed order | Whichever merges second adapts its Sentry parts: the (X1a) and (X1b) items in T5b, or X1a step 3's last bullet and the (T5b) items in X1b |

## Пакеты / Batches

The owner asked for as few PRs as possible. Each batch is one PR, grouped by the
part of the app it changes, so a rollback touches one area only. Work the
batches in this order. Unanswered owner decisions take their recommended
answer, and the batch PR says so.

| Batch PR | What it changes | Items, in order |
|---|---|---|
| **A — Экраны / Screens** | browser only | T1 (measured first, as the baseline), T3 (both parts), T1-F, T3-static (only if Р7 is yes), T4.5, M2a, M2b, M-SA, M4-1, M6, X1a (without Sentry: the owner is removing it) |
| **B — Списки / Lists** | browser and Firestore indexes | T2a, T2b, T2c, T2d, M5 (only where the numbers call for it: T1's for the wizard, M5-1's for the list) |
| **C — Сервер / Server** | Cloud Functions | T4.1, T4.2, T4.3, T4.4, M1a, M1b, M1c, M3a, M3b, M7b PR 1, then M7c (only if M7a's numbers call for it), then M7b PR 2. Without M7a's numbers, M7b PR 2 waits, because it needs M7c merged or ticked "not needed" |
| **D — Мониторинг / Monitoring** | browser, CI and docs | T5, T5b (both parts), X1b. T5b's wait for Production speed data is waived: the owner asked to remove Sentry outright (Р13), and Sentry's page-load data today is one undifferentiated "Pageload" group |
| Waits for the owner's numbers | — | M4-2 and M4-3 (Р2), M7a and M7c (Р24) |
| Not done | — | T5-alt (the owner chose A), M6-opt (recommended no), M4-4 (the same change as M2a), M5-3 (the wizard measured in the watch band) |

## Решения владельца / Owner decisions

The agent writes your answer and the date on each line. Each question names the
task that waits for it.

**T1: замер на телефоне**
- **Р1 (T1).** Ссылку заявки какой компании агенту можно открыть на Testing для
  замера? Сама страница только читает публичный профиль и ничего не создаёт.
  *Рекомендую:* вашу тестовую компанию. Ссылка: Settings → My profile → «Your
  Short Recruiting Link»; пришлите только часть между `/apply/` и `?`. Без
  ответа агент замерит `/sandbox/apply`. — Ответ: страница заявки вашей компании, открывать без `?r=` · Дата: 2026-11-03
- **Р2 (T1, M4).** Потратите около 10 минут на замер списка Applications в
  Chrome на своём компьютере? Пошаговая инструкция на русском есть в T1, шаг 0.
  Без этих чисел M4 решить нельзя. *Рекомендую:* да. — Ответ: — · Дата: —
- **Р3 (T1).** Можно ли один раз запросить Google PageSpeed Insights для
  `https://app.safehaul.io/login`, чтобы прочитать скорость у реальных
  пользователей? Это ничего не меняет. *Рекомендую:* да. — Ответ: да · Дата: 2026-11-03

**T2: постраничная загрузка**
- **Р4 (T2b).** У перевозчика больше 100 отправленных документов. Тогда поиск и
  фильтры на Sent Documents ищут среди загруженных: последние 100, ещё по кнопке
  «Load older documents». Экран об этом предупреждает. Цифры на Overview и
  список «Needs attention» остаются полными. Устраивает? *Рекомендую:* да. Поиск
  по всей истории можно сделать отдельной задачей позже. — Ответ: да (рекомендованный ответ; владелец не возражал на момент выполнения) · Дата: 2026-11-03
- **Р5 (T2d).** Сделать небольшой необязательный фикс: свои напоминания
  рекрутёра не пропадают из колокольчика, даже когда у коллег их много?
  *Рекомендую:* да. — Ответ: да (рекомендованный ответ; владелец не возражал на момент выполнения) · Дата: 2026-11-03
- **Р6 (T2b, T2d). Шаг для вас.** T2b и T2d добавляют индексы Firestore. Перед
  продвижением такого релиза проверьте в Firebase console → Firestore →
  Indexes, что новые индексы в статусе «Enabled». — Сделано: — · Дата: —

**T3: заглушки**
- **Р7 (T3).** Статичная заглушка прямо в `index.html`. Замер T1 показал, что на
  среднем телефоне экран анкеты остаётся белым около 2,8 с, пока загружается код.
  *Рекомендую теперь:* да, нейтральная заставка (фон и логотип, без скриптов) на
  всех страницах. Её видно только эти первые секунды. — Ответ: да (владелец, 2026-11-03) · Дата: 2026-11-03
- **Р8 (T3).** После T3 перевести «...» в итогах Super Admin на такие же
  серые заглушки, отдельным маленьким PR? *Рекомендую:* да. — Ответ: — · Дата: —
- **Р9 (T3).** Если первая загрузка не удалась, четыре карточки панели компании
  покажут «—» вместо 0 (с предупреждением и кнопкой Retry). Оставить так?
  *Рекомендую:* да. — Ответ: — · Дата: —

**T4: лимиты времени**
- **Р10 (T4.2).** SMS-провайдер не ответил вовремя: сообщение могло дойти, а
  могло и нет. Должна ли «Retry Failed» пропускать таких получателей, чтобы
  водитель не получил одно SMS дважды? *Рекомендую:* да. — Ответ: — · Дата: —
- **Р11 (T4.2).** Ставить кампанию на паузу после 3 подряд SMS без ответа
  провайдера? Рекрутёр нажмёт Resume, когда провайдер заработает.
  *Рекомендую:* да. — Ответ: — · Дата: —
- **Р12 (T4.2). По желанию, только чтение.** Посмотрите в Google Cloud console →
  Cloud Tasks → `bulk-actions-queue` значение «Max attempts» и пришлите агенту.
  — Значение: — · Дата: —

**T5: скорость у реальных пользователей**
- **Р13 (T5).** Чем измерять скорость у реальных пользователей? A — Firebase
  Performance Monitoring (T5, позже T5b). B — оставить Sentry (только T5-alt).
  *Рекомендую:* A: вы планируете отключить Sentry, а Firebase Performance
  бесплатен и уже входит в проект. — Ответ: A, и Sentry удалить полностью · Дата: 2026-11-03
- **Р14 (T5).** Можно ли замерять страницу подписи `/sign/...`? Firebase
  сохранит адрес страницы с двумя внутренними номерами документа; ключ доступа
  (`?token=`) не отправляется никогда. *Рекомендую:* да. — Ответ: — · Дата: —
- **Р15 (T5). Шаги для вас.** Включите Performance в Firebase console. Проверьте,
  что включены «Firebase Installations API» и «Firebase Remote Config API». Если
  браузерный API-ключ ограничен списком API, добавьте эти два. Без этого данные
  не придут, и ошибки нигде не будет видно. — Сделано: — · Дата: —
- **Р16 (T5b).** Отключение Sentry отключит и отчёты об ошибках из браузеров
  пользователей; Firebase их для веб-приложения не заменяет. Отключить Sentry
  полностью или оставить только для ошибок (отдельная маленькая задача)?
  *Рекомендую:* решать по причине. Если причина — цена или лишний поставщик,
  отключайте. Если важны отчёты об ошибках, оставьте Sentry только для ошибок.
  — Ответ: отключить полностью (из ответа на Р13) · Дата: 2026-11-03
- **Р17 (T5b).** После Sentry отчётам report-only CSP некуда приходить. Убрать
  их сейчас, а сборщик сделать, когда решите включать политику всерьёз?
  *Рекомендую:* да. — Ответ: да (Sentry удаляется полностью) · Дата: 2026-11-03
- **Р18 (только T5-alt, если выбран B).** Session Replay записывает полный адрес
  страницы, в том числе с токеном. Переписывать адрес перед отправкой или не
  записывать повторы на таких страницах? — Не нужен: выбран вариант A · Дата: 2026-11-03

**Мелочи**
- **Р19 (M1a).** Обновить сохранённые списки команды у всех компаний сразу:
  одна запись поля `teamMembers` в каждой компании? Или ждать, пока каждый
  список обновится сам при следующем изменении команды? *Рекомендую:* ждать:
  сотрудников без поля имени мало. — Ответ: — · Дата: —
- **Р20 (M4-1).** Одна буква в поиске по имени оставляет полный список, поиск
  начинается с двух букв. Устраивает? *Рекомендую:* да. — Ответ: да (рекомендованный ответ; владелец не возражал на момент выполнения) · Дата: 2026-11-03
- **Р21 (M4-2).** Если замер покажет больше 300 KB на страницу или больше 1 MB
  на поиск из 3 букв: добавить серверную функцию, которая отдаёт списку только
  нужные колонки? Данные, правила и индексы она не меняет. Первая страница после
  долгого простоя может открываться на 1–3 с дольше. *Рекомендую:* да, если
  пороги превышены. — Ответ: — · Дата: —
- **Р22 (M5).** Порог замера — 4-кратное замедление процессора, как у среднего
  Android. Если у многих водителей очень дешёвые телефоны, можно взять 6x.
  *Рекомендую:* 4x. — Ответ: — · Дата: —
- **Р23 (M6-opt).** Показывать новую заметку сразу, с пометкой «Saving…»?
  *Рекомендую:* нет, выигрыш только внешний. — Ответ: — · Дата: —
- **Р24 (M7a).** Потратите около 15 минут, чтобы прочитать цифры в Google Cloud
  и Super Admin и прислать их агенту? Это только чтение. *Рекомендую:* да.
  — Ответ: — · Дата: —
- **Р25 (M7b).** Если M7a не найдёт сбоев PDF, всё равно сделать автоматическую
  починку? Это одно задание по расписанию, около $0.10 в месяц. *Рекомендую:*
  да, с низким приоритетом. — Ответ: — · Дата: —
- **Р26 (M7b).** Старые заявки без PDF чинить существующей кнопкой Super Admin
  → Maintenance → «Historical application records» (вы сами, по инструкции)?
  *Рекомендую:* да. — Ответ: — · Дата: —
- **Р27 (M7b).** Отмечать на самом документе, что PDF создан позже?
  *Рекомендую:* нет. — Ответ: — · Дата: —
- **Р28 (M7b).** Присылать оповещение «PDF could not be created after 5 tries»
  в Telegram-чат из Super Admin → System Health? *Рекомендую:* да.
  — Ответ: — · Дата: —
- **Р29 (M7b).** Заявки, у которых не сохранилась вся запись, автоматически не
  починить. Восстанавливать их вручную, по одной? Такая запись помечается
  «Reconstructed». *Рекомендую:* да. — Ответ: — · Дата: —
- **Р30 (M7c).** Если сработает правило из M7a: поднять память функции отправки
  заявки с 256MB до 512MB (1GB при очень долгих отправках)? *Рекомендую:* да
  при срабатывании, иначе нет. — Ответ: — · Дата: —
- **Р31 (Referral Links).** Жаловался ли кто-то, что страница Referral Links
  открывается медленно? Если нет, оставляем как есть. — Ответ: — · Дата: —

**Дополнительно**
- **Р32 (X1).** Делать X1 вообще? *Рекомендую:* да, двумя маленькими PR.
  — Ответ: да (рекомендованный ответ; владелец не возражал на момент выполнения) · Дата: 2026-11-03
- **Р33 (X1b).** Языковой файл OCR (2.9 MB, скачивается браузером один раз)
  тоже отдавать с нашего сайта, а не с бесплатного CDN jsDelivr?
  *Рекомендую:* да. — Ответ: — · Дата: —

## Найдено попутно (вне плана) / Found along the way

Not part of any task above. Each needs its own task if the owner wants it.

1. **Privacy: secret link tokens can reach Sentry today.** Error reports from
   `/verify/<token>` and `/review-change/<token>` carry the page address, and on
   `/sign/...` that includes `?token=`. `scrub()` (`src/shared/utils/scrub.js`)
   redacts sensitive key names and masks SSN, e-mail and phone values, but not
   URL paths or query strings. Checked by reading the code only; no live Sentry
   event was inspected. With option A this stays until T5b. *Recommended:* a
   separate small task soon, independent of this plan.
2. "Retry Failed" with nothing left to retry shows "Retry session started with
   undefined targets." (`functions/bulkActions/controllers/sessionController.js:221`).
3. The 8x8 connection check reports success on any network error other than
   401/403 (`functions/integrations/adapters/eightbyeight.js:143-151`). T4.3 fixes
   only the timeout case.
4. The envelope PDF download does not check `response.ok`
   (`src/features/signing/utils/envelopePersistence.js:78-79`).
5. `resendSignerOnCorrection` sends the e-mail before the SMS in one 60-second
   function (`functions/resendSignerOnCorrection.js:47-52`). A slow mail server
   plus a silent SMS provider can end it before the SMS result is recorded. It
   never sends twice.
6. The Notes tab's save-failure message sits inside two nested alert regions
   (`NotesTab.jsx:206-208`), so some screen readers may read it twice.
7. The dossier's message for a missing PDF
   (`src/features/applications/services/applicationPdfService.js:60-63`) is wrong
   for a recent submission whose PDF is still being repaired. Fix after M7b.
8. `deleteCompany` and `backfillEmployerFields` must finish within one 540 s call
   (`functions/companyAdmin.js:33-53`, `functions/legacyCompat.js:5-8`).
9. Before anyone enforces the CSP: Sentry cannot see policy violations inside
   Web Workers (OCR, the PDF viewer's worker, bulk import, Session Replay). Run
   those flows once with the policy enforced first.
10. Correction to the 2026-11-03 analysis: Sentry 11.8.0 names every page load
    "Pageload" rather than the raw path. The scope's transaction name still
    carries the raw path, which is how item 1 happens.
11. `deleteApplication` sweeps Storage before `recursiveDelete`
    (`functions/deleteApplication.js:49-66`), and nothing marks a deletion in
    progress. A PDF written in between (a late original render today, or M7b's
    repair later) can be left behind, and a re-application by the same driver
    gets the same application id. A second sweep after `recursiveDelete`
    narrows the window but does not close it. Closing it needs every writer to
    refuse to save for a deleted or deleting application, for example through a
    deletion marker that `preserveApplicationPdf` checks. M7b's own check-back
    narrows its part of the window only.
12. **A failed Firebase config leaves a blank page in the built app**, not the
    "This page could not load" screen `docs/APP_BRIEF.md` promises. The build
    inlines `src/app/startup/startupGuards.jsx` into the entry chunk, and
    `src/lib/firebase/config.js` (top-level await on `/__/firebase/init.json`)
    is a separate chunk the entry imports, so it runs first; when it rejects,
    the guard's listener is never registered. Reproduced on `e3ec172` with
    `vite preview` and a 503 for `init.json` (found during T1-F).
    `startupGuards.test.jsx` checks source order, not the bundled order.
    *Recommended:* a separate small task with a built-app test.
