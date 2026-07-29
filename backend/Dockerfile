# RR-11: two stages. `runtime` is what CI's build-and-push ships (it passes
# `target: runtime` explicitly — never rely on "last stage wins"); `dev` layers
# test/lint tooling on top for docker compose, so `docker compose exec backend
# pytest` keeps working without dev deps ever reaching production.
FROM python:3.12-slim AS runtime

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user: a compromised app process holds an unprivileged account
# instead of container root. Created after installs (pip needs root), before
# CMD (nothing at runtime writes to the image filesystem).
RUN useradd --create-home appuser
USER appuser

# ADR-0011: migrations are no longer run on container start (that raced
# concurrent cold starts under max_instance_count > 1, and a bad migration
# took down the serving path instead of failing a deploy step). `alembic
# upgrade head` now runs once per deploy as a discrete Cloud Run Job
# (terraform/modules/app/migrate_job.tf), executed by CI before the new
# revision here takes traffic. Local `docker compose` still auto-migrates —
# see docker-compose.yml's `command:` override on the `backend` service.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS dev

USER root
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
USER appuser
