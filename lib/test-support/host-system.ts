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

// <linux/net.h>
const SOCK_RAW = 3n;

const kernelAbi = createKernelAbiFor({ machineAbi: hostAbi });

const po6 = createPo6Api({
  kernelInterface: createLinuxKernelInterface({ syscall, syscallNumbers }),
  kernelAbi,
  memory: { pinBuffer },
});

/**
 * Opens an rtnetlink socket of the host, like users of the library do.
 */
const openRtnetlink = () => {
  const { O_CLOEXEC } = kernelAbi.constants;
  const { fd } = po6.socket({ domain: AF_NETLINK, type: SOCK_RAW | O_CLOEXEC, protocol: NETLINK_ROUTE });
  po6.bind({ fd: fd as number, sockaddr: formatNetlinkAddress({ address: { nl_pid: 0n, nl_groups: 0n } }) });

  const netlink = createNetlinkSocket({ transport: createPo6NetlinkTransport({ fd: fd as number, po6, kernelAbi, createPoller }) });

  const { link } = createRtnetlink({ netlink });

  return {
    link,
    close: () => {
      netlink.detach();
      po6.close({ fd: fd as number });
    },
  };
};

export {
  po6,
  kernelAbi,
  createPoller,
  openRtnetlink,
};
