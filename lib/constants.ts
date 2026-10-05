// values from <linux/if_tun.h> and <linux/if.h>, the same on x86, arm and arm64

// ioctl requests on /dev/net/tun
const TUNSETIFF = 0x4004_54CAn;
const TUNGETIFF = 0x8004_54D2n;

// ifr_flags for TUNSETIFF
const IFF_TUN = 0x0001n;
const IFF_TAP = 0x0002n;
const IFF_NAPI = 0x0010n;
const IFF_NAPI_FRAGS = 0x0020n;
const IFF_NO_CARRIER = 0x0040n;
const IFF_NO_PI = 0x1000n;
const IFF_ONE_QUEUE = 0x2000n;
const IFF_VNET_HDR = 0x4000n;
const IFF_TUN_EXCL = 0x8000n;
const IFF_MULTI_QUEUE = 0x0100n;

// maximum length of an interface name, including the terminating NUL
const IFNAMSIZ = 16n;

export {
  TUNSETIFF,
  TUNGETIFF,

  IFF_TUN,
  IFF_TAP,
  IFF_NAPI,
  IFF_NAPI_FRAGS,
  IFF_NO_CARRIER,
  IFF_NO_PI,
  IFF_ONE_QUEUE,
  IFF_VNET_HDR,
  IFF_TUN_EXCL,
  IFF_MULTI_QUEUE,

  IFNAMSIZ,
};
