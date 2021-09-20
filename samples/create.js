import tuntap2 from "../lib/index.js";

process.nextTick(async () => {
  try {
    const { name } = await tuntap2.create({
      type: "tap",
    });

    console.log(`[${name}] created`);
  } catch (ex) {
    console.error(ex);
    process.exitCode = -1;
  }
});
