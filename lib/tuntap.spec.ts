import assert from "node:assert";
import { describe, it } from "mocha";
import { IFF_NO_PI, IFF_TAP, IFF_TUN, TUNSETIFF } from "./constants.ts";
import { hostStructures } from "./structures.ts";
import { createFakeLinkApi, createFakePo6, createFakePoller } from "./test-support/fakes.ts";
import { createTuntapDevice, type TCreateTuntapDeviceArgs } from "./tuntap.ts";

const flushPromises = async () => {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};

const createTestSetup = ({ args = {}, linkApi = createFakeLinkApi() }: {
  args?: Partial<TCreateTuntapDeviceArgs>,
  linkApi?: ReturnType<typeof createFakeLinkApi>,
} = {}) => {
  const fakePo6 = createFakePo6();
  const fakePoller = createFakePoller();

  let opened: { name: string, ifindex: number }[] = [];
  let packets: Uint8Array[] = [];
  let errors: Error[] = [];

  const create = () => {
    return createTuntapDevice({
      type: "tap",
      onOpen: (info) => {
        opened = [...opened, info];
      },
      onPacket: ({ packet }) => {
        packets = [...packets, packet];
      },
      onError: ({ error }) => {
        errors = [...errors, error];
      },
      po6: fakePo6.po6,
      kernelAbi: fakePo6.kernelAbi,
      createPoller: fakePoller.createPoller,
      link: linkApi.link,
      ...args,
    });
  };

  const ifreqOfSetup = () => {
    const [{ args: [ifreq] }] = fakePo6.callsOf({ name: "ioctl" }) as { args: Uint8Array[] }[];
    return hostStructures.ifreq.parse({ data: ifreq });
  };

  return {
    fakePo6,
    fakePoller,
    linkApi,
    create,
    ifreqOfSetup,
    opened: () => {
      return opened;
    },
    packets: () => {
      return packets.map((packet) => {
        return [...packet];
      });
    },
    errors: () => {
      return errors;
    },
  };
};

describe("tuntap device", () => {
  describe("creation", () => {
    it("should open /dev/net/tun non-blocking", () => {
      const { fakePo6, create } = createTestSetup();
      create();

      const { O_RDWR, O_NONBLOCK, O_CLOEXEC } = fakePo6.kernelAbi.constants;
      assert.deepStrictEqual(fakePo6.callsOf({ name: "open" }), [{ pathname: "/dev/net/tun", flags: O_RDWR | O_NONBLOCK | O_CLOEXEC }]);
    });

    it("should create a tap device without packet information", () => {
      const { fakePo6, create, ifreqOfSetup } = createTestSetup();
      const device = create();

      const [{ fd, request }] = fakePo6.callsOf({ name: "ioctl" });
      assert.strictEqual(fd, fakePo6.fd);
      assert.strictEqual(request, TUNSETIFF);
      assert.deepStrictEqual(ifreqOfSetup(), { ifr_name: "", ifr_ifru: { ifru_flags: IFF_TAP | IFF_NO_PI } });
      assert.strictEqual(device.name, "tap0");
    });

    it("should create a tun device", () => {
      const { create, ifreqOfSetup } = createTestSetup({ args: { type: "tun" } });
      const device = create();

      assert.strictEqual(ifreqOfSetup().ifr_ifru.ifru_flags, IFF_TUN | IFF_NO_PI);
      assert.strictEqual(device.name, "tun0");
    });

    it("should request packet information", () => {
      const { create, ifreqOfSetup } = createTestSetup({ args: { packetInformation: true } });
      create();

      assert.strictEqual(ifreqOfSetup().ifr_ifru.ifru_flags, IFF_TAP);
    });

    it("should use the requested name", () => {
      const { create, ifreqOfSetup } = createTestSetup({ args: { name: "vm%d" } });
      const device = create();

      assert.strictEqual(ifreqOfSetup().ifr_name, "vm%d");
      assert.strictEqual(device.name, "vm0");
    });

    it("should reject names that are too long", () => {
      const { fakePo6, create } = createTestSetup({ args: { name: "a-very-long-name" } });

      assert.throws(() => {
        create();
      }, /interface name "a-very-long-name" is too long, at most 15 bytes are allowed/);
      assert.deepStrictEqual(fakePo6.callsOf({ name: "open" }), []);
    });

    it("should throw if /dev/net/tun cannot be opened", () => {
      const { fakePo6, create } = createTestSetup();
      fakePo6.failNext({ name: "open", errno: fakePo6.kernelAbi.errnoCodes.ENOENT });

      assert.throws(() => {
        create();
      }, /open\("\/dev\/net\/tun"\) failed with ENOENT/);
    });

    it("should close the device and throw if TUNSETIFF fails", () => {
      const { fakePo6, create } = createTestSetup();
      fakePo6.failNext({ name: "ioctl", errno: fakePo6.kernelAbi.errnoCodes.EPERM });

      assert.throws(() => {
        create();
      }, /ioctl\(TUNSETIFF\) failed with EPERM/);
      assert.deepStrictEqual(fakePo6.callsOf({ name: "close" }), [{ fd: fakePo6.fd }]);
    });

    it("should wait for packets", () => {
      const { fakePo6, fakePoller, create } = createTestSetup();
      create();

      assert.strictEqual(fakePoller.fdOfPoller(), fakePo6.fd);
      assert.strictEqual(fakePoller.isArmed(), true);
    });
  });

  describe("opening", () => {
    it("should bring the interface up and call onOpen", async () => {
      const { linkApi, create, opened } = createTestSetup();
      create();

      assert.deepStrictEqual(opened(), []);
      await flushPromises();

      assert.deepStrictEqual(linkApi.modifications(), [{ name: "tap0", flags: { IFF_UP: true } }]);
      assert.deepStrictEqual(opened(), [{ name: "tap0", ifindex: 5 }]);
    });

    it("should not call onOpen once the device is closed", async () => {
      const { create, opened } = createTestSetup();
      create().close();

      await flushPromises();

      assert.deepStrictEqual(opened(), []);
    });

    it("should work without onOpen", async () => {
      const { linkApi, create } = createTestSetup({ args: { onOpen: undefined } });
      create();

      await flushPromises();

      assert.strictEqual(linkApi.modifications().length, 1);
    });

    it("should report errors while bringing the interface up", async () => {
      const cause = Error("no such link");
      const { create, errors, opened } = createTestSetup({ linkApi: createFakeLinkApi({ failWith: cause }) });
      create();

      await flushPromises();

      assert.strictEqual(errors()[0].message, "failed to bring up interface tap0");
      assert.strictEqual(errors()[0].cause, cause);
      assert.deepStrictEqual(opened(), []);
    });

    it("should not report errors while bringing the interface up once the device is closed", async () => {
      const { create, errors } = createTestSetup({ linkApi: createFakeLinkApi({ failWith: Error("no such link") }) });
      create().close();

      await flushPromises();

      assert.deepStrictEqual(errors(), []);
    });
  });

  describe("receiving", () => {
    it("should read all queued packets and wait for more", () => {
      const { fakePo6, fakePoller, create, packets } = createTestSetup();
      create();

      fakePo6.queueIncoming({ packet: Uint8Array.from([1, 2, 3]) });
      fakePo6.queueIncoming({ packet: Uint8Array.from([4]) });
      fakePoller.triggerReadable();

      assert.deepStrictEqual(packets(), [[1, 2, 3], [4]]);
      assert.strictEqual(fakePoller.isArmed(), true);
    });

    it("should read into a buffer large enough for GSO packets", () => {
      const { fakePo6, fakePoller, create } = createTestSetup();
      create();

      fakePoller.triggerReadable();

      const [{ buffer }] = fakePo6.callsOf({ name: "read" }) as { buffer: Uint8Array }[];
      assert.ok(buffer.length > 65_536);
    });

    it("should drop packets without onPacket", () => {
      const { fakePo6, fakePoller, create } = createTestSetup({ args: { onPacket: undefined } });
      create();

      fakePo6.queueIncoming({ packet: Uint8Array.from([1]) });
      fakePoller.triggerReadable();

      assert.strictEqual(fakePo6.callsOf({ name: "read" }).length, 2);
      assert.strictEqual(fakePoller.isArmed(), true);
    });

    it("should report read errors and keep waiting", () => {
      const { fakePo6, fakePoller, create, errors } = createTestSetup();
      create();

      fakePo6.queueIncoming({ packet: { errno: fakePo6.kernelAbi.errnoCodes.EIO } });
      fakePoller.triggerReadable();

      assert.match(errors()[0].message, /read\(\) failed with EIO/);
      assert.strictEqual(fakePoller.isArmed(), true);
    });

    it("should report poll errors", () => {
      const { fakePoller, create, errors } = createTestSetup();
      create();

      fakePoller.triggerError({ errorCode: -9 });

      assert.deepStrictEqual(errors().map((error) => {
        return error.message;
      }), ["polling /dev/net/tun failed with libuv error -9"]);
    });

    it("should throw errors asynchronously without onError", async () => {
      const { fakePoller, create } = createTestSetup({ args: { onError: undefined } });
      create();

      const listeners = process.listeners("uncaughtException");
      process.removeAllListeners("uncaughtException");

      try {
        const thrown = await new Promise<Error>((resolve) => {
          process.once("uncaughtException", resolve);
          fakePoller.triggerError({ errorCode: -9 });
        });

        assert.match(thrown.message, /libuv error -9/);
      } finally {
        listeners.forEach((listener) => {
          process.on("uncaughtException", listener);
        });
      }
    });
  });

  describe("pause and resume", () => {
    it("should stop waiting for packets while paused", () => {
      const { fakePoller, create } = createTestSetup();
      const device = create();

      device.pause();

      assert.strictEqual(fakePoller.isArmed(), false);
      assert.strictEqual(fakePoller.disarmCount(), 1);

      device.resume();

      assert.strictEqual(fakePoller.isArmed(), true);
    });

    it("should stop reading if paused while delivering", () => {
      const { fakePo6, fakePoller, packets } = createTestSetup();

      let delivered = 0;
      let pauseOnDelivery = () => {};

      const device = createTuntapDevice({
        type: "tap",
        onPacket: () => {
          delivered += 1;
          pauseOnDelivery();
        },
        po6: fakePo6.po6,
        kernelAbi: fakePo6.kernelAbi,
        createPoller: fakePoller.createPoller,
        link: createFakeLinkApi().link,
      });

      pauseOnDelivery = () => {
        device.pause();
      };

      fakePo6.queueIncoming({ packet: Uint8Array.from([1]) });
      fakePo6.queueIncoming({ packet: Uint8Array.from([2]) });
      fakePoller.triggerReadable();

      assert.strictEqual(delivered, 1);
      assert.strictEqual(fakePoller.isArmed(), false);
      assert.strictEqual(fakePoller.disarmCount(), 0);

      device.resume();
      fakePoller.triggerReadable();

      assert.strictEqual(delivered, 2);
      assert.deepStrictEqual(packets(), []);
    });

    it("should not arm twice when resuming", () => {
      const { fakePoller, create } = createTestSetup();
      const device = create();

      device.resume();

      assert.strictEqual(fakePoller.isArmed(), true);
      assert.strictEqual(fakePoller.disarmCount(), 0);
    });

    it("should throw once the device is closed", () => {
      const { create } = createTestSetup();
      const device = create();
      device.close();

      assert.throws(() => {
        device.pause();
      }, /device is closed/);
      assert.throws(() => {
        device.resume();
      }, /device is closed/);
    });
  });

  describe("send", () => {
    it("should write the packet", () => {
      const { fakePo6, create } = createTestSetup();
      const device = create();

      const packet = Uint8Array.from([1, 2]);
      device.send({ packet });

      assert.deepStrictEqual(fakePo6.callsOf({ name: "write" }), [{ fd: fakePo6.fd, data: packet }]);
    });

    it("should throw if writing fails", () => {
      const { fakePo6, create } = createTestSetup();
      const device = create();
      fakePo6.failNext({ name: "write", errno: fakePo6.kernelAbi.errnoCodes.EIO });

      assert.throws(() => {
        device.send({ packet: new Uint8Array(1) });
      }, /write\(\) failed with EIO/);
    });

    it("should throw once the device is closed", () => {
      const { create } = createTestSetup();
      const device = create();
      device.close();

      assert.throws(() => {
        device.send({ packet: new Uint8Array(1) });
      }, /device is closed/);
    });
  });

  describe("close", () => {
    it("should stop the poller and close the device once", () => {
      const { fakePo6, fakePoller, create } = createTestSetup();
      const device = create();

      device.close();
      device.close();

      assert.strictEqual(fakePoller.isClosed(), true);
      assert.deepStrictEqual(fakePo6.callsOf({ name: "close" }), [{ fd: fakePo6.fd }]);
    });

    it("should throw if close() fails", () => {
      const { fakePo6, create } = createTestSetup();
      const device = create();
      fakePo6.failNext({ name: "close", errno: fakePo6.kernelAbi.errnoCodes.EBADF });

      assert.throws(() => {
        device.close();
      }, /close\(\) failed with EBADF/);
    });
  });
});
