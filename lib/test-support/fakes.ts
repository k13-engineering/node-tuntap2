import {
  createKernelAbiFor,
  createPo6Api,
  hostAbi,
  type TLinuxKernelInterface,
  type TMemoryInterface
} from "po6";
import { IFF_TUN } from "../constants.ts";
import { hostStructures } from "../structures.ts";
import type {
  TCreatePoller,
  TPoller,
  TTuntapLinkApi,
  TTuntapPo6
} from "../tuntap.ts";

const kernelAbi = createKernelAbiFor({ machineAbi: hostAbi });
const { errnoCodes } = kernelAbi;

// only used for its error formatting, which needs neither syscalls nor memory
const { createErrorFromErrno } = createPo6Api({
  kernelInterface: {} as TLinuxKernelInterface,
  kernelAbi,
  memory: {} as TMemoryInterface,
});

type TSyscallName = "open" | "ioctl" | "read" | "write" | "close";

/**
 * A fake /dev/net/tun. TUNSETIFF assigns names like the kernel, packets in `incoming` are returned by read().
 */
const createFakePo6 = () => {
  const fd = 7;

  let calls: { name: TSyscallName, args: Record<string, unknown> }[] = [];
  let incoming: (Uint8Array | { errno: number })[] = [];
  let failures: Partial<Record<TSyscallName, number>> = {};

  const record = ({ name, args }: { name: TSyscallName, args: Record<string, unknown> }) => {
    calls = [...calls, { name, args }];

    const errno = failures[name];
    failures = { ...failures, [name]: undefined };
    return errno;
  };

  // like the kernel: an empty name becomes tun%d or tap%d, %d becomes the first free number
  const assignName = ({ ifreq }: { ifreq: Uint8Array }) => {
    const { ifr_name, ifr_ifru } = hostStructures.ifreq.parse({ data: ifreq });
    const template = ifr_name === "" ? `${(ifr_ifru.ifru_flags & IFF_TUN) === 0n ? "tap" : "tun"}%d` : ifr_name;

    ifreq.set(hostStructures.ifreq.format({ value: { ifr_name: template.replace("%d", "0"), ifr_ifru } }));
  };

  const po6: TTuntapPo6 = {
    open: (args) => {
      const errno = record({ name: "open", args });
      return errno === undefined ? { errno, fd } : { errno, fd: undefined };
    },
    ioctl: (args) => {
      // a copy, as the ifreq is written back below
      const errno = record({ name: "ioctl", args: { ...args, args: [(args.args[0] as Uint8Array).slice()] } });

      if (errno === undefined) {
        assignName({ ifreq: args.args[0] as Uint8Array });
      }

      return { errno };
    },
    read: (args) => {
      const errno = record({ name: "read", args });
      const [next, ...rest] = incoming;

      if (errno !== undefined) {
        return { errno, bytesRead: undefined };
      }

      if (next === undefined) {
        return { errno: errnoCodes.EAGAIN, bytesRead: undefined };
      }

      incoming = rest;

      if (!(next instanceof Uint8Array)) {
        return { errno: next.errno, bytesRead: undefined };
      }

      args.buffer.set(next);
      return { errno: undefined, bytesRead: next.length };
    },
    write: (args) => {
      const errno = record({ name: "write", args });
      return errno === undefined ? { errno, bytesWritten: args.data.length } : { errno, bytesWritten: undefined };
    },
    close: (args) => {
      return { errno: record({ name: "close", args }) };
    },
    createErrorFromErrno,
  };

  return {
    po6,
    kernelAbi,
    fd,

    callsOf: ({ name }: { name: TSyscallName }) => {
      return calls.filter((call) => {
        return call.name === name;
      }).map(({ args }) => {
        return args;
      });
    },
    queueIncoming: ({ packet }: { packet: Uint8Array | { errno: number } }) => {
      incoming = [...incoming, packet];
    },
    failNext: ({ name, errno }: { name: TSyscallName, errno: number }) => {
      failures = { ...failures, [name]: errno };
    },
  };
};

type TArmedEvents = Parameters<TPoller["armOnce"]>[0];

/**
 * A poller that is triggered by the test instead of the event loop.
 */
const createFakePoller = () => {
  let armed: TArmedEvents | undefined;
  let closed = false;
  let disarmCount = 0;
  let createdFor: number | undefined;

  const createPoller: TCreatePoller = ({ fd }) => {
    createdFor = fd;

    return {
      armOnce: (events) => {
        armed = events;
      },
      disarm: () => {
        disarmCount += 1;
        armed = undefined;
      },
      close: () => {
        closed = true;
        armed = undefined;
      },
    };
  };

  const takeArmed = () => {
    const events = armed;
    armed = undefined;

    if (events === undefined) {
      throw Error("poller is not armed");
    }

    return events;
  };

  return {
    createPoller,

    isArmed: () => {
      return armed !== undefined;
    },
    isClosed: () => {
      return closed;
    },
    disarmCount: () => {
      return disarmCount;
    },
    fdOfPoller: () => {
      return createdFor;
    },
    triggerReadable: () => {
      takeArmed().readable();
    },
    triggerError: ({ errorCode }: { errorCode: number }) => {
      takeArmed().error({ errorCode });
    },
  };
};

/**
 * A link API that knows a single interface, or none if `failWith` is set.
 */
const createFakeLinkApi = ({ ifindex = 5, failWith }: { ifindex?: number, failWith?: Error } = {}) => {
  let modifications: { name: string, flags: { IFF_UP: boolean } }[] = [];

  const link: TTuntapLinkApi = {
    findOneBy: async ({ name }) => {
      if (failWith !== undefined) {
        throw failWith;
      }

      return {
        ifindex,
        modify: async ({ flags }) => {
          modifications = [...modifications, { name, flags }];
        },
      };
    },
  };

  return {
    link,
    modifications: () => {
      return modifications;
    },
  };
};

export {
  createFakePo6,
  createFakePoller,
  createFakeLinkApi,
};
