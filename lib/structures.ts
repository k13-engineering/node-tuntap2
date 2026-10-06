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
          { pad: true, name: "ifru_pad_long", definition: { type: "c-type", cType: "unsigned long", fixedAbi: {} } },
          { pad: true, name: "ifru_pad_short", definition: { type: "c-type", cType: "unsigned short", fixedAbi: {} } },
          {
            pad: true,
            name: "ifru_pad_bytes",
            definition: { type: "array", elementType: { type: "c-type", cType: "unsigned char", fixedAbi: {} }, length: 3 },
          },
        ],
      },
    },
  ],
} as const;

// spelled out, as the declaration files are generated per file and could not infer these types
const ifreq: ReturnType<typeof define<typeof ifreqDefinition>> = define({ definition: ifreqDefinition });

type TParserOf<T extends { parser: (args: { abi: TAbi }) => object }> = ReturnType<T["parser"]>;

type TTuntapStructures = {
  abi: TAbi;
  ifreq: TParserOf<typeof ifreq>;
};

const createTuntapStructuresFor = ({ abi }: { abi: TAbi }): TTuntapStructures => {
  return {
    abi,
    ifreq: ifreq.parser({ abi }),
  };
};

const hostStructures = createTuntapStructuresFor({ abi: hostAbi });

export {
  ifreqDefinition,

  createTuntapStructuresFor,
  hostStructures,
};

export type {
  TTuntapStructures,
};
