import assert from "node:assert";
import child_process from "node:child_process";
import path from "node:path";
import { describe, it } from "mocha";
import { createTuntapDevice, TUNSETIFF } from "./index.ts";

// creating devices needs CAP_NET_ADMIN, a fresh network namespace keeps the host untouched
const canRunInNetworkNamespace = () => {
  const { status } = child_process.spawnSync("sudo", ["-n", "unshare", "-n", "test", "-c", "/dev/net/tun"], { stdio: "ignore" });
  return status === 0;
};

const itInNetworkNamespace = canRunInNetworkNamespace() ? it : it.skip;

describe("tuntap2", () => {
  it("should export the API", () => {
    assert.strictEqual(typeof createTuntapDevice, "function");
    assert.strictEqual(TUNSETIFF, 0x4004_54CAn);
  });

  itInNetworkNamespace("should create TUN and TAP devices on the host kernel", () => {
    const script = path.join(import.meta.dirname, "test-support", "device-lifecycle.ts");
    const output = child_process.execFileSync("sudo", ["-n", "unshare", "-n", process.execPath, script], {
      encoding: "utf-8",
      timeout: 60_000,
    });
    const result = JSON.parse(output);

    assert.deepStrictEqual(result.tap, {
      name: "nt-tap0",
      opened: { name: "nt-tap0", ifindex: result.tap.opened.ifindex },
      up: true,
      kind: "tun",
    });
    assert.ok(result.packetLength >= 14, "expected an Ethernet frame from the kernel");

    assert.deepStrictEqual(result.tun, {
      name: "nt-tun0",
      opened: { name: "nt-tun0", ifindex: result.tun.opened.ifindex },
      up: true,
      pointToPoint: true,
    });

    assert.ok(result.namesWhileOpen.includes("nt-tap0") && result.namesWhileOpen.includes("nt-tun0"));
    assert.deepStrictEqual(result.namesAfterClose, ["lo"]);
  });
});
