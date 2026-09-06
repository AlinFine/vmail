import assert from "node:assert/strict";
import test from "node:test";
import { makeMailboxPermanent, setMailboxPassword } from "./database/dao.ts";

function createUpdateDb(changes: number) {
  let values: Record<string, unknown> | undefined;
  const db = {
    update() {
      return {
        set(nextValues: Record<string, unknown>) {
          values = nextValues;
          return {
            where() {
              return {
                async execute() {
                  return { meta: { changes } };
                },
              };
            },
          };
        },
      };
    },
  };

  return { db: db as any, getValues: () => values };
}

test("mailbox password updates use the D1 meta.changes result", async () => {
  const updated = createUpdateDb(1);
  const missing = createUpdateDb(0);

  assert.equal(
    await setMailboxPassword(updated.db, "USER@EXAMPLE.COM", "hash", "salt"),
    true,
  );
  assert.equal(
    await setMailboxPassword(missing.db, "USER@EXAMPLE.COM", "hash", "salt"),
    false,
  );
});

test("saving a fixed mailbox password upgrades legacy mailbox records", async () => {
  const update = createUpdateDb(1);

  assert.equal(
    await makeMailboxPermanent(update.db, "user@example.com", "hash", "salt"),
    true,
  );
  assert.deepEqual(
    {
      isPermanent: update.getValues()?.isPermanent,
      expiresAt: update.getValues()?.expiresAt,
      passwordHash: update.getValues()?.passwordHash,
      passwordSalt: update.getValues()?.passwordSalt,
    },
    {
      isPermanent: true,
      expiresAt: null,
      passwordHash: "hash",
      passwordSalt: "salt",
    },
  );
});
