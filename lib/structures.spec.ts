import assert from "node:assert";
import { describe, it } from "mocha";
import { compileAndCompare } from "ya-struct";
import { hostAbi } from "po6";
import { createTuntapStructuresFor, hostStructures, ifreqDefinition } from "./structures.ts";
import { compileAndRun } from "./test-support/compile-and-run.ts";

describe("structures", () => {
  it("should match struct ifreq of the C headers", async () => {
    const { layoutErrors } = await compileAndCompare({
      structDefinition: ifreqDefinition,
      abi: hostAbi,
      globalCode: "#include <linux/if.h>",
      cStructName: "ifreq",
      compileAndRun,
    });

    assert.deepStrictEqual(layoutErrors, []);
  });

  it("should match the size of struct ifreq for 32 bit ABIs", () => {
    const structures = createTuntapStructuresFor({ abi: { endianness: "little", dataModel: "ILP32", compiler: "gcc" } });

    assert.strictEqual(structures.ifreq.size, 32);
    assert.strictEqual(hostStructures.ifreq.size, 40);
  });

  it("should round trip name and flags", () => {
    const value = { ifr_name: "tap%d", ifr_ifru: { ifru_flags: 0x1002n } };
    const data = hostStructures.ifreq.format({ value });

    assert.deepStrictEqual(hostStructures.ifreq.parse({ data }), value);
  });
});
