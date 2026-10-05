import assert from "node:assert";
import { describe, it } from "mocha";
import * as constants from "./constants.ts";
import { compileAndRun } from "./test-support/compile-and-run.ts";

const valuesFromCHeaders = async ({ names }: { names: string[] }) => {
  const sourceCode = `#include <stdio.h>
#include <sys/ioctl.h>
#include <linux/if.h>
#include <linux/if_tun.h>

int main(void) {
${names.map((name) => {
    return `  printf("${name} %lld\\n", (long long) ${name});`;
  }).join("\n")}
  return 0;
}
`;

  const { output } = await compileAndRun({ sourceCode });

  return output.trim().split("\n").map((line) => {
    const [name, value] = line.split(" ");
    return { name, value: BigInt(value) };
  });
};

describe("constants", () => {
  it("should match the values of the C headers", async () => {
    const names = Object.keys(constants);
    const valuesFromC = await valuesFromCHeaders({ names });

    assert.strictEqual(valuesFromC.length, names.length);

    valuesFromC.forEach(({ name, value }) => {
      assert.strictEqual(constants[name as keyof typeof constants], value, `${name} differs from the C headers`);
    });
  });
});
