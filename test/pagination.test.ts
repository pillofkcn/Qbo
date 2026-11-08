import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  EmbedBuilder,
  MessageFlags,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { paginate } from "../src/lib/pagination.js";

interface Reply {
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  content?: string;
  flags?: number;
}

/** The smallest interaction paginate() accepts: editReply, and a message that hands out a collector. */
function fakeInteraction(ownerId = "owner") {
  const replies: Reply[] = [];
  const collector = new EventEmitter();
  let idle: number | undefined;
  const interaction = {
    user: { id: ownerId },
    editReply: async (reply: Reply) => {
      replies.push(reply);
      return {
        createMessageComponentCollector: (opts: { idle?: number }) => {
          idle = opts.idle;
          return collector;
        },
      };
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies, collector, idle: () => idle };
}

/** A button click from `userId`; resolves once paginate's async handler has run. */
async function click(collector: EventEmitter, userId: string, customId: string) {
  const updates: Reply[] = [];
  const replies: Reply[] = [];
  collector.emit("collect", {
    user: { id: userId },
    customId,
    update: async (r: Reply) => void updates.push(r),
    reply: async (r: Reply) => void replies.push(r),
  });
  await new Promise(setImmediate);
  return { updates, replies };
}

/** Page label and which nav buttons are disabled, read from the real discord.js builders. */
function nav(reply: Reply) {
  const buttons = reply.components?.[0]?.toJSON().components ?? [];
  const byId = new Map(buttons.map((b) => ["custom_id" in b ? b.custom_id : "", b]));
  const navIds = ["page:first", "page:prev", "page:next", "page:last"];
  const indicator = byId.get("page:indicator");
  return {
    label: indicator && "label" in indicator ? indicator.label : undefined,
    disabled: navIds.filter((id) => byId.get(id)?.disabled).map((id) => id.slice(5)),
  };
}

const makePages = (n: number) => Array.from({ length: n }, (_, i) => new EmbedBuilder().setTitle(`page ${i + 1}`));

describe("paginate", () => {
  it("does nothing for no pages", async () => {
    const f = fakeInteraction();
    await paginate(f.interaction, []);
    assert.equal(f.replies.length, 0);
  });

  it("shows a single page without buttons or a collector", async () => {
    const f = fakeInteraction();
    const pages = makePages(1);
    await paginate(f.interaction, pages);
    assert.equal(f.replies.length, 1);
    assert.deepEqual(f.replies[0].embeds, [pages[0]]);
    assert.equal(f.replies[0].components, undefined);
    assert.equal(f.idle(), undefined);
  });

  it("opens on page 1 with back buttons disabled", async () => {
    const f = fakeInteraction();
    const pages = makePages(3);
    await paginate(f.interaction, pages);
    assert.deepEqual(f.replies[0].embeds, [pages[0]]);
    assert.deepEqual(nav(f.replies[0]), { label: "1/3", disabled: ["first", "prev"] });
  });

  it("stops listening after 2 idle minutes unless told otherwise", async () => {
    const a = fakeInteraction();
    await paginate(a.interaction, makePages(2));
    assert.equal(a.idle(), 120_000);
    const b = fakeInteraction();
    await paginate(b.interaction, makePages(2), { idleMs: 5_000 });
    assert.equal(b.idle(), 5_000);
  });

  it("moves forward and stays on the last page", async () => {
    const f = fakeInteraction();
    const pages = makePages(3);
    await paginate(f.interaction, pages);

    const next = await click(f.collector, "owner", "page:next");
    assert.deepEqual(next.updates[0].embeds, [pages[1]]);
    assert.deepEqual(nav(next.updates[0]), { label: "2/3", disabled: [] });

    const last = await click(f.collector, "owner", "page:last");
    assert.deepEqual(last.updates[0].embeds, [pages[2]]);
    assert.deepEqual(nav(last.updates[0]), { label: "3/3", disabled: ["next", "last"] });

    const beyond = await click(f.collector, "owner", "page:next");
    assert.deepEqual(beyond.updates[0].embeds, [pages[2]]);
  });

  it("moves back and stays on the first page", async () => {
    const f = fakeInteraction();
    const pages = makePages(3);
    await paginate(f.interaction, pages);

    const before = await click(f.collector, "owner", "page:prev");
    assert.deepEqual(before.updates[0].embeds, [pages[0]]);

    await click(f.collector, "owner", "page:last");
    const prev = await click(f.collector, "owner", "page:prev");
    assert.deepEqual(prev.updates[0].embeds, [pages[1]]);
    const first = await click(f.collector, "owner", "page:first");
    assert.deepEqual(first.updates[0].embeds, [pages[0]]);
    assert.deepEqual(nav(first.updates[0]), { label: "1/3", disabled: ["first", "prev"] });
  });

  it("does not let another user turn the pages", async () => {
    const f = fakeInteraction("owner");
    const pages = makePages(3);
    await paginate(f.interaction, pages);

    for (const id of ["page:next", "page:last"]) {
      const intruder = await click(f.collector, "someone-else", id);
      assert.equal(intruder.updates.length, 0, `${id} must not update the message`);
      assert.deepEqual(intruder.replies, [
        { content: "These buttons aren't for you.", flags: MessageFlags.Ephemeral },
      ]);
    }

    // The owner's next click still goes from page 1 to page 2.
    const owner = await click(f.collector, "owner", "page:next");
    assert.deepEqual(owner.updates[0].embeds, [pages[1]]);
  });

  it("disables every button on the current page when the collector ends", async () => {
    const f = fakeInteraction();
    await paginate(f.interaction, makePages(3));
    await click(f.collector, "owner", "page:next");

    f.collector.emit("end");
    await new Promise(setImmediate);

    const final = f.replies.at(-1)!;
    assert.equal(final.embeds, undefined); // the page stays as it is
    assert.deepEqual(nav(final), { label: "2/3", disabled: ["first", "prev", "next", "last"] });
  });
});
