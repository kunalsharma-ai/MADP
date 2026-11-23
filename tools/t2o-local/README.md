# T2O local end-to-end check

This runs a copy of the real Turn2Opinion backend from the T2O repository and points MADP at it. It does not
contact www.turn2opinion.com or any production database.

The members are created through T2O's own sign-up, e-mail code, guardian approval and activation endpoints. MADP
then imports them through the same connector it will use in production. All accounts are test accounts: names start
with "MADP Test", and e-mails use the reserved `.test` domain. Nothing is ever sent, because a stub stands in for the
panel's mail services.

## What you need

- Node 26, plus Docker with the MADP `postgres` and `mongodb` services running.
- A clone of `kunalsharma-ai/turn2opinion`. Copy `Project/backend` somewhere outside the clone, so the clone stays
  untouched, then run `npm install` in the copy.
- These host names pointing to 127.0.0.1 in `/etc/hosts`: `t2o.localhost email email-template`. The backend calls
  its mailer at `http://email:3000` and `http://email-template:8080`.

## Steps

```bash
cd <backend copy>
# The repo ships empty placeholder *files* named app/logs and logs. The logger needs a directory app/logs.
mv app/logs app/logs.placeholder && mkdir app/logs

H=<madp>/tools/t2o-local
node $H/mail-stub.mjs &                                   # writes every e-mail to $H/outbox.jsonl
MONGODB_DRIVER=$PWD/node_modules/mongodb/lib/index.js \
  node $H/seed-bank.mjs <madp>/packages/testing/src/fixtures/t2o.source-sample.json \
  mongodb://localhost:27017/t2o_local t2o.localhost        # 50 sections, 848 questions, 16,847 options
JWT_SECRET=$(openssl rand -hex 32) LINK_SECRET=$(openssl rand -hex 32) TEEN_CRON_KEY=$(openssl rand -hex 16) \
  port=80 mongodb=mongodb://localhost:27017/t2o_local \
  node --require $H/dns-shim.cjs app/server.js &           # the sandbox has no DNS: answers MX lookups for .test only

cd $H
openssl rand -hex 8 | sed 's/^/Aa1!/' > test-password.txt
TEST_PW=$(cat test-password.txt) node signup-adults.mjs   # consumer (b2c) and business professional (b2b)
TEST_PW=$(cat test-password.txt) node signup-teens.mjs    # teen with guardian approval, teen still waiting
node answer.mjs                                           # each member answers profile questions through /me/profile
node make-expect.mjs

cd <madp>/apps/api
T2O_LOCAL_BASE_URL=http://t2o.localhost \
T2O_LOCAL_TOKEN=$(node -p "require('$H/tokens.json').consumer.token") \
T2O_LOCAL_EXPECT=$H/expect.json T2O_LOCAL_REPORT=$H/report.json \
  pnpm exec vitest run --project integration t2o-local
```

A full run takes about 12 minutes. The connector waits 250 ms between requests, and the bank has 848 option lists,
so each import spends about 3.5 minutes reading options.

## Teen sign-up needs one local change (T2O-BUG-01)

On a fresh database, the guardian's consent step fails with `E11000 duplicate key ... OTP index user_1_type_1_origin_1`.
The OTP model declares a unique index on `{user, type, origin}`, but the field is called `channel`, so `type` is
always null. That allows only one live code per member. When the guardian consents, the guardian's link code still
exists while the teen's activation code is being created, and the insert fails.

To finish the flow locally, drop that index after the backend starts:
`db.OTP.dropIndex("user_1_type_1_origin_1")`. Do not do this to a panel database. The fix belongs in the T2O repo.
