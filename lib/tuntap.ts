import type { TPo6Api, TPo6KernelAbi } from "po6";
import {
  IFF_NO_PI,
  IFF_TAP,
  IFF_TUN,
  IFNAMSIZ,
  TUNSETIFF
} from "./constants.ts";
import { hostStructures, type TTuntapStructures } from "./structures.ts";

const TUN_DEVICE_PATH = "/dev/net/tun";

// large enough for any packet, including GSO packets of 64 KiB
const RECEIVE_BUFFER_SIZE = 65_536 + 128;

type TTuntapPo6 = Pick<TPo6Api, "open" | "ioctl" | "read" | "write" | "close" | "createErrorFromErrno">;

type TTuntapKernelAbi = Pick<TPo6KernelAbi, "constants" | "errnoCodes">;

type TPoller = {
  armOnce: (events: {
    readable: () => void;
    error: (args: { errorCode: number }) => void;
  }) => void;
  disarm: () => void;
  close: () => void;
};

type TCreatePoller = (args: { fd: number }) => TPoller;

// the part of the link API of node-rtnetlink that is used to bring the device up
type TTuntapLinkApi = {
  findOneBy: (args: { name: string }) => Promise<{
    ifindex: number;
    modify: (args: { flags: { IFF_UP: boolean } }) => Promise<void>;
  }>;
};

type TOnError = (args: { error: Error }) => void;

type TCreateTuntapDeviceArgs = {
  // "tun" for IP packets, "tap" for Ethernet frames
  type: "tun" | "tap";
  // the name of the interface, may contain %d, e.g. "tap%d", the kernel picks a name if omitted
  name?: string;
  // prepend struct tun_pi with flags and protocol to every packet, off by default
  packetInformation?: boolean;

  // called once the interface is up
  onOpen?: (args: { name: string, ifindex: number }) => void;
  // called for every packet the kernel sends through the interface
  onPacket?: (args: { packet: Uint8Array }) => void;
  // called for errors after creation, if omitted such errors are thrown asynchronously
  onError?: TOnError;

  po6: TTuntapPo6;
  kernelAbi: TTuntapKernelAbi;
  createPoller: TCreatePoller;
  link: TTuntapLinkApi;
  structures?: TTuntapStructures;
};

type TTuntapDevice = {
  // the name of the interface as assigned by the kernel
  name: string;
  // writes a packet to the interface, throws on failure
  send: (args: { packet: Uint8Array }) => void;
  // stops calling onPacket until resume() is called, packets queue up in the kernel meanwhile
  pause: () => void;
  resume: () => void;
  // closes the device, the kernel removes the interface
  close: () => void;
};

// errors without an onError handler must not go unnoticed, so they surface as uncaught exceptions
const throwAsynchronously: TOnError = ({ error }) => {
  queueMicrotask(() => {
    throw error;
  });
};

const flagsFor = ({ type, packetInformation }: { type: "tun" | "tap", packetInformation: boolean }) => {
  const typeFlag = type === "tun" ? IFF_TUN : IFF_TAP;
  return packetInformation ? typeFlag : typeFlag | IFF_NO_PI;
};

const assertValidName = ({ name }: { name: string }) => {
  if (new TextEncoder().encode(name).length >= Number(IFNAMSIZ)) {
    throw Error(`interface name "${name}" is too long, at most ${Number(IFNAMSIZ) - 1} bytes are allowed`);
  }
};

const throwOnErrno = ({ po6, operation, errno }: { po6: TTuntapPo6, operation: string, errno: number | undefined }) => {
  if (errno !== undefined) {
    throw po6.createErrorFromErrno({ operation, errno });
  }
};

// the kernel writes the actual name back to the ifreq, e.g. tap0 for tap%d
const attachInterface = ({ fd, type, name, packetInformation, po6, structures }: {
  fd: number,
  type: "tun" | "tap",
  name: string,
  packetInformation: boolean,
  po6: TTuntapPo6,
  structures: TTuntapStructures,
}) => {
  const ifreq = structures.ifreq.format({
    value: {
      ifr_name: name,
      ifr_ifru: { ifru_flags: flagsFor({ type, packetInformation }) },
    },
  });

  const { errno } = po6.ioctl({ fd, request: TUNSETIFF, args: [ifreq] });
  return { errno, name: structures.ifreq.parse({ data: ifreq }).ifr_name };
};

/**
 * Opens /dev/net/tun and attaches it to a new interface, returns the file descriptor and the name of the interface.
 */
const openDevice = ({ type, name, packetInformation, po6, kernelAbi, structures }: {
  type: "tun" | "tap",
  name: string,
  packetInformation: boolean,
  po6: TTuntapPo6,
  kernelAbi: TTuntapKernelAbi,
  structures: TTuntapStructures,
}) => {
  assertValidName({ name });

  const { O_RDWR, O_NONBLOCK, O_CLOEXEC } = kernelAbi.constants;
  const { errno: openErrno, fd } = po6.open({ pathname: TUN_DEVICE_PATH, flags: O_RDWR | O_NONBLOCK | O_CLOEXEC });
  throwOnErrno({ po6, operation: `open("${TUN_DEVICE_PATH}")`, errno: openErrno });

  const attached = attachInterface({ fd: fd as number, type, name, packetInformation, po6, structures });

  if (attached.errno !== undefined) {
    po6.close({ fd: fd as number });
    throwOnErrno({ po6, operation: "ioctl(TUNSETIFF)", errno: attached.errno });
  }

  return { fd: fd as number, name: attached.name };
};

/**
 * Reads packets whenever the device is readable, until paused or closed.
 */
const createReceiver = ({ fd, po6, kernelAbi, createPoller, onPacket, onError }: {
  fd: number,
  po6: TTuntapPo6,
  kernelAbi: TTuntapKernelAbi,
  createPoller: TCreatePoller,
  onPacket: (args: { packet: Uint8Array }) => void,
  onError: TOnError,
}) => {
  const { EAGAIN } = kernelAbi.errnoCodes;

  const poller = createPoller({ fd });
  const buffer = new Uint8Array(RECEIVE_BUFFER_SIZE);

  let stopped = false;
  let paused = false;
  let armed = false;

  // returns whether to continue reading
  const receiveOne = () => {
    const { errno, bytesRead } = po6.read({ fd, buffer });

    if (errno === undefined) {
      onPacket({ packet: buffer.slice(0, bytesRead) });
      return true;
    }

    if (errno !== EAGAIN) {
      onError({ error: po6.createErrorFromErrno({ operation: "read()", errno }) });
    }

    return false;
  };

  const isReceiving = () => {
    return !paused && !stopped;
  };

  // reads until the device is empty, returns whether to wait for more packets
  const drain = () => {
    let continueReading = true;

    while (continueReading && isReceiving()) {
      continueReading = receiveOne();
    }

    return isReceiving();
  };

  const arm = () => {
    armed = true;

    poller.armOnce({
      readable: () => {
        armed = false;

        if (drain()) {
          arm();
        }
      },
      error: ({ errorCode }) => {
        armed = false;
        onError({ error: Error(`polling ${TUN_DEVICE_PATH} failed with libuv error ${errorCode}`) });
      },
    });
  };

  const pause = () => {
    paused = true;

    if (armed) {
      armed = false;
      poller.disarm();
    }
  };

  const resume = () => {
    paused = false;

    if (!armed) {
      arm();
    }
  };

  const stop = () => {
    stopped = true;
    poller.close();
  };

  arm();

  return {
    pause,
    resume,
    stop,
  };
};

const deviceOptionsWithDefaults = ({ name = "", packetInformation = false, structures = hostStructures }: {
  name?: string,
  packetInformation?: boolean,
  structures?: TTuntapStructures,
}) => {
  return { name, packetInformation, structures };
};

const bringUp = async ({ link, name }: { link: TTuntapLinkApi, name: string }) => {
  const createdLink = await link.findOneBy({ name });
  await createdLink.modify({ flags: { IFF_UP: true } });
  return { ifindex: createdLink.ifindex };
};

/**
 * Creates a TUN or TAP interface. The interface exists until close() is called.
 *
 * The name is known right away, the interface is brought up asynchronously, which onOpen reports.
 */
const createTuntapDevice = ({ onOpen, onPacket, onError = throwAsynchronously, ...args }: TCreateTuntapDeviceArgs): TTuntapDevice => {
  const { type, po6, kernelAbi, createPoller, link } = args;

  const { fd, name } = openDevice({ type, po6, kernelAbi, ...deviceOptionsWithDefaults(args) });

  let closed = false;

  const receiver = createReceiver({
    fd,
    po6,
    kernelAbi,
    createPoller,
    onPacket: (packetArgs) => {
      onPacket?.(packetArgs);
    },
    onError,
  });

  bringUp({ link, name }).then(({ ifindex }) => {
    if (!closed) {
      onOpen?.({ name, ifindex });
    }
  }, (error) => {
    if (!closed) {
      onError({ error: Error(`failed to bring up interface ${name}`, { cause: error }) });
    }
  });

  const assertOpen = () => {
    if (closed) {
      throw Error("device is closed");
    }
  };

  const send: TTuntapDevice["send"] = ({ packet }) => {
    assertOpen();

    const { errno } = po6.write({ fd, data: packet });
    throwOnErrno({ po6, operation: "write()", errno });
  };

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    receiver.stop();

    const { errno } = po6.close({ fd });
    throwOnErrno({ po6, operation: "close()", errno });
  };

  return {
    name,
    send,
    pause: () => {
      assertOpen();
      receiver.pause();
    },
    resume: () => {
      assertOpen();
      receiver.resume();
    },
    close,
  };
};

export {
  createTuntapDevice,
};

export type {
  TCreateTuntapDeviceArgs,
  TTuntapDevice,
  TTuntapPo6,
  TTuntapKernelAbi,
  TTuntapLinkApi,
  TPoller,
  TCreatePoller,
};
