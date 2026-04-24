# REOS → Cloud Run deployment runbook

Target end state:
- Image: `us-central1-docker.pkg.dev/<PROJECT>/reos/reos:<sha>`
- Service: `reos` in `us-central1`, allow-unauthenticated
- Secrets: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_ALLOWED_EMAILS`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OPENAI_API_KEY`, `ENCRYPTION_KEY`
- Postgres: Cloud SQL (db-f1-micro) or Neon free tier — pick one
- Custom domain: `reos.titanreteam.com` via Cloud Run domain mapping + CNAME at GoDaddy
- Crons: Cloud Scheduler → OIDC → Cloud Run endpoints

Everything below is one-time setup except the `gcloud builds submit`
step — that's the deploy loop.

---

## 0. Prereqs on your machine

```bash
# Install the gcloud CLI if you haven't:
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Log in, pick / create a project
gcloud auth login
gcloud projects create reos-titanre --name="REOS"
gcloud config set project reos-titanre
gcloud config set compute/region us-central1

# Link billing (required for Cloud Run). You'll be prompted in a
# browser. If you know your billing account id:
gcloud billing accounts list
gcloud billing projects link reos-titanre \
  --billing-account=<BILLING_ACCOUNT_ID>

# Enable the APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  cloudscheduler.googleapis.com
```

---

## 1. Artifact Registry (image host)

```bash
gcloud artifacts repositories create reos \
  --repository-format=docker \
  --location=us-central1 \
  --description="REOS container images"
```

---

## 2. Postgres — pick ONE

### Option A: Cloud SQL (Google-managed, ~$10/mo on db-f1-micro)

```bash
gcloud sql instances create reos-pg \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --tier=db-f1-micro \
  --storage-size=10 \
  --storage-auto-increase

# Set a strong password for the built-in `postgres` user
gcloud sql users set-password postgres \
  --instance=reos-pg \
  --password='<PICK-SOMETHING-LONG>'

gcloud sql databases create real_estate_os --instance=reos-pg

# Get the connection name — you'll need it for DATABASE_URL and
# Cloud Run's --add-cloudsql-instances flag later.
gcloud sql instances describe reos-pg --format='value(connectionName)'
# -> reos-titanre:us-central1:reos-pg
```

Connection string for Cloud Run (uses the Unix socket that Cloud Run
mounts automatically when `--add-cloudsql-instances` is set):

```
postgresql://postgres:<PASSWORD>@localhost/real_estate_os?host=/cloudsql/reos-titanre:us-central1:reos-pg&sslmode=disable
```

### Option B: Neon (free tier, faster to stand up)

Sign up at https://neon.tech, create a project called `reos`. Copy
the pooled connection string it hands you — it already includes
`sslmode=require`. You don't need the Cloud SQL flags below.

---

## 3. Seed Secret Manager

Put every env var REOS needs at runtime into Secret Manager. Start
from your local `.env` values (everything except `NEXT_PUBLIC_*`
which gets baked into the client bundle at build time and doesn't
need to be a secret).

```bash
add_secret() {
  local name=$1
  local value=$2
  echo -n "$value" | gcloud secrets create "$name" \
    --data-file=- --replication-policy=automatic 2>/dev/null \
  || echo -n "$value" | gcloud secrets versions add "$name" --data-file=-
}

# Pick a fresh random value for the prod AUTH_SECRET — do NOT reuse
# your dev one.
add_secret AUTH_SECRET "$(openssl rand -base64 32)"
add_secret AUTH_ALLOWED_EMAILS "jp@titanreteam.com,elkcitytc@gmail.com"

# Existing Google OAuth client (same one that runs Gmail today)
add_secret GOOGLE_CLIENT_ID "<from .env>"
add_secret GOOGLE_CLIENT_SECRET "<from .env>"
# NextAuth reuses the same client; same values.
add_secret AUTH_GOOGLE_ID "<GOOGLE_CLIENT_ID>"
add_secret AUTH_GOOGLE_SECRET "<GOOGLE_CLIENT_SECRET>"
# The Gmail OAuth callback — this is the one already added
# to the OAuth client for the Gmail integration.
add_secret GOOGLE_REDIRECT_URI "https://reos.titanreteam.com/api/auth/google/callback"

add_secret OPENAI_API_KEY "<from .env>"
add_secret ENCRYPTION_KEY "<from .env>"
add_secret DATABASE_URL "<connection string from step 2>"

# Owner's additional email aliases — excluded from SmartFolder
# queries so the Gmail filter doesn't over-match on the owner's
# own mailbox. Copy from local .env.
add_secret OWNER_EMAIL_ALIASES "james.fluellen@gmail.com,tc@titanreteam.com,wybroker@therealbrokerage.com"

# Shared secret for Cloud Scheduler → REOS automation endpoints
# (post-close sweep, scan-accepted-contracts, etc.). Generate fresh
# for prod — don't reuse the local dev value.
add_secret SCAN_SCHEDULE_SECRET "$(openssl rand -hex 32)"

# Public app URL — used in the intake form (/intake), share links,
# NEXT_PUBLIC_APP_URL for any client-side base-URL needs.
add_secret NEXT_PUBLIC_APP_URL "https://reos.titanreteam.com"
```

Give the Cloud Run default service account read access to secrets:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) \
  --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"

# If you picked Cloud SQL, also grant the SQL client role:
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudsql.client"
```

---

## 4. First build + deploy

From the repo root:

```bash
gcloud builds submit --config cloudbuild.yaml
```

What this does:
1. Builds the Docker image (reads `Dockerfile`)
2. Pushes it to Artifact Registry tagged with the commit SHA
3. Deploys to Cloud Run with every secret wired in

First time only — if you're on Cloud SQL, edit the service to add
the SQL proxy after the first deploy succeeds:

```bash
gcloud run services update reos \
  --region=us-central1 \
  --add-cloudsql-instances=reos-titanre:us-central1:reos-pg
```

---

## 5. Run migrations against prod DB

Option A: one-shot local run with the prod connection string in your
shell (easiest for single-owner ops):

```bash
# If Cloud SQL, run the proxy in another terminal first:
# cloud-sql-proxy reos-titanre:us-central1:reos-pg

DATABASE_URL="<prod connection string>" npx prisma db push
```

Option B: add a separate "migrate" Cloud Run job you fire before
each deploy. Defer until you have real migrations running instead
of `db push`.

---

## 6. Custom domain

Grab the default Cloud Run URL:

```bash
gcloud run services describe reos --region=us-central1 \
  --format='value(status.url)'
# -> https://reos-<hash>-uc.a.run.app
```

Map your subdomain:

```bash
gcloud run domain-mappings create \
  --service=reos \
  --domain=reos.titanreteam.com \
  --region=us-central1
```

It will hand you a CNAME record (or multiple A/AAAA records if the
apex). Add that at GoDaddy:

- Type: CNAME (from Google's output)
- Host: `reos`
- Points to: `ghs.googlehosted.com` (whatever Google prints)
- TTL: 1 hour

Once DNS propagates (usually 5-30 minutes), Google auto-provisions
a managed TLS cert. Once the cert lands:

---

## 7. Update the Google OAuth client

In Google Cloud Console → APIs & Services → Credentials → your
existing OAuth 2.0 Client, add under "Authorized redirect URIs":

- `https://reos.titanreteam.com/api/auth/callback/google`   ← NextAuth
- `https://reos.titanreteam.com/api/auth/google/callback`   ← the Gmail integration (already there for local, add for prod)

And under "Authorized JavaScript origins":
- `https://reos.titanreteam.com`

---

## 8. Cloud Scheduler for crons

REOS has several "scan" endpoints that need to run on a schedule.
For each one, create a scheduler job that POSTs with an OIDC token
so Cloud Run can verify it's Google calling:

```bash
# Grant Cloud Scheduler's service account the ability to invoke the
# service (one time)
gcloud run services add-iam-policy-binding reos \
  --region=us-central1 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"

# Example: nightly scan for accepted contracts
gcloud scheduler jobs create http reos-scan-contracts \
  --schedule="0 6 * * *" \
  --time-zone="America/Denver" \
  --uri="https://reos.titanreteam.com/api/automation/scan-accepted-contracts" \
  --http-method=POST \
  --oidc-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --oidc-token-audience="https://reos.titanreteam.com"

# Daily post-close sweep: 7am Mountain. Uses the shared-secret header
# (SCAN_SCHEDULE_SECRET) rather than OIDC because the route is in
# the public middleware allowlist (/api/automation/*/tick) and
# validates the header inside the handler.
gcloud scheduler jobs create http reos-post-close-sweep \
  --schedule="0 7 * * *" \
  --time-zone="America/Denver" \
  --uri="https://reos.titanreteam.com/api/automation/post-close/tick" \
  --http-method=POST \
  --headers="x-reos-scan-secret=<SCAN_SCHEDULE_SECRET>"
```

Add one job per scan endpoint (earnest-money, title-orders,
stale-contacts, etc). Post-close tick fires daily to create the
review-request / gift / NPS / compliance-file tasks on closed deals.

---

## 9. Deploy loop

After the first deploy, every subsequent deploy is:

```bash
git push                                    # optional: commit first
gcloud builds submit --config cloudbuild.yaml
```

Cloud Build tags the image with the commit SHA, so you can roll
back with:

```bash
gcloud run services update reos \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/reos/reos:<previous-sha>
```

---

## 10. Smoke test checklist

After the first deploy lands on `reos.titanreteam.com`:

- [ ] `GET /api/health` returns `{status:"ok", db:"ok"}`
- [ ] `GET /` redirects to `/login`
- [ ] Sign in as `jp@titanreteam.com` — you land on `/`
- [ ] Sign in as `elkcitytc@gmail.com` — Vicki lands on `/`
- [ ] Sign in as any other Google account — AccessDenied error
- [ ] `/settings/team` lists both users
- [ ] Gmail OAuth still works (Sources tab → reconnect)
- [ ] A scan endpoint run manually creates a row in the DB
- [ ] Cron fires and pings the service (check Cloud Run logs)
