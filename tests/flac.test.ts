import { FLAC } from "../mod.ts";
import { VorbisComment } from "../src/flac/blocks.ts";
import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test("FLAC", async () => {
  const flac = await FLAC.open("./tests/test.flac");

  for (const block of flac.metadata) {
    try {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      assertEquals(block.write(), block.rawData);
    } catch (e) {
      // VorbisComment creates different binary because of comment key case insensitivity
      if (!(block instanceof VorbisComment)) {
        throw e;
      } else {
        const clone = new VorbisComment(block.write());
        assertEquals(clone.vendorText, block.vendorText);
        assertEquals(clone.tags, block.tags);
      }
    }
  }

  flac.close();
});
