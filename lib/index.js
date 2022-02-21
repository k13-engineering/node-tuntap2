/* eslint-disable no-underscore-dangle */

import fs from "fs";
import structures from "./structures.js";
import rtnetlink from "node-rtnetlink";
import producerFactory from "./producer.js";
import po6 from "po6";
import url from "url";
import path from "path";
import rxjs from "rxjs";
import { tap, map, share, concatMap } from "rxjs";

import rxjsHelpers from "./rxjs.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import EventEmitter from "events";

const TUNSETIFF = 0x400454ca;
const TUNGETIFF = 0x800454d2;

const IFF_TUN = 0x0001;
const IFF_TAP = 0x0002;
const IFF_NO_PI = 0x1000;

const setup = ({ fd, name, flags }) => {
  const ifr = structures.ifreq_flags.allocate();
  ifr.set("ifr_name", name);
  ifr.set("ifr_flags", flags);

  const buf = ifr.buffer();

  po6.ioctl.sync({ fd, request: TUNSETIFF, args: [buf] });
  // ioctl(fd, TUNSETIFF, buf);

  // const resultBuffer = Buffer.alloc(structures.ifreq.length());
  // ioctl(fh.fd, TUNGETIFF, resultBuffer);
  po6.ioctl.sync({ fd, request: TUNGETIFF, args: [buf] });
  // ioctl(fd, TUNGETIFF, buf);

  const actualName = ifr.get("ifr_name");

  return {
    actualName,
  };
};

const create = ({ type, name = "" }) => {
  const emitter = new EventEmitter();

  const sharedFdResource = rxjsHelpers
    .fdSource({ filename: "/dev/net/tun", flags: "r+" })
    .pipe(share());

  const setupTask = sharedFdResource.pipe(
    map(({ fd }) => {
      const flags = (type === "tun" ? IFF_TUN : IFF_TAP) | IFF_NO_PI;
      const { actualName } = setup({ fd, name, flags });

      return {
        actualName,
      };
    }),
    concatMap(({ actualName }) => {
      return rxjs.from(
        rtnetlink.open().then((rt) => {
          return rt.link
            .findOneBy({ name: actualName })
            .then((link) => {
              return link
                .modify({
                  flags: {
                    IFF_UP: true,
                  },
                })
                .then(() => {
                  return { ifindex: link.ifindex, actualName };
                });
            })
            .finally(() => {
              return rt.close();
            });
        })
      );
    }),
    tap(({ ifindex, actualName }) => {
      emitter.emit("open", { ifindex, name: actualName });
    })
  );

  const receiveTask = sharedFdResource.pipe(
    (source) => {
      return new rxjs.Observable((subscriber) => {
        let receiveWorker = undefined;

        const sourceSubscription = source.subscribe({
          next: ({ fd }) => {
            receiveWorker = producerFactory.create({
              filename: `file://${path.resolve(
                __dirname,
                "receive-worker.js"
              )}`,
              producerData: { fd },
            });
            receiveWorker.on("data", (data) => {
              subscriber.next(Buffer.from(data));
            });
            receiveWorker.once("error", (err) => {
              subscriber.error(err);
            });
            receiveWorker.once("end", () => {
              subscriber.error(Error(`poll loop ended`));
            });
          },
          error: (err) => {
            subscriber.error(err);
          },
        });

        const unsubscribe = () => {
          if (receiveWorker) {
            receiveWorker.once("close", () => {
              sourceSubscription.unsubscribe();
            });
            receiveWorker.destroy();
          } else {
            sourceSubscription.unsubscribe();
          }
        };

        return unsubscribe;
      });
    },
    tap((data) => {
      emitter.emit("packet", data);
    })
  );

  let openedFd = undefined;

  const sendSupportTask = sharedFdResource.pipe(
    concatMap(({ fd }) => {
      return new rxjs.Observable(() => {
        openedFd = fd;

        const unsubscribe = () => {
          openedFd = undefined;
        };

        return unsubscribe;
      });
    })
  );

  const sub = rxjs.merge(setupTask, receiveTask, sendSupportTask).subscribe({
    error: (err) => {
      emitter.emit("error", err);
    },
  });

  const send = (packet) => {
    if (openedFd === undefined) {
      throw Error(`device not ready or closed`);
    }

    fs.writeSync(openedFd, packet);
  };

  const close = () => {
    sub.unsubscribe();
  };

  return {
    on: emitter.on.bind(emitter),

    send,

    close,
  };
};

export default {
  create,
};
