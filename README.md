# node-tuntap2

[![CI](https://github.com/k13-engineering/node-tuntap2/actions/workflows/ci.yml/badge.svg)](https://github.com/k13-engineering/node-tuntap2/actions/workflows/ci.yml)

TUN and TAP devices for Node.js on Linux, written in TypeScript.

- **Synchronous creation.** The interface exists and its name is known as soon as `createTuntapDevice()` returns. Bringing it up happens in the background and is reported by `onOpen`.
- **Callbacks instead of events.** `onOpen`, `onPacket` and `onError` are passed on creation.
- **No worker threads, no native code of its own.** Packets are read when the libuv event loop reports the device as readable, using the [po6](https://www.npmjs.com/package/po6) syscalls and the poller you pass in.
- **Dependency injection.** The syscalls, the poller and the link API used to bring the interface up are passed in, so the device runs against fakes in tests.
- **Checked against the C headers.** The layout of `struct ifreq` is defined with [ya-struct](https://www.npmjs.com/package/ya-struct) and compared with `<linux/if.h>` in the tests, as are all constants.

## Requirements

- Linux with `/dev/net/tun`
- Node.js 24 or newer
- `CAP_NET_ADMIN` to create interfaces

## Installation

```sh
npm install @k13engineering/tuntap
```

The examples below use po6 with its syscall and memory backends, a poller, and node-netlink with node-rtnetlink to bring the interface up:

```sh
npm install po6 syscall-napi buffer2address @k13engineering/uv-poll node-netlink node-rtnetlink
```

## Usage

```ts
import { createPoller } from "@k13engineering/uv-poll";
import { pinBuffer } from "buffer2address";
import { createKernelAbiFor, createLinuxKernelInterface, createPo6Api, hostAbi } from "po6";
import { syscall, syscallNumbers } from "syscall-napi";
import { createTuntapDevice } from "@k13engineering/tuntap";

const kernelAbi = createKernelAbiFor({ machineAbi: hostAbi });
const po6 = createPo6Api({
  kernelInterface: createLinuxKernelInterface({ syscall, syscallNumbers }),
  kernelAbi,
  memory: { pinBuffer },
});

// rt is a node-rtnetlink instance, see its README for opening the NETLINK_ROUTE socket
const device = createTuntapDevice({
  type: "tap",
  name: "tap%d",
  po6,
  kernelAbi,
  createPoller,
  link: rt.link,
  onOpen: ({ name, ifindex }) => {
    console.log(`${name} is up with ifindex ${ifindex}`);
  },
  onPacket: ({ packet }) => {
    console.log(`received ${packet.length} bytes`);
  },
  onError: ({ error }) => {
    console.error(error);
  },
});

console.log(`created ${device.name}`);

// write a frame to the interface, the kernel receives it as if it came from the wire
device.send({ packet: frame });

// the interface is removed when the device is closed
device.close();
```

See [examples/capture-tap.ts](examples/capture-tap.ts) for a complete program, including the rtnetlink setup.

## API

### `createTuntapDevice(args)`

Opens `/dev/net/tun`, creates the interface and starts reading packets. Throws if the interface cannot be created, e.g. with `EPERM` without `CAP_NET_ADMIN`.

| Argument | Description |
| --- | --- |
| `type` | `"tun"` for IP packets, `"tap"` for Ethernet frames |
| `name` | the name of the interface, at most 15 bytes. May contain `%d`, e.g. `"tap%d"`, which the kernel replaces with the first free number. The kernel picks a name if omitted |
| `packetInformation` | `true` prepends `struct tun_pi` with flags and protocol to every packet. Off by default (`IFF_NO_PI`) |
| `onOpen({ name, ifindex })` | called once the interface is up |
| `onPacket({ packet })` | called for every packet the kernel sends through the interface |
| `onError({ error })` | called for errors after creation, e.g. while bringing the interface up or reading. Without a handler, such errors are thrown asynchronously as uncaught exceptions |
| `po6` | an object with `open()`, `ioctl()`, `read()`, `write()`, `close()` and `createErrorFromErrno()` of the po6 API |
| `kernelAbi` | the po6 kernel ABI, for the `O_*` constants and errno values |
| `createPoller({ fd })` | returns a poller with `armOnce({ readable, error })`, `disarm()` and `close()`, like `createPoller` of @k13engineering/uv-poll |
| `link` | an object with `findOneBy({ name })`, like `rt.link` of node-rtnetlink. The link it resolves with must have `ifindex` and `modify({ flags })` |
| `structures` | the layout of `struct ifreq`, `hostStructures` by default |

Returns a device with:

| Member | Description |
| --- | --- |
| `name` | the name of the interface as assigned by the kernel, e.g. `tap0` |
| `send({ packet })` | writes a packet to the interface, throws on failure. The kernel accepts packets once the interface is up |
| `pause()` | stops calling `onPacket`, packets queue up in the kernel meanwhile |
| `resume()` | starts calling `onPacket` again |
| `close()` | stops reading and closes the device, the kernel removes the interface. Calling it again has no effect |

The device keeps the Node.js process alive until it is closed or paused.

### Constants

`TUNSETIFF`, `TUNGETIFF`, the `IFF_*` flags of `<linux/if_tun.h>` and `IFNAMSIZ` are exported as `bigint`s. `ifreqDefinition`, `createTuntapStructuresFor({ abi })` and `hostStructures` describe `struct ifreq`.

## Development

```sh
npm ci
npm run build       # transpile to dist/
npm run type-check
npm run test        # mocha with c8, 100% coverage required
npm run lint
```

The unit tests run against the fakes in `lib/test-support/fakes.ts`. If `sudo` works without a password, `lib/index.spec.ts` also creates TUN and TAP devices on the kernel of the host, in a fresh network namespace so the host stays untouched. The structure layout and constants are compared with the C headers by compiling C programs, so `gcc` and the Linux headers are required.

Releases are published by pushing a tag like `v0.1.0`, which builds the package, merges `package.npm.json` into `package.json` and sets the version.

## License

LGPL-2.1, see [LICENSE](LICENSE).
