#!/usr/bin/env bash
# Backup and restore drill: dumps a Postgres database and a MongoDB database, restores both into fresh copies, and
# compares row and document counts table by table. Run it against a test or staging copy; never against production
# without the owner's approval. Needs pg_dump, pg_restore, psql, mongodump and mongorestore (or the docker
# containers named below).
#
# Usage: ops/backup/restore-drill.sh <postgres-db> <mongo-db>
set -euo pipefail
SRC_PG=${1:?postgres database}
SRC_MONGO=${2:?mongo database}
PG_CONTAINER=${PG_CONTAINER:-madp-pg}
MONGO_CONTAINER=${MONGO_CONTAINER:-madp-mongo}
PG_USER=${PG_USER:-madp}
STAMP=$(date -u +%Y%m%d%H%M%S)
DST="${SRC_PG}_restore_${STAMP}"
pgx() { docker exec -i "$PG_CONTAINER" "$@"; }
mgx() { docker exec -i "$MONGO_CONTAINER" "$@"; }

echo "1. Dump Postgres $SRC_PG"
t0=$(date +%s)
pgx pg_dump -U "$PG_USER" -Fc "$SRC_PG" > "/tmp/$DST.pgdump"
echo "   $(du -h "/tmp/$DST.pgdump" | cut -f1) in $(( $(date +%s) - t0 )) s"

echo "2. Dump MongoDB $SRC_MONGO"
t0=$(date +%s)
mgx mongodump --quiet --db "$SRC_MONGO" --archive --gzip > "/tmp/$DST.mongo.gz"
echo "   $(du -h "/tmp/$DST.mongo.gz" | cut -f1) in $(( $(date +%s) - t0 )) s"

echo "3. Restore into $DST (both stores)"
t0=$(date +%s)
pgx psql -U "$PG_USER" -d postgres -qc "create database $DST"
pgx pg_restore -U "$PG_USER" -d "$DST" --no-owner < "/tmp/$DST.pgdump"
mgx mongorestore --quiet --archive --gzip --nsFrom "$SRC_MONGO.*" --nsTo "$DST.*" < "/tmp/$DST.mongo.gz"
echo "   restored in $(( $(date +%s) - t0 )) s"

echo "4. Compare counts"
count_sql="select string_agg(format('%s=%s', table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', table_name), false, true, '')))[1]::text), ',' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
a=$(pgx psql -U "$PG_USER" -d "$SRC_PG" -Atc "$count_sql")
b=$(pgx psql -U "$PG_USER" -d "$DST" -Atc "$count_sql")
mongo_counts='db.getCollectionNames().sort().map(c => c + "=" + db.getCollection(c).countDocuments()).join(",")'
ma=$(mgx mongosh --quiet "$SRC_MONGO" --eval "$mongo_counts")
mb=$(mgx mongosh --quiet "$DST" --eval "$mongo_counts")
tables=$(tr ',' '\n' <<<"$a" | wc -l)
colls=$(tr ',' '\n' <<<"$ma" | wc -l)
chain=$(pgx psql -U "$PG_USER" -d "$DST" -Atc "select count(*) from audit_event")
status=0
[[ "$a" == "$b" ]] && echo "   Postgres: $tables tables match" || { echo "   Postgres MISMATCH"; diff <(tr ',' '\n' <<<"$a") <(tr ',' '\n' <<<"$b") || true; status=1; }
[[ "$ma" == "$mb" ]] && echo "   MongoDB: $colls collections match" || { echo "   MongoDB MISMATCH"; status=1; }
echo "   audit_event rows in the copy: $chain (verify the hash chain with GET /audit/verify against the copy)"

echo "5. Clean up"
pgx psql -U "$PG_USER" -d postgres -qc "drop database $DST"
mgx mongosh --quiet "$DST" --eval 'db.dropDatabase()' > /dev/null
rm -f "/tmp/$DST.pgdump" "/tmp/$DST.mongo.gz"
[[ $status == 0 ]] && echo "Drill passed." || echo "Drill FAILED."
exit $status
