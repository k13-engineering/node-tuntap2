// Creates a TAP interface and prints the Ethernet frames the kernel sends through it until interrupted.
// Needs CAP_NET_ADMIN:
//
//   sudo node examples/capture-tap.ts

import { createPoller } from "@k13engineering/uv-poll";
import { pinBuffer } from "buffer2address";
import {
  AF_NETLINK,
  createNetlinkSocket,
  createPo6NetlinkTransport,
  formatNetlinkAddress,
  NETLINK_ROUTE
} from "node-netlink";
import { createRtnetlink } from "node-rtnetlink";
import {
  createKernelAbiFor,
  createLinuxKernelInterface,
  createPo6Api,
  hostAbi
} from "po6";
import { syscall, syscallNumbers } from "syscall-napi";
import { createTuntapDevice, type TTuntapLinkApi } from "../lib/index.ts";

// <linux/net.h>
const SOCK_RAW = 3n;

const kernelAbi = createKernelAbiFor({ machineAbi: hostAbi });
const po6 = createPo6Api({
  kernelInterface: createLinuxKernelInterface({ syscall, syscallNumbers }),
  kernelAbi,
  memory: { pinBuffer },
});

// rtnetlink is used to bring the interface up
const { fd: netlinkFd } = po6.socket({ domain: AF_NETLINK, type: SOCK_RAW | kernelAbi.constants.O_CLOEXEC, protocol: NETLINK_ROUTE });
po6.bind({ fd: netlinkFd as number, sockaddr: formatNetlinkAddress({ address: { nl_pid: 0n, nl_groups: 0n } }) });
const netlink = createNetlinkSocket({ transport: createPo6NetlinkTransport({ fd: netlinkFd as number, po6, kernelAbi, createPoller }) });
const { link } = createRtnetlink({ netlink });

const hex = ({ bytes }: { bytes: Uint8Array }) => {
  return [...bytes].map((byte) => {
    return byte.toString(16).padStart(2, "0");
  }).join(":");
};

const device = createTuntapDevice({
  type: "tap",
  name: "example%d",
  po6,
  kernelAbi,
  createPoller,
  link: link as unknown as TTuntapLinkApi,
  onOpen: ({ name, ifindex }) => {
    console.log(`${name} (ifindex ${ifindex}) is up, press Ctrl+C to stop`);
  },
  onPacket: ({ packet }) => {
    const ethertype = new DataView(packet.buffer, packet.byteOffset).getUint16(12);
    const source = hex({ bytes: packet.subarray(6, 12) });
    const destination = hex({ bytes: packet.subarray(0, 6) });
    console.log(`${source} > ${destination} type 0x${ethertype.toString(16)} length ${packet.length}`);
  },
  onError: ({ error }) => {
    console.error(error);
  },
});

process.once("SIGINT", () => {
  device.close();
  netlink.detach();
  po6.close({ fd: netlinkFd as number });
});
