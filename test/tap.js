/* global describe */
/* global it */

import tuntap2 from "../lib/index.js";

const isRoot = process.geteuid() === 0;

describe("tuntap2", function () {
  this.timeout(20000);

  (isRoot ? it : it.skip)("should create tap device successfully", () => {

    return new Promise((resolve, reject) => {
      const tapDevice = tuntap2.create({ type: "tap" });
      tapDevice.onError(({ error }) => {
        reject(error);
      });
      tapDevice.onOpen(() => {
        tapDevice.close();
        resolve();
      });
    });
  });
});
