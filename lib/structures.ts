import { define, type TAbi } from "ya-struct";
import { hostAbi } from "po6";

// struct ifreq from <linux/if.h> with the ifr_flags member of its union.
// The union ifr_ifru is as large and aligned as its largest member struct ifmap, which the padding mirrors.
const ifreqDefinition = {
  type: "struct",
  packed: false,
  fixedAbi: {},
  fields: [
    { name: "ifr_name", definition: { type: "string", charSizeInBits: 8, nullTerminatorMandatory: false, length: 16 } },
    {
      name: "ifr_ifru",
      definition: {
        type: "struct",
        packed: false,
        fixedAbi: {},
        fields: [
          { name: "ifru_flags", definition: { type: "c-type", cType: "short", fixedAbi: {} } },
          { pad: true, name: undefined, definition: { type: "c-type", cType: "unsigned long", fixedAbi: {} } },
          { pad: true, name: undefined, definition: { type: "c-type", cType: "unsigned short", fixedAbi: {} } },
          {
            pad: true,
            name: undefined,
            definition: { type: "array", elementType: { type: "c-type", cType: "unsigned char", fixedAbi: {} }, length: 3 },
          },
        ],
      },
    },
  ],
} as const;

const ifreq = define({ definition: ifreqDefinition });

const createTuntapStructuresFor = ({ abi }: { abi: TAbi }) => {
  return {
    abi,
    ifreq: ifreq.parser({ abi }),
  };
};

type TTuntapStructures = ReturnType<typeof createTuntapStructuresFor>;

const hostStructures = createTuntapStructuresFor({ abi: hostAbi });

export {
  ifreqDefinition,

  createTuntapStructuresFor,
  hostStructures,
};

export type {
  TTuntapStructures,
};
