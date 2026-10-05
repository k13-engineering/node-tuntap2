// Creates TUN and TAP devices on the host kernel and prints what it observed as JSON.
// Needs CAP_NET_ADMIN, so it is run in a fresh network namespace, e.g. `sudo unshare -n node device-lifecycle.ts`.

import { createTuntapDevice } from "../index.ts";
import {
  createPoller,
  kernelAbi,
  openRtnetlink,
  po6
} from "./host-system.ts";

const withTimeout = async <T>({ promise, ms, what }: { promise: Promise<T>, ms: number, what: string }) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(Error(`timed out waiting for ${what}`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const { link, close: closeRtnetlink } = openRtnetlink();

const createAndWatch = ({ type, name }: { type: "tun" | "tap", name: string }) => {
  let resolveOpen: (info: { name: string, ifindex: number }) => void = () => {};
  let resolvePacket: (packet: Uint8Array) => void = () => {};
  let rejectAll: (error: Error) => void = () => {};

  const opened = new Promise<{ name: string, ifindex: number }>((resolve, reject) => {
    resolveOpen = resolve;
    rejectAll = reject;
  });
  const firstPacket = new Promise<Uint8Array>((resolve) => {
    resolvePacket = resolve;
  });

  const device = createTuntapDevice({
    type,
    name,
    po6,
    kernelAbi,
    createPoller,
    link,
    onOpen: (info) => {
      resolveOpen(info);
    },
    onPacket: ({ packet }) => {
      resolvePacket(packet);
    },
    onError: ({ error }) => {
      rejectAll(error);
    },
  });

  return { device, opened, firstPacket };
};

try {
  const tap = createAndWatch({ type: "tap", name: "nt-tap%d" });
  const tapOpened = await withTimeout({ promise: tap.opened, ms: 5000, what: "tap to open" });
  const tapInfo = await link.fromIndex({ ifindex: tapOpened.ifindex }).fetch();

  // the kernel sends IPv6 neighbour and multicast listener messages once the interface is up
  const packet = await withTimeout({ promise: tap.firstPacket, ms: 15_000, what: "a packet from the kernel" });

  // a broadcast Ethernet frame with an unknown ethertype, the kernel drops it
  const frame = new Uint8Array(60);
  frame.fill(0xFF, 0, 6);
  frame.set([0x02, 0, 0, 0, 0, 1, 0x88, 0xB5], 6);
  tap.device.send({ packet: frame });

  tap.device.pause();
  tap.device.resume();

  const tun = createAndWatch({ type: "tun", name: "nt-tun0" });
  const tunOpened = await withTimeout({ promise: tun.opened, ms: 5000, what: "tun to open" });
  const tunInfo = await link.fromIndex({ ifindex: tunOpened.ifindex }).fetch();

  const namesWhileOpen = (await link.listAll()).map(({ name }) => {
    return name;
  });

  tap.device.close();
  tun.device.close();

  const namesAfterClose = (await link.listAll()).map(({ name }) => {
    return name;
  });

  console.log(JSON.stringify({
    tap: { name: tap.device.name, opened: tapOpened, up: tapInfo.flags.IFF_UP, kind: tapInfo.linkinfo?.kind },
    packetLength: packet.length,
    tun: { name: tun.device.name, opened: tunOpened, up: tunInfo.flags.IFF_UP, pointToPoint: tunInfo.flags.IFF_POINTOPOINT },
    namesWhileOpen,
    namesAfterClose,
  }));
} finally {
  closeRtnetlink();
}
