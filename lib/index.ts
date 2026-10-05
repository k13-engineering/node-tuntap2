import { createTuntapDevice } from "./tuntap.ts";
import { createTuntapStructuresFor, hostStructures, ifreqDefinition } from "./structures.ts";

export * from "./constants.ts";

export {
  createTuntapDevice,

  createTuntapStructuresFor,
  hostStructures,
  ifreqDefinition,
};

export type {
  TCreateTuntapDeviceArgs,
  TTuntapDevice,
  TTuntapPo6,
  TTuntapKernelAbi,
  TTuntapLinkApi,
  TPoller,
  TCreatePoller,
} from "./tuntap.ts";
export type { TTuntapStructures } from "./structures.ts";
