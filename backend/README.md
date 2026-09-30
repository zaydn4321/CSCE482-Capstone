# Orbit API

FastAPI service for accounts, location ingest, visit detection, place resolution
against a self-hosted OpenStreetMap index, the interest profile, recommendations,
next-place prediction and full export.
SQLite by default for local development; use persistent PostgreSQL for real
backups. The local Docker example provides PostgreSQL with PostGIS, although
the application currently stores latitude and longitude as numeric columns.

## Run it

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
# In a second terminal
python -m app.worker
```

## Host the optional mobile cloud service on Replit

Use a **separate Replit project** for this backend; do not replace the
Location Wrapped workspace's existing API service. Import
`zaydn4321/CSCE482-Capstone` from GitHub and choose **`backend/` as the project
root**. Configure Python 3.12 or newer and set the development run command to
`uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`. If dependencies
were not detected during import, install the backend package from this
directory before starting it.

1. Open that new project's **Database** tool and use its PostgreSQL
   database. Replit supplies `DATABASE_URL` to the backend. Do not use the
   SQLite development default or this workspace's unrelated database for
   location backups.
2. In the new project's Secrets, set a unique, random `ORBIT_JWT_SECRET` of at
   least 32 characters. Never put it in Expo `EXPO_PUBLIC_*` variables, the
   repository, or chat. Native clients do not require browser CORS, so the
   production command defaults `ORBIT_CORS_ORIGINS` to `[]`. Only set it to a
   JSON array of specific origins if you intentionally add a browser client.
3. Run the development preview once so the development database gets the
   required tables; check `/health`. Publish **that separate backend project**
   as a **Reserved VM**, not an Autoscale service (the worker must run
   continuously). Set the production build command to `python -m pip install .`
   and its run command to `bash scripts/run_replit.sh`. Review the
   development-to-production database schema in the publishing flow. The
   production startup intentionally does not create or migrate tables itself.
4. Once its public HTTPS URL is live, check `<url>/health`. Configure
   `EXPO_PUBLIC_ORBIT_API_URL=<url>` when building the standalone Expo app,
   then rebuild it; public Expo variables are embedded in the client build.
   This URL is not a secret. Do not set it to a development `.replit.dev` URL.

Production startup refuses the development signing secret, SQLite and wildcard
CORS. The `/health` endpoint checks the API process only; after publishing,
also run a manual backup and check the recompute job in the app to confirm the
worker is running. No location upload happens merely by signing in.
Replit's development and production databases are separate. Do not delete a
database to handle schema changes for a real account; the local database
reset advice below is for disposable development data only.

Interactive docs: http://127.0.0.1:8000/docs

> **For disposable local development databases only:** If your local schema is
> outdated, `create_all` cannot alter existing tables. You may reset only a
> database containing no real account or location data. Never run
> `rm orbit-dev.db` or `docker compose down -v` against a database with real
> history. Production schema changes require a reviewed migration.

## Load places

Place resolution only uses our own copy of OpenStreetMap, so load one before
recomputing visits:

```bash
# College Station + Texas A&M, downloaded once from the public Overpass API
python scripts/load_osm.py --bbox 30.57,-96.39,30.66,-96.28 --save cstat.json
# or re-load a saved extract (idempotent: upserts by osm_id)
python scripts/load_osm.py --file cstat.json
```

Only the bounding box is sent to Overpass. No user data ever leaves the server.

To use PostgreSQL instead of the SQLite file:

```bash
docker compose up -d db
cp .env.example .env            # ORBIT_DATABASE_URL points at the container
uvicorn app.main:app --reload
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account, returns a bearer token |
| `POST` | `/auth/login` | Exchange email + password for a token |
| `GET` | `/auth/me` | The current account |
| `DELETE` | `/auth/me` | Hard delete: account, points and visits |
| `POST` | `/locations/batch` | Idempotent ingest of up to 5,000 points |
| `GET` | `/locations` | Points in a time range (`from_ts`, `to_ts`, `limit`) |
| `GET` | `/locations/stats` | Counts and first/last timestamps |
| `GET` | `/visits` | Detected visits, newest first |
| `POST` | `/visits/recompute` | Queue a recompute and return `202` with a job id |
| `GET` | `/jobs/{job_id}` | Read the current user's queued, running, done or failed job |
| `GET` | `/places/nearby` | Places around `lat`/`lon` (`radius_m` ≤ 5000, `category`, `limit`), nearest first |
| `GET` | `/profile` | Interest profile: category weights and top places |
| `PATCH` | `/profile/interests/{category}` | `{"hidden": true}` hides a category everywhere, `false` restores it |
| `GET` | `/recommendations` | Places worth trying, ranked against the interest profile (`limit` ≤ 50) |
| `GET` | `/recommendations/nearby` | The same around `lat`/`lon` (`radius_m` ≤ 20000), with `distance_m` |
| `POST` | `/recommendations/{place_id}/feedback` | `{"action": "saved"\|"dismissed"}`; dismissed places never come back |
| `GET` | `/predict/next` | Top-3 likely next places at `at_ts` (defaults to now) |
| `GET` | `/export` | Everything the account owns, as JSON |
| `GET` | `/health` | Liveness |

All routes except `/health`, `/auth/register` and `/auth/login` need
`Authorization: Bearer <token>`.

Timestamps are epoch milliseconds (UTC) everywhere, matching the app.

## Configuration

Environment variables (or a `.env` file), all prefixed `ORBIT_`:

| Variable | Default | Notes |
| --- | --- | --- |
| `ORBIT_DATABASE_URL` | `sqlite:///./orbit-dev.db` | Any SQLAlchemy URL; use `postgresql+psycopg://…` for Postgres |
| `ORBIT_JWT_SECRET` | dev-only value | Must be a long random string in any deployment |
| `ORBIT_JWT_TTL_SECONDS` | 30 days | Token lifetime |
| `ORBIT_MAX_BATCH_SIZE` | 5000 | Max points per ingest call |
| `ORBIT_PLACE_SEARCH_RADIUS_M` | 50 | Places within this distance of a visit are ranked |
| `ORBIT_PLACE_MIN_CONFIDENCE` | 0.35 | A visit gets a place only if the top candidate clears this |
| `ORBIT_PLACE_TIMEZONE` | `America/Chicago` | Local time for opening hours |
| `ORBIT_RECOMMEND_HOME_RADIUS_M` | 15000 | How far around a user's own visits to look for suggestions |
| `ORBIT_RECOMMEND_MAX_CANDIDATES` | 300 | Places ranked per recommendation request |

## Place resolution

The worker handles each queued recompute outside the API request. Run it with
`python -m app.worker`, or use `python -m app.worker --once` to process at most
one queued job during development and tests. A failed job is retried up to three
times and records its last error. Repeated queued recomputes for the same user are
coalesced into one job.

The recompute job walks the user's visits in time order. For each one it
takes the places within `ORBIT_PLACE_SEARCH_RADIUS_M`, asks the ranker
(`app.ml.places.rank_candidates`) to score them, and assigns the best one if its
confidence clears `ORBIT_PLACE_MIN_CONFIDENCE`. Otherwise the visit stays
unresolved. How often each place was already chosen is passed along, because
revisits are strong evidence. `GET /profile` feeds the resolved visits to
`app.ml.interests.build_interest_profile`. Both models live in `app/ml/` and share
the dataclasses in `app/ml/types.py`.

## Recommendations and prediction

`GET /recommendations` takes the places a user has never visited and never
dismissed, drops hidden categories and the ones nobody wants suggested
(`NEVER_RECOMMEND` in `app/places/recommend.py`), and asks
`app.ml.recommend.recommend_places` to rank what is left against their interest
profile. Without an explicit centre it searches around the middle of the user's own
resolved visits, so a user with no resolved visits gets an empty list rather than a
guess. `GET /predict/next` feeds the same visit history to
`app.ml.predict.predict_next_place`.

Feedback is an upsert per (user, place): dismissing removes a place from every
later response, saving does not.

The API loads all four models lazily (`app/places/ml.py`). Until they are installed,
recompute still detects visits but resolves none, and `/profile`,
`/recommendations` and `/predict/next` answer 503.

## Tests

```bash
python -m pytest -q
```

Tests run against an in-memory SQLite database, so they need no services.
`tests/fixtures/overpass-sample.json` is a small handmade extract around Texas A&M.
Most tests run against the real models in `app/ml/`. The profile, recommendation and
prediction tests pin the simple models in `tests/rankers.py`, because they check the
API, not model quality.

## Layout

```
app/
  jobs/           durable queue, recompute handler and job status route
  worker.py       polling worker entry point
  main.py         app factory, CORS, /health
  config.py       settings
  db.py           engine/session factory (SQLite + Postgres)
  models.py       users, location_points, visits, places, interest_overrides,
                  recommendation_feedback
  schemas.py      request/response models
  security.py     scrypt password hashing, JWT
  deps.py         DB session + current-user dependencies
  stays.py        noise filter + stay detection (port of the app's src/lib/stays)
  ml/             place ranker + interest model (types.py is the shared contract)
  places/         OSM categories, loader, spatial queries, visit resolution,
                  shared profile helpers, recommendation candidates
  routers/        auth, locations, visits, places, profile, recommendations, predict, export
scripts/
  load_osm.py     load an Overpass extract into the places table
tests/
```

## Place resolution & interests

`app/ml/` is a small, dependency-free package (standard library only) shared by
the API, the evaluation harness and the app. Nothing in it touches the database
or the network, so it can be tested and tuned in isolation.

- `types.py` — the shared dataclasses (`VisitFeatures`, `PlaceCandidate`,
  `ScoredCandidate`, `InterestWeight`) and the `CATEGORIES` tuple. Identical
  copy in three places by convention (see `README.md`); don't edit without
  telling the team.
- `opening_hours.py` — a small parser for the common OSM `opening_hours` subset
  (`24/7`, `off`, `Mo-Fr 07:00-22:00; Sa,Su 09:00-20:00`, comma day/time lists).
  Anything outside that subset resolves to `"unknown"` rather than raising.
- `places.py` — `rank_candidates(visit, candidates, revisit_counts, tz)` scores
  each candidate as a weighted sum of features and returns them best-first:
  - **Distance**: Gaussian log-likelihood decay (`DISTANCE_SIGMA_M`) around the
    visit centroid, with an extra flat `DISTANCE_PENALTY` past
    `DISTANCE_PENALTY_RADIUS_M` (30 m, per the proposal).
  - **Dwell fit**: how well the visit's duration matches a per-category typical
    range in `DWELL_MINUTES_BY_CATEGORY`; unlisted categories score neutral.
  - **Opening hours**: the visit midpoint is converted to local time
    (`zoneinfo.ZoneInfo(tz)`) and checked against `opening_hours.status_at`;
    open/closed give `HOURS_OPEN_BONUS`/`-HOURS_CLOSED_PENALTY`, unknown is
    neutral.
  - **Revisits**: `log1p(revisit_counts[place_id])`, weighted by `W_REVISIT`.
  - **Category prior**: a small penalty (`CATEGORY_PRIOR_PENALTY`) for
    `parking`, `fuel` and `other`, which are rarely the real destination.

  Confidence is a softmax over the candidates' scores plus a fixed
  `NONE_OF_THESE_SCORE` option, so a single low-scoring candidate still reads as
  low-confidence instead of winning by default. All the `W_*`, `*_SIGMA_M`,
  `*_PENALTY*` and `*_BONUS` names are module-level constants at the top of
  `places.py` — tune them there.
- `interests.py` — `build_interest_profile(visits, hidden, now_ts,
  half_life_days)` sums `sqrt(dwell_minutes) * 0.5 ** (age_days /
  half_life_days)` per category, drops `EXCLUDED_CATEGORIES` (parking, fuel,
  bank, office, lodging, other) entirely, and normalizes the non-hidden weights
  to sum to 1. Hidden categories stay in the output with `weight=0.0` so the UI
  can still list and un-hide them.

## Recommendations and prediction

Two more `app/ml/` models, both standard-library-only like the rest of the package,
and both built entirely from one user's own history:

- `recommend.py` — `recommend_places(interests, history, candidates, now_ts, limit, tz)`
  scores each unvisited, non-hidden candidate as a weighted sum:
  - **Interest match** (`W_INTEREST`): the candidate's category weight from the
    profile; a category missing from the profile scores `ABSENT_CATEGORY_INTEREST`
    (near zero) rather than being excluded.
  - **Category variety** (`W_VARIETY`): a penalty proportional to how much of the
    user's history is already that category, so a cafés-only history still
    surfaces non-café suggestions. This deliberately trades hit-rate for
    discovery — tune `W_VARIETY` against `W_INTEREST` once George's harness can
    measure that tradeoff on real data.
  - **Novelty** (`W_NOVELTY`): a bonus that grows with days since the category was
    last visited (capped at `NOVELTY_FULL_DAYS`), maxed out for a category never
    visited at all.
  - **Open now** (`W_OPEN`): reuses `opening_hours.status_at`; closed is a penalty,
    unknown is neutral.
  - **Popularity is deliberately not a feature.** There is no cross-user data to
    compute it from, and being different from a "everyone else goes here"
    baseline is the point of a personal interest model — see `evaluation/`.

  Scores are normalized to 0–1 within the returned list; `reason` is built from
  whichever feature contributed most to a candidate's score, using the phrase
  table in `REASON_TEMPLATES` (not scattered f-strings).

- `predict.py` — `predict_next_place(history, at_ts, top_k)` blends three
  signals, each normalized to a probability distribution over the places seen in
  `history` before blending: a **first-order Markov chain** over consecutive
  places (Laplace-smoothed, conditioned on the most recent place), a
  **time-of-day/day-of-week** habit match (2-hour buckets, weekday vs. weekend,
  `TZ`-local), and an **exponentially-decayed recency/frequency** count
  (`half_life_days`, default 30). The blend weights (`W_TRANSITION`, `W_TIME`,
  `W_RECENCY`) sum to `1 - NEW_PLACE_MASS`, leaving probability mass unclaimed for
  "somewhere not in the history at all." Fewer than `MIN_HISTORY_VISITS = 5`
  visits returns `[]` rather than a guess. No travel-time or calendar model, so a
  first visit to a new city is out of scope. `predict_next_place`'s signature has
  no `tz` parameter (fixed contract), so it uses the module constant `TZ` rather
  than the app's configured time zone.

## What's next

- Alembic migrations, then PostGIS `geography` columns + GiST indexes on points
  and places (`ST_DWithin` replaces the bounding-box prefilter in `places/queries.py`).
- Per-visit time zones for opening hours (and for `predict.py`'s fixed `TZ`).
- Rate limits on ingest and export.
