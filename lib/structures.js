import Struct from "struct";
import os from "os";

let ifreq_flags;
let ifreq_ifindex;

const IFNAMSIZ = 16;

if (os.endianness() === "LE") {
  ifreq_flags = Struct()
    .chars("ifr_name", IFNAMSIZ)
    .word16Ule("ifr_flags")
    .chars("__pad", 22);
  ifreq_ifindex = Struct()
    .chars("ifr_name", IFNAMSIZ)
    .word32Ule("ifr_ifindex")
    .chars("__pad", 20);
} else {
  throw new Error("only little endian supported");
}

export default {
  ifreq_flags,
  ifreq_ifindex,
};
