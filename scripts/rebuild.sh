#!/bin/sh
# Local, project-owned PostgreSQL. No changes to a user's default server or database.
set -eu
cd "$(dirname "$0")/.."
root="$(pwd -P)"
build="$root/.build"
port=55432
mkdir -p "$build"
chmod 700 "$build"
mkdir "$build/rebuild.lock" || { echo 'A rebuild is already running. Inspect .build/rebuild.lock if stale.' >&2; exit 1; }

cluster_started=false
cleanup() {
    if [ "$cluster_started" = true ]; then
        pg_ctl -D "$build/pg" -m fast -w stop
    fi
    rmdir "$build/rebuild.lock"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
for dependency in python3 psql initdb pg_ctl; do
    command -v "$dependency" >/dev/null || { echo "Missing dependency $dependency" >&2; exit 1; }
done

python3 scripts/workbook.py
if [ ! -f "$build/pg/PG_VERSION" ]; then
    initdb -D "$build/pg" --auth=trust --no-locale --encoding=UTF8
fi
if ! pg_ctl -D "$build/pg" status >/dev/null; then
    pg_ctl -D "$build/pg" -l "$build/postgres.log" -o "-c listen_addresses='' -k '$build' -p $port" -w start
    cluster_started=true
fi

mkdir -p "$build/export"
# -X ignores user psql startup files. One failed validation rolls back the schema.
psql -X -h "$build" -p "$port" -d postgres --single-transaction -v ON_ERROR_STOP=1 -q \
    -f sql/01_raw.sql -f sql/02_model.sql -f sql/03_quality.sql -f sql/04_sales.sql \
    -f sql/05_cohorts.sql -f sql/06_linkage.sql -f sql/07_validate.sql -f sql/08_export.sql
python3 scripts/verify_and_publish.py
